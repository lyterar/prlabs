'use strict';

/**
 * GET /api/chat — история сообщений чата
 *
 * Возвращает последние 50 сообщений из таблицы messages,
 * отсортированные от старых к новым (для правильного порядка в UI).
 * Клиент загружает историю один раз при открытии чата,
 * далее новые сообщения приходят через WebSocket.
 */

const express  = require('express');
const router   = express.Router();
const { pool } = require('../db');

router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM messages ORDER BY created_at ASC LIMIT 50'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[chat]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
