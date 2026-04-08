import { useState } from 'react';
import { sendEmail, fetchImapEmails, fetchPop3Emails } from '../emailApi';

// ─── helpers ──────────────────────────────────────────────────────────────────

function Field({ label, type = 'text', value, onChange, placeholder, required }) {
  return (
    <div className="field">
      <label>{label}{required && ' *'}</label>
      <input type={type} value={value} onChange={onChange} placeholder={placeholder} />
    </div>
  );
}

function ServerConfig({ config, setConfig, tlsLabel = 'Use TLS' }) {
  const upd = (key) => (e) =>
    setConfig((p) => ({ ...p, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  return (
    <div className="server-config">
      <p className="config-title">Настройки сервера</p>
      <div className="config-row">
        <div className="field field-grow">
          <label>Host *</label>
          <input value={config.host} onChange={upd('host')} placeholder="mail.example.com" />
        </div>
        <div className="field field-port">
          <label>Port</label>
          <input value={config.port} onChange={upd('port')} placeholder="993" />
        </div>
      </div>
      <div className="config-row">
        <div className="field field-grow">
          <label>Логин *</label>
          <input value={config.user} onChange={upd('user')} placeholder="user@example.com" />
        </div>
        <div className="field field-grow">
          <label>Пароль *</label>
          <input type="password" value={config.password} onChange={upd('password')} placeholder="••••••" />
        </div>
      </div>
      <div className="field field-row">
        <label>
          <input type="checkbox" checked={config.tls ?? config.secure ?? false} onChange={upd(config.tls !== undefined ? 'tls' : 'secure')} />
          &nbsp;{tlsLabel}
        </label>
      </div>
    </div>
  );
}

function InboxTable({ messages, protocol }) {
  if (messages.length === 0) return null;
  return (
    <div className="email-list">
      <p className="config-title">{protocol} — последние {messages.length} писем</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>От кого</th>
              <th>Тема</th>
              <th>Дата</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m, i) => (
              <tr key={i}>
                <td>{m.seq ?? m.num ?? i + 1}</td>
                <td className="desc">{m.from}</td>
                <td className="desc">{m.subject}</td>
                <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{m.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── SMTP tab ─────────────────────────────────────────────────────────────────

function SmtpTab({ tasks }) {
  const [cfg, setCfg] = useState({ host: '', port: '587', user: '', password: '', secure: false });
  const [mail, setMail] = useState({ to: '', subject: 'Task List', text: '', includeTaskList: true });
  const [status, setStatus] = useState(null); // null | { ok, msg }
  const [busy, setBusy] = useState(false);

  const updMail = (key) => (e) =>
    setMail((p) => ({ ...p, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const handleSend = async (e) => {
    e.preventDefault();
    setBusy(true);
    setStatus(null);

    let text = mail.text;
    if (mail.includeTaskList && tasks.length > 0) {
      text +=
        (text ? '\n\n' : '') +
        '=== Task List ===\n' +
        tasks
          .map((t, i) => `${i + 1}. [${t.completed ? 'x' : ' '}] ${t.title}${t.description ? ' — ' + t.description : ''}`)
          .join('\n');
    }

    try {
      const res = await sendEmail({ ...cfg, ...mail, text });
      if (res.error) throw new Error(res.error);
      setStatus({ ok: true, msg: `Отправлено! ID: ${res.messageId}` });
    } catch (err) {
      setStatus({ ok: false, msg: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tab-body">
      {/* Server settings */}
      <div className="server-config">
        <p className="config-title">SMTP-сервер</p>
        <div className="config-row">
          <div className="field field-grow">
            <label>Host *</label>
            <input value={cfg.host} onChange={(e) => setCfg((p) => ({ ...p, host: e.target.value }))} placeholder="smtp.gmail.com" />
          </div>
          <div className="field field-port">
            <label>Port</label>
            <input value={cfg.port} onChange={(e) => setCfg((p) => ({ ...p, port: e.target.value }))} placeholder="587" />
          </div>
        </div>
        <div className="config-row">
          <div className="field field-grow">
            <label>Логин *</label>
            <input value={cfg.user} onChange={(e) => setCfg((p) => ({ ...p, user: e.target.value }))} placeholder="user@example.com" />
          </div>
          <div className="field field-grow">
            <label>Пароль *</label>
            <input type="password" value={cfg.password} onChange={(e) => setCfg((p) => ({ ...p, password: e.target.value }))} placeholder="••••••" />
          </div>
        </div>
        <div className="field field-row">
          <label>
            <input type="checkbox" checked={cfg.secure} onChange={(e) => setCfg((p) => ({ ...p, secure: e.target.checked }))} />
            &nbsp;SSL/TLS (порт 465)
          </label>
        </div>
      </div>

      {/* Email fields */}
      <form onSubmit={handleSend}>
        <div className="field">
          <label>Кому *</label>
          <input value={mail.to} onChange={updMail('to')} placeholder="recipient@example.com" />
        </div>
        <div className="field">
          <label>Тема *</label>
          <input value={mail.subject} onChange={updMail('subject')} placeholder="Subject" />
        </div>
        <div className="field">
          <label>Текст письма</label>
          <textarea value={mail.text} onChange={updMail('text')} rows={4} placeholder="Текст сообщения..." />
        </div>
        <div className="field field-row">
          <label>
            <input type="checkbox" checked={mail.includeTaskList} onChange={updMail('includeTaskList')} />
            &nbsp;Прикрепить список задач ({tasks.length} шт.)
          </label>
        </div>

        {status && (
          <div className={`alert ${status.ok ? 'alert-success' : 'alert-error'}`}>
            {status.msg}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Отправка...' : 'Отправить (SMTP)'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── IMAP tab ─────────────────────────────────────────────────────────────────

function ImapTab() {
  const [cfg, setCfg] = useState({ host: '', port: '993', user: '', password: '', tls: true });
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleFetch = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchImapEmails(cfg);
      if (res.error) throw new Error(res.error);
      setMessages(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tab-body">
      <ServerConfig config={cfg} setConfig={setCfg} tlsLabel="Использовать TLS (порт 993)" />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-info" onClick={handleFetch} disabled={loading}>
          {loading ? 'Загрузка...' : 'Получить письма (IMAP)'}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      <InboxTable messages={messages} protocol="IMAP" />
      {!loading && !error && messages.length === 0 && (
        <p className="center muted" style={{ padding: '24px 0' }}>Нажмите кнопку для получения писем</p>
      )}
    </div>
  );
}

// ─── POP3 tab ─────────────────────────────────────────────────────────────────

function Pop3Tab() {
  const [cfg, setCfg] = useState({ host: '', port: '995', user: '', password: '', tls: true });
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleFetch = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPop3Emails(cfg);
      if (res.error) throw new Error(res.error);
      setMessages(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tab-body">
      <ServerConfig config={cfg} setConfig={setCfg} tlsLabel="Использовать TLS (порт 995)" />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-info" onClick={handleFetch} disabled={loading}>
          {loading ? 'Загрузка...' : 'Получить письма (POP3)'}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      <InboxTable messages={messages} protocol="POP3" />
      {!loading && !error && messages.length === 0 && (
        <p className="center muted" style={{ padding: '24px 0' }}>Нажмите кнопку для получения писем</p>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

const TABS = [
  { id: 'smtp', label: 'SMTP — Отправка' },
  { id: 'imap', label: 'IMAP — Входящие' },
  { id: 'pop3', label: 'POP3 — Входящие' },
];

export default function EmailPanel({ tasks, onClose }) {
  const [tab, setTab] = useState('smtp');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Почта</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab-btn ${tab === t.id ? 'tab-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="tab-content">
          {tab === 'smtp' && <SmtpTab tasks={tasks} />}
          {tab === 'imap' && <ImapTab />}
          {tab === 'pop3' && <Pop3Tab />}
        </div>
      </div>
    </div>
  );
}
