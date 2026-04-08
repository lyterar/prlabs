import { useState, useEffect, useRef } from 'react';

export default function ChatPanel({ messages, onSend, onClose }) {
  const [username, setUsername] = useState(
    () => localStorage.getItem('chatUsername') || ''
  );
  const [nameInput, setNameInput] = useState('');
  const [text, setText] = useState('');
  const bottomRef = useRef(null);

  // автоскролл при новом сообщении
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const saveName = () => {
    const name = nameInput.trim();
    if (!name) return;
    localStorage.setItem('chatUsername', name);
    setUsername(name);
    setNameInput('');
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || !username) return;
    onSend(username, trimmed);
    setText('');
  };

  // Enter — отправить, Shift+Enter — перенос строки
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (iso) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-chat" onClick={(e) => e.stopPropagation()}>

        <div className="modal-header">
          <h2>Чат</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {!username && (
          <div className="chat-name-setup">
            <p>Введите имя для чата:</p>
            <div className="chat-name-row">
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveName()}
                placeholder="Ваше имя"
                autoFocus
                maxLength={50}
              />
              <button className="btn btn-primary" onClick={saveName}>Войти</button>
            </div>
          </div>
        )}

        {username && (
          <div className="chat-username-bar">
            <span>Вы: <strong>{username}</strong></span>
            <button
              className="btn btn-sm"
              onClick={() => { localStorage.removeItem('chatUsername'); setUsername(''); }}
            >
              Сменить
            </button>
          </div>
        )}

        <div className="chat-messages">
          {messages.length === 0 && (
            <p className="chat-empty">Сообщений пока нет. Начните общение!</p>
          )}
          {messages.map((msg) => {
            const isOwn = msg.username === username;
            return (
              <div key={msg.id} className={`chat-bubble ${isOwn ? 'chat-bubble-own' : 'chat-bubble-other'}`}>
                {!isOwn && <span className="chat-author">{msg.username}</span>}
                <div className="chat-text">{msg.text}</div>
                <span className="chat-time">{formatTime(msg.created_at)}</span>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div className="chat-input-row">
          <textarea
            className="chat-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={username ? 'Сообщение… (Enter — отправить)' : 'Сначала введите имя'}
            disabled={!username}
            maxLength={500}
            rows={2}
          />
          <button
            className="btn btn-primary chat-send-btn"
            onClick={handleSend}
            disabled={!username || !text.trim()}
          >
            Отправить
          </button>
        </div>

      </div>
    </div>
  );
}
