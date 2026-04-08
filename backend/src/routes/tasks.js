'use strict';

/**
 * ============================================================
 *  Маршруты задач (Tasks Router)
 * ============================================================
 *
 *  WebSocket-интеграция
 *  --------------------
 *  После каждой мутирующей операции (создать / обновить / удалить)
 *  мы вызываем broadcast() из wsServer.js, чтобы уведомить
 *  всех подключённых клиентов об изменении.
 *
 *  Схема потока данных:
 *    [Браузер A] --POST /api/tasks--> [Express] --INSERT--> [PostgreSQL]
 *                                         └──broadcast(task_created)──►
 *                                                    ├─► [Браузер A] (подтверждение)
 *                                                    ├─► [Браузер B] (синхронизация)
 *                                                    └─► [Браузер N] (синхронизация)
 *
 *  Формат broadcast-сообщений:
 *    { type: 'task_created', data: { ...taskObject } }
 *    { type: 'task_updated', data: { ...taskObject } }
 *    { type: 'task_deleted', data: { id: number } }
 * ============================================================
 */

const express   = require('express');
const router    = express.Router();
const { pool }  = require('../db');
const { broadcast } = require('../ws/wsServer'); // импортируем broadcast

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/tasks — получить все задачи
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('[tasks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/tasks/:id — получить задачу по ID
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[tasks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/tasks — создать задачу
//  После успешной записи в БД рассылаем broadcast 'task_created'
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { title, description } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const result = await pool.query(
      'INSERT INTO tasks (title, description) VALUES ($1, $2) RETURNING *',
      [title, description || '']
    );
    const task = result.rows[0];

    // Отвечаем клиенту, сделавшему HTTP-запрос
    res.status(201).json(task);

    // Уведомляем ВСЕ WS-соединения о новой задаче.
    // Передаём полный объект задачи, чтобы клиенты могли
    // добавить её в список без дополнительного HTTP-запроса.
    broadcast({ type: 'task_created', data: task });
  } catch (err) {
    console.error('[tasks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  PUT /api/tasks/:id — обновить задачу
//  После успешного UPDATE рассылаем broadcast 'task_updated'
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { title, description, completed } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const result = await pool.query(
      `UPDATE tasks
         SET title = $1, description = $2, completed = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [title, description || '', completed ?? false, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    const task = result.rows[0];

    res.json(task);

    // Уведомляем все вкладки: задача изменилась.
    // Клиент найдёт её в своём списке по task.id и обновит поля.
    broadcast({ type: 'task_updated', data: task });
  } catch (err) {
    console.error('[tasks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  DELETE /api/tasks/:id — удалить задачу
//  После успешного DELETE рассылаем broadcast 'task_deleted'
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM tasks WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });

    res.json({ message: 'Task deleted' });

    // Рассылаем только id удалённой задачи — этого достаточно,
    // чтобы клиенты убрали её из своих списков.
    broadcast({ type: 'task_deleted', data: { id: Number(req.params.id) } });
  } catch (err) {
    console.error('[tasks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
