const express = require('express');
const router = express.Router();
const { sendMail, fetchImap, fetchPop3 } = require('../services/emailService');

// POST /api/email/send  — отправка через SMTP
router.post('/send', async (req, res) => {
  try {
    const { host, port, user, password, to, subject } = req.body;
    if (!host || !user || !password || !to || !subject) {
      return res.status(400).json({ error: 'Fields required: host, user, password, to, subject' });
    }
    const result = await sendMail(req.body);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[email]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/email/imap  — получение писем через IMAP
router.post('/imap', async (req, res) => {
  try {
    const { host, user, password } = req.body;
    if (!host || !user || !password) {
      return res.status(400).json({ error: 'Fields required: host, user, password' });
    }
    const messages = await fetchImap(req.body);
    res.json(messages);
  } catch (err) {
    console.error('[email]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/email/pop3  — получение писем через POP3
router.post('/pop3', async (req, res) => {
  try {
    const { host, user, password } = req.body;
    if (!host || !user || !password) {
      return res.status(400).json({ error: 'Fields required: host, user, password' });
    }
    const messages = await fetchPop3(req.body);
    res.json(messages);
  } catch (err) {
    console.error('[email]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
