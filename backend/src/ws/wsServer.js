'use strict';

// pool нужен для сохранения сообщений чата в БД
const { pool } = require('../db');

/**
 * ============================================================
 *  WebSocket Server Module
 * ============================================================
 *
 *  Что такое WebSocket?
 *  --------------------
 *  WebSocket — протокол полнодуплексной связи поверх TCP,
 *  стандартизированный в RFC 6455. В отличие от HTTP (запрос→ответ),
 *  WebSocket держит постоянное соединение: и сервер, и клиент
 *  могут отправлять сообщения в любой момент без нового запроса.
 *
 *  Процесс установки соединения (handshake):
 *  1. Клиент делает обычный HTTP GET с заголовками:
 *       Upgrade: websocket
 *       Connection: Upgrade
 *       Sec-WebSocket-Key: <base64-nonce>
 *  2. Сервер отвечает кодом 101 Switching Protocols:
 *       Upgrade: websocket
 *       Connection: Upgrade
 *       Sec-WebSocket-Accept: <sha1-hash>
 *  3. Соединение «апгрейдится» с HTTP на WebSocket.
 *     Дальше идут бинарные фреймы вместо HTTP-пакетов.
 *
 *  Почему `ws`, а не чистый Node.js?
 *  ----------------------------------
 *  Реализовать RFC 6455 вручную — это ~500 строк хэширования,
 *  разбора фреймов, masking и ping/pong. Библиотека `ws` делает
 *  это за нас, оставаясь минималистичной (нет абстракций «комнат»,
 *  нет автоматического переподключения, нет namespaces — всё это
 *  есть в Socket.IO, здесь этого нет намеренно).
 *
 *  Формат сообщений
 *  ----------------
 *  Все сообщения — JSON-объекты вида:
 *    { "type": "<событие>", "data": { ... } }
 *
 *  Типы событий (server → client):
 *    connected      — сервер подтверждает соединение
 *    pong           — ответ на ping от клиента
 *    task_created   — создана новая задача
 *    task_updated   — задача изменена
 *    task_deleted   — задача удалена
 *
 *  Типы событий (client → server):
 *    ping           — проверка живости соединения
 * ============================================================
 */

const WebSocket = require('ws'); // npm i ws — RFC 6455 без фреймворка

/**
 * Хранит ссылку на WebSocket.Server после инициализации.
 * Используется функцией broadcast(), которую импортируют роуты.
 * @type {WebSocket.Server|null}
 */
let wss = null;

// ─────────────────────────────────────────────────────────────────────────────
//  createWsServer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Создаёт WebSocket-сервер и привязывает его к существующему
 * Node.js HTTP-серверу (http.Server, созданному поверх Express).
 *
 * Почему нужен http.Server, а не просто app.listen()?
 * app.listen() внутри тоже создаёт http.Server, но не возвращает его.
 * Нам нужна явная ссылка, чтобы передать её в WebSocket.Server,
 * который перехватывает событие 'upgrade' на этом сервере.
 *
 * @param {import('http').Server} httpServer — Node.js HTTP-сервер
 * @returns {WebSocket.Server}
 */
function createWsServer(httpServer) {
  wss = new WebSocket.Server({
    server: httpServer, // разделяем TCP-порт с Express (не занимаем новый)
    path: '/ws',        // принимаем upgrade-запросы только для пути /ws
                        // все остальные пути обрабатывает Express как обычно
  });

  // ─── Событие: новый клиент подключился ────────────────────────────────────
  //
  // 'connection' срабатывает после успешного WebSocket-рукопожатия.
  //   ws      — объект соединения (EventEmitter + поток)
  //   request — исходный HTTP-запрос (можно читать заголовки, cookies, IP)
  //
  wss.on('connection', (ws, request) => {
    const ip = request.socket.remoteAddress || 'unknown';
    console.log(`[WS] + Клиент подключился: ${ip} | Всего: ${wss.clients.size}`);

    // Сразу сообщаем клиенту, что соединение установлено
    sendTo(ws, {
      type: 'connected',
      data: {
        message: 'WebSocket-соединение установлено',
        timestamp: new Date().toISOString(),
      },
    });

    // ─── Событие: получено сообщение от клиента ─────────────────────────────
    //
    // rawData — Buffer (бинарный) или string.
    // toString() гарантирует строку независимо от режима.
    //
    ws.on('message', (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString());
        console.log(`[WS] ← от ${ip}:`, msg);

        // Обрабатываем ping — возвращаем pong (healthcheck)
        if (msg.type === 'ping') {
          sendTo(ws, { type: 'pong', data: { timestamp: new Date().toISOString() } });
        }

        // ── Сообщение чата ──────────────────────────────────────────────────
        // Клиент присылает: { type: 'chat_message', username: '...', text: '...' }
        // Сервер сохраняет в БД и рассылает всем через broadcast.
        if (msg.type === 'chat_message') {
          handleChatMessage(msg.username, msg.text);
        }
      } catch {
        console.warn(`[WS] Неверный JSON от ${ip}`);
      }
    });

    // ─── Событие: соединение закрыто ────────────────────────────────────────
    //
    // code   — числовой код закрытия (WebSocket Close Codes, RFC 6455 §7.4):
    //   1000 — нормальное завершение
    //   1001 — конечная точка «уходит» (браузер закрыт)
    //   1006 — аварийное (TCP разрыв без Close frame)
    // reason — Buffer с текстом причины (может быть пустым)
    //
    ws.on('close', (code, reason) => {
      const why = reason.toString() || '—';
      console.log(`[WS] - Клиент ${ip} отключился | код: ${code} | причина: ${why} | осталось: ${wss.clients.size}`);
    });

    // ─── Событие: ошибка соединения ─────────────────────────────────────────
    //
    // Обязательно слушаем: без обработчика 'error' Node.js выбросит
    // необработанное исключение и может завершить процесс.
    //
    ws.on('error', (err) => {
      console.error(`[WS] Ошибка с клиентом ${ip}:`, err.message);
    });
  });

  // ─── Ошибка самого сервера (например, порт занят) ─────────────────────────
  wss.on('error', (err) => {
    console.error('[WS] Ошибка WS-сервера:', err.message);
  });

  console.log('[WS] Сервер запущен → ws://<host>/ws');
  return wss;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Утилиты
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Отправляет JSON-сообщение одному клиенту.
 *
 * Всегда проверяем readyState перед отправкой:
 *   WebSocket.CONNECTING = 0 — рукопожатие ещё не завершено
 *   WebSocket.OPEN       = 1 — соединение активно, можно писать ✓
 *   WebSocket.CLOSING    = 2 — идёт закрытие
 *   WebSocket.CLOSED     = 3 — соединение закрыто
 *
 * @param {WebSocket} ws      — целевое соединение
 * @param {object}   payload  — объект сообщения { type, data }
 */
function sendTo(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

/**
 * Рассылает JSON-сообщение ВСЕМ подключённым клиентам (broadcast).
 *
 * wss.clients — встроенный Set<WebSocket> со всеми активными соединениями.
 * Сериализуем payload один раз, чтобы не делать JSON.stringify N раз.
 *
 * Вызывается из роутов tasks.js после каждой операции создания/
 * обновления/удаления, чтобы все вкладки браузера синхронизировались.
 *
 * @param {{ type: string, data: any }} payload — сообщение для рассылки
 */
function broadcast(payload) {
  if (!wss) {
    // Сервер ещё не инициализирован — такого не должно быть в нормальном потоке,
    // но защитимся на всякий случай
    console.warn('[WS] broadcast вызван до инициализации сервера');
    return;
  }

  const message = JSON.stringify(payload); // сериализуем один раз
  let sent = 0;

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      sent++;
    }
  });

  console.log(`[WS] → broadcast "${payload.type}" → ${sent}/${wss.clients.size} клиент(ов)`);
}

/**
 * Сохраняет сообщение чата в PostgreSQL и рассылает его всем клиентам.
 *
 * Входящие данные обрезаем: имя до 50 символов, текст до 500.
 * Это защита от случайно огромных сообщений — не валидация безопасности.
 *
 * @param {string} username — имя отправителя
 * @param {string} text     — текст сообщения
 */
async function handleChatMessage(username, text) {
  // Игнорируем пустые сообщения
  if (!username || !text || !text.trim()) return;

  try {
    const result = await pool.query(
      'INSERT INTO messages (username, text) VALUES ($1, $2) RETURNING *',
      [String(username).trim().slice(0, 50), String(text).trim().slice(0, 500)]
    );
    // Рассылаем сохранённую запись (с id и created_at из БД)
    broadcast({ type: 'chat_message', data: result.rows[0] });
  } catch (err) {
    console.error('[WS] Ошибка сохранения сообщения чата:', err.message);
  }
}

module.exports = { createWsServer, broadcast };
