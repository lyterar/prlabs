const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const POP3 = require('node-pop3');
const { pool } = require('../db');

// ─── SMTP ────────────────────────────────────────────────────────────────────

async function sendMail({ host, port, user, password, secure, to, subject, text }) {
  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(port) || 587,
    secure: secure === true || secure === 'true',
    auth: { user, pass: password },
    tls: { rejectUnauthorized: false },
  });

  await transporter.verify();

  const info = await transporter.sendMail({
    from: `"ToDo App" <${user}>`,
    to,
    subject,
    text,
  });

  return { messageId: info.messageId, accepted: info.accepted };
}

// ─── IMAP ────────────────────────────────────────────────────────────────────

async function fetchImap({ host, port, user, password, tls }) {
  const secure = tls !== false && tls !== 'false';

  const client = new ImapFlow({
    host,
    port: parseInt(port) || (secure ? 993 : 143),
    secure,
    auth: { user, pass: password },
    logger: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });

  // Без этого unhandled 'error' event крашит весь процесс
  client.on('error', () => {});

  await client.connect();
  const messages = [];

  try {
    const mailbox = await client.mailboxOpen('INBOX');
    const total = mailbox.exists;

    if (total > 0) {
      const start = Math.max(1, total - 9);

      for await (const msg of client.fetch(`${start}:${total}`, { envelope: true })) {
        messages.unshift({
          seq: msg.seq,
          subject: msg.envelope.subject || '(no subject)',
          from: msg.envelope.from?.[0]?.address || '—',
          date: msg.envelope.date
            ? new Date(msg.envelope.date).toLocaleString()
            : '—',
        });
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return messages;
}

// ─── POP3 ────────────────────────────────────────────────────────────────────

async function fetchPop3({ host, port, user, password, tls }) {
  const useTls = tls === true || tls === 'true';

  const client = new POP3({
    user,
    password,
    host,
    port: parseInt(port) || (useTls ? 995 : 110),
    tls: useTls,
  });

  const messages = [];

  try {
    const statRaw = await client.STAT();
    // STAT returns string "count size" or array — handle both
    const statStr = Array.isArray(statRaw) ? statRaw[0] : String(statRaw);
    const count = parseInt(statStr.trim().split(/\s+/)[0]) || 0;

    const fetchCount = Math.min(count, 10);

    for (let i = count; i > count - fetchCount; i--) {
      try {
        const retrRaw = await client.RETR(i);
        const raw = Array.isArray(retrRaw) ? retrRaw.join('\r\n') : String(retrRaw);
        const msg = parseEmailHeaders(raw, i);
        messages.push(msg);
        await pool.query(
          'INSERT INTO emails (num, subject, "from", date) VALUES ($1, $2, $3, $4)',
          [msg.num, msg.subject, msg.from, msg.date]
        );
      } catch {
        // skip corrupted/unreadable messages
      }
    }
  } finally {
    await client.QUIT().catch(() => {});
  }

  return messages;
}

function parseEmailHeaders(raw, num) {
  const headers = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) break;
    const m = line.match(/^([\w-]+):\s*(.*)/);
    if (m) headers[m[1].toLowerCase()] = m[2].trim();
  }
  return {
    num,
    subject: headers.subject || '(no subject)',
    from: headers.from || '—',
    date: headers.date || '—',
  };
}

module.exports = { sendMail, fetchImap, fetchPop3 };
