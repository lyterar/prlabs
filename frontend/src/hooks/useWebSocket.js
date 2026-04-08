import { useEffect, useRef, useCallback } from 'react';

/**
 * ============================================================
 *  Хук useWebSocket
 * ============================================================
 *
 *  Управляет WebSocket-соединением в React-компоненте:
 *    - подключается при монтировании
 *    - автоматически переподключается при разрыве
 *    - корректно закрывает соединение при размонтировании
 *    - экспонирует функцию send() для отправки сообщений серверу
 *
 *  Браузерный WebSocket API (без сторонних библиотек)
 *  ---------------------------------------------------
 *  Браузер реализует WebSocket нативно через window.WebSocket.
 *  Нам не нужны никакие пакеты npm на стороне клиента.
 *
 *  Жизненный цикл объекта WebSocket:
 *
 *    new WebSocket(url)
 *         │
 *         ▼  readyState = 0 (CONNECTING)
 *    onopen()
 *         │
 *         ▼  readyState = 1 (OPEN)  ◄─── можно вызывать send()
 *    onmessage() / onerror()
 *         │
 *         ▼  readyState = 2 (CLOSING)
 *    onclose(event)
 *         │
 *         ▼  readyState = 3 (CLOSED)
 *
 *  Коды закрытия (event.code в onclose):
 *    1000 — нормальное закрытие (намеренное)
 *    1001 — endpoint уходит (закрыта вкладка)
 *    1006 — аварийное (нет Close frame, разрыв TCP)
 *    1011 — внутренняя ошибка сервера
 *
 *  @param {string}   url        — WebSocket URL (ws:// или wss://)
 *  @param {function} onMessage  — коллбэк при получении сообщения
 *                                 принимает распарсенный объект { type, data }
 *  @returns {{ send: function }} — send(payload) отправляет JSON серверу
 * ============================================================
 */
export function useWebSocket(url, onMessage) {
  // ─── Refs ─────────────────────────────────────────────────────────────────
  //
  // Используем ref (не state), чтобы хранить значения без вызова ре-рендера.

  /** Текущий объект WebSocket */
  const wsRef = useRef(null);

  /** Флаг: компонент размонтирован — прекратить попытки переподключения */
  const mountedRef = useRef(true);

  /** Таймер автоматического переподключения */
  const reconnectTimerRef = useRef(null);

  /**
   * Сохраняем коллбэк onMessage в ref, чтобы useEffect с connect()
   * не перезапускался каждый раз, когда родитель передаёт новую функцию.
   * connect() стабилен (useCallback с пустым deps), но всегда вызывает
   * актуальную версию onMessage через ref.
   */
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  // ─── connect ──────────────────────────────────────────────────────────────
  /**
   * Создаёт новый WebSocket и устанавливает все обработчики событий.
   * Вызывается при монтировании и при каждом переподключении.
   */
  const connect = useCallback(() => {
    // Не подключаемся, если компонент уже размонтирован
    if (!mountedRef.current) return;

    console.log(`[WS] Подключение → ${url}`);

    // ── Создаём нативный WebSocket ──────────────────────────────────────────
    // Никаких npm-пакетов: window.WebSocket встроен во все современные браузеры.
    // Браузер сразу инициирует TCP-соединение и HTTP Upgrade-рукопожатие.
    const ws = new WebSocket(url);
    wsRef.current = ws;

    // ── onopen ─────────────────────────────────────────────────────────────
    // Вызывается, когда сервер вернул 101 Switching Protocols.
    // После этого readyState === 1 (OPEN) и можно вызывать ws.send().
    ws.onopen = () => {
      console.log('[WS] Соединение открыто');
    };

    // ── onmessage ──────────────────────────────────────────────────────────
    // event.data — строка (для текстовых фреймов), Blob или ArrayBuffer
    // для бинарных. Наш сервер всегда шлёт JSON-строки.
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        // Вызываем актуальный коллбэк через ref
        onMessageRef.current(message);
      } catch {
        console.warn('[WS] Не удалось разобрать сообщение:', event.data);
      }
    };

    // ── onclose ────────────────────────────────────────────────────────────
    // event.code   — код закрытия (см. RFC 6455 §7.4)
    // event.reason — строка с причиной (может быть пустой)
    // event.wasClean — true если соединение закрылось чисто (с Close frame)
    ws.onclose = (event) => {
      console.log(`[WS] Соединение закрыто | код: ${event.code} | чисто: ${event.wasClean}`);

      // Переподключаемся, только если:
      //  1. Компонент ещё смонтирован (mountedRef.current === true)
      //  2. Закрытие НЕ намеренное (код не 1000 — нормальное закрытие)
      if (mountedRef.current && event.code !== 1000) {
        console.log('[WS] Переподключение через 3 с…');
        reconnectTimerRef.current = setTimeout(connect, 3000);
      }
    };

    // ── onerror ────────────────────────────────────────────────────────────
    // Вызывается при ошибке. После onerror всегда следует onclose,
    // поэтому переподключение инициируем там, а здесь только логируем.
    ws.onerror = () => {
      console.error('[WS] Ошибка соединения (подробности в onclose)');
    };
  }, [url]); // connect пересоздаётся только при смене url

  // ─── useEffect: монтирование / размонтирование ───────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    connect(); // первое подключение при монтировании компонента

    return () => {
      // Cleanup: компонент размонтируется — прекращаем переподключения
      mountedRef.current = false;
      clearTimeout(reconnectTimerRef.current);

      if (wsRef.current) {
        // Код 1000 = намеренное нормальное закрытие.
        // Это предотвратит попытку переподключения в onclose.
        wsRef.current.close(1000, 'Component unmounted');
      }
    };
  }, [connect]);

  // ─── send ─────────────────────────────────────────────────────────────────
  /**
   * Отправляет JSON-сообщение на сервер.
   * Пример: send({ type: 'ping' })
   *
   * ws.readyState проверяем перед отправкой — нельзя писать в
   * не-открытое соединение (выбросит InvalidStateError).
   */
  const send = useCallback((payload) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  return { send };
}
