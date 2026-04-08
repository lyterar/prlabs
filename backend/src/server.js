'use strict';

/**
 * ============================================================
 *  Точка входа сервера
 * ============================================================
 *
 *  Архитектура HTTP + WebSocket на одном порту
 *  -------------------------------------------
 *  Node.js позволяет держать HTTP и WebSocket на одном TCP-порту,
 *  потому что WebSocket начинается с HTTP-запроса:
 *
 *    [Браузер] --HTTP GET /ws (Upgrade: websocket)--> [Node.js]
 *
 *  Node.js смотрит на заголовок 'Upgrade' и направляет запрос
 *  либо в Express (обычный HTTP), либо в WebSocket-сервер.
 *
 *  Для этого нам нужен явный http.Server:
 *    const server = http.createServer(app)  ← передаём Express как обработчик
 *    new WebSocket.Server({ server })       ← WS слушает upgrade-события
 *
 *  Если бы мы использовали app.listen() напрямую, у нас не было бы
 *  ссылки на HTTP-сервер, и мы не смогли бы передать её в WS.
 * ============================================================
 */

const http    = require('http');    // встроенный модуль Node.js — не устанавливается
const express = require('express');
const cors    = require('cors');

const { initDB }          = require('./db');
const tasksRouter         = require('./routes/tasks');
const emailRouter         = require('./routes/email');
const chatRouter          = require('./routes/chat');
const { createWsServer }  = require('./ws/wsServer'); // наш WS-модуль

const app  = express();
const PORT = process.env.PORT || 5000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());           // разрешаем кросс-доменные запросы
app.use(express.json());   // парсим тело запроса как JSON

// ─── REST-маршруты ───────────────────────────────────────────────────────────
app.use('/api/tasks', tasksRouter);
app.use('/api/email', emailRouter);
app.use('/api/chat',  chatRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ─── HTTP-сервер ─────────────────────────────────────────────────────────────
//
// http.createServer(app) — создаём «настоящий» HTTP-сервер.
// Express-приложение передаётся как обработчик запросов (requestListener).
// Именно этот объект server нужен библиотеке ws для перехвата
// HTTP-события 'upgrade' (запрос на переключение протокола).
//
const server = http.createServer(app);

// ─── Инициализация БД → запуск сервера ───────────────────────────────────────
initDB()
  .then(() => {
    // Запускаем HTTP-сервер: теперь он слушает порт PORT
    server.listen(PORT, () => {
      console.log(`[HTTP] Сервер запущен на порту ${PORT}`);

      // После запуска HTTP-сервера создаём WebSocket-сервер на том же server.
      // createWsServer() вешает обработчик на событие 'upgrade' сервера,
      // поэтому сервер уже должен быть запущен (либо хотя бы создан).
      createWsServer(server);
    });
  })
  .catch((err) => {
    console.error('[DB] Ошибка инициализации БД:', err.message);
    process.exit(1);
  });
