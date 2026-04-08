const BASE = '/api/email';

const post = async (url, data) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Сервер вернул ошибку ${r.status}: ${text.slice(0, 120)}`);
  }
};

export const sendEmail = (data) => post(`${BASE}/send`, data);
export const fetchImapEmails = (config) => post(`${BASE}/imap`, config);
export const fetchPop3Emails = (config) => post(`${BASE}/pop3`, config);
