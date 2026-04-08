import { useState, useEffect, useCallback } from 'react';
import { getTasks, deleteTask } from './api';
import { useWebSocket } from './hooks/useWebSocket';
import TaskForm from './components/TaskForm';
import TaskDetail from './components/TaskDetail';
import EmailPanel from './components/EmailPanel';
import ChatPanel from './components/ChatPanel';

/**
 * Строим WebSocket URL относительно текущего хоста:
 *
 *   window.location.host  → "localhost:80"  или  "myapp.com"
 *   window.location.protocol → "http:" или "https:"
 *
 * Правило: если страница открыта по HTTPS — используем WSS (зашифрованный),
 * если по HTTP — WS. Это не даст браузеру заблокировать "mixed content".
 *
 * В продакшене (Docker + Nginx):
 *   страница: http://localhost/ → WS URL: ws://localhost/ws
 *   Nginx проксирует /ws → ws://todo-backend:5000/ws
 *
 * В разработке (если бэкенд доступен напрямую на 5000):
 *   замените WS_URL на 'ws://localhost:5000/ws'
 */
const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTOCOL}//${window.location.host}/ws`;

export default function App() {
  const [tasks, setTasks]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [modal, setModal]     = useState(null);
  // Сообщения чата: загружаются при открытии + дополняются через WS
  const [messages, setMessages] = useState([]);

  // Индикатор статуса WS-соединения для пользователя
  const [wsStatus, setWsStatus] = useState('connecting'); // 'connecting' | 'online' | 'offline'

  // ─── Начальная загрузка задач через REST ──────────────────────────────────
  const fetchTasks = async () => {
    try {
      setLoading(true);
      const data = await getTasks();
      setTasks(data);
      setError(null);
    } catch {
      setError('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTasks(); }, []);

  // Загружаем историю чата при открытии панели
  useEffect(() => {
    if (modal?.type !== 'chat') return;
    fetch('/api/chat')
      .then((r) => r.json())
      .then((data) => setMessages(data))
      .catch(() => {});
  }, [modal?.type]);

  // ─── Обработчик WebSocket-сообщений ───────────────────────────────────────
  //
  // useCallback с [] — функция создаётся один раз, не пересоздаётся при
  // ре-рендерах, поэтому useWebSocket не будет переподключаться из-за неё.
  //
  // Каждое сообщение имеет формат: { type: string, data: any }
  //
  const handleWsMessage = useCallback((message) => {
    const { type, data } = message;

    switch (type) {

      // ── Сервер подтвердил соединение ────────────────────────────────────
      case 'connected':
        console.log('[WS] Сервер:', data.message);
        setWsStatus('online');
        break;

      // ── Ответ на наш ping ───────────────────────────────────────────────
      case 'pong':
        console.log('[WS] pong:', data.timestamp);
        break;

      // ── Создана новая задача ────────────────────────────────────────────
      // Добавляем в начало только если её ещё нет (дедупликация):
      // пользователь, создавший задачу, уже получил её через fetchTasks(),
      // для остальных вкладок — это новая запись.
      case 'task_created':
        setTasks((prev) =>
          prev.some((t) => t.id === data.id) ? prev : [data, ...prev]
        );
        break;

      // ── Задача обновлена ────────────────────────────────────────────────
      // Заменяем по id. Если её нет в списке (редкий случай) — добавляем.
      case 'task_updated':
        setTasks((prev) =>
          prev.some((t) => t.id === data.id)
            ? prev.map((t) => (t.id === data.id ? data : t))
            : [data, ...prev]
        );
        break;

      // ── Задача удалена ──────────────────────────────────────────────────
      // filter идемпотентен: если запись уже убрана через handleDelete — нет эффекта.
      case 'task_deleted':
        setTasks((prev) => prev.filter((t) => t.id !== data.id));
        break;

      // ── Новое сообщение чата ────────────────────────────────────────────
      // Сервер рассылает его всем клиентам после сохранения в БД.
      // Дедуплицируем по id на случай если сообщение уже добавлено.
      case 'chat_message':
        setMessages((prev) =>
          prev.some((m) => m.id === data.id) ? prev : [...prev, data]
        );
        break;

      default:
        console.log('[WS] Неизвестный тип сообщения:', type);
    }
  }, []);

  // ─── Подключаем WebSocket-хук ─────────────────────────────────────────────
  //
  // useWebSocket управляет соединением: подключается, переподключается
  // при обрыве, закрывает соединение при размонтировании App.
  //
  // send() используем для отправки ping (можно расширить).
  //
  const { send } = useWebSocket(WS_URL, handleWsMessage);

  // Когда WS-соединение падает (onclose в хуке), статус меняем на 'offline'.
  // Восстанавливается автоматически при следующем успешном 'connected'.
  // Простой способ отследить отключение — наблюдать за тем, что send
  // вернули из хука. Но удобнее расширить хук — здесь покажем простой вариант:
  // при потере connected-сообщения через таймаут ставим offline.
  useEffect(() => {
    // Если статус 'connecting' больше 5 секунд — сервер недоступен
    const timer = setTimeout(() => {
      setWsStatus((s) => (s === 'connecting' ? 'offline' : s));
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  // ─── Обработчики действий ────────────────────────────────────────────────
  const handleDelete = async (id) => {
    if (!confirm('Delete this task?')) return;
    try {
      await deleteTask(id);
      // Сразу убираем из списка (не ждём WS-broadcast):
      // тот кто удалил видит результат мгновенно через HTTP-ответ.
      // Когда придёт broadcast 'task_deleted' — фильтр не найдёт запись
      // и массив не изменится (идемпотентно).
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch {
      alert('Failed to delete task');
    }
  };

  // Отправляем сообщение чата через существующее WS-соединение
  const handleChatSend = useCallback((username, text) => {
    send({ type: 'chat_message', username, text });
  }, [send]);

  const handleSaved = () => {
    setModal(null);
    // Перезагружаем список через REST для пользователя, который сохранил задачу.
    // Другие вкладки получат обновление через WS-broadcast.
    // WS-хэндлеры дедуплицируют данные, поэтому двойного добавления не будет.
    fetchTasks();
  };

  // Цвет и текст индикатора WS-статуса
  const statusStyle = {
    online:     { color: '#22c55e', label: '● WS' },
    offline:    { color: '#ef4444', label: '○ WS' },
    connecting: { color: '#f59e0b', label: '◌ WS' },
  }[wsStatus];

  return (
    <div className="app">
      <header>
        <h1>
          ToDo List{' '}
          {/* Индикатор WebSocket-соединения */}
          <span
            title={`WebSocket: ${wsStatus}`}
            style={{ fontSize: '0.6em', color: statusStyle.color, marginLeft: 8 }}
          >
            {statusStyle.label}
          </span>
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Ping-кнопка для ручной проверки соединения */}
          <button
            className="btn"
            style={{ fontSize: '0.8em', opacity: 0.7 }}
            title="Проверить WS-соединение"
            onClick={() => send({ type: 'ping' })}
          >
            Ping WS
          </button>
          <button className="btn btn-chat" onClick={() => setModal({ type: 'chat' })}>
            ✦ Чат
          </button>
          <button className="btn btn-email" onClick={() => setModal({ type: 'email' })}>
            ✉ Почта
          </button>
          <button className="btn btn-primary" onClick={() => setModal({ type: 'form' })}>
            + Add Task
          </button>
        </div>
      </header>

      <main>
        {loading && <p className="center">Loading...</p>}
        {error && <p className="center error">{error}</p>}
        {!loading && !error && tasks.length === 0 && (
          <p className="center muted">No tasks yet. Add one!</p>
        )}
        {!loading && tasks.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Title</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id} className={task.completed ? 'done' : ''}>
                    <td>{task.id}</td>
                    <td>{task.title}</td>
                    <td className="desc">{task.description || '—'}</td>
                    <td>
                      <span className={`badge ${task.completed ? 'badge-done' : 'badge-todo'}`}>
                        {task.completed ? 'Done' : 'To Do'}
                      </span>
                    </td>
                    <td>{new Date(task.created_at).toLocaleDateString()}</td>
                    <td className="actions">
                      <button
                        className="btn btn-sm btn-info"
                        onClick={() => setModal({ type: 'detail', id: task.id })}
                      >
                        View
                      </button>
                      <button
                        className="btn btn-sm btn-warning"
                        onClick={() => setModal({ type: 'form', task })}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDelete(task.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {modal?.type === 'form' && (
        <TaskForm
          task={modal.task}
          onSaved={handleSaved}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'detail' && (
        <TaskDetail
          id={modal.id}
          onClose={() => setModal(null)}
          onEdit={(task) => setModal({ type: 'form', task })}
        />
      )}
      {modal?.type === 'email' && (
        <EmailPanel tasks={tasks} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'chat' && (
        <ChatPanel
          messages={messages}
          onSend={handleChatSend}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
