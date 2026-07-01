const express = require('express');
const router = express.Router();
const { log } = require('../lib/logger');
const { state, MAX_WEBHOOK_HISTORY, pushHistory } = require('../lib/state');
const { handleRegistration } = require('../lib/registrationHandler');
const { sendWelcomeEmail } = require('../lib/emailSender');
const { arlo } = require('../lib/clients');

router.get('/', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Provide a registration ID: /test?id=32' });

  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(`TEST: manual trigger for registration ${id}`);

  const result = await handleRegistration(id);
  pushHistory(state.webhookHistory, { type: 'test', registrationId: id, time: new Date().toISOString(), result }, MAX_WEBHOOK_HISTORY);

  res.json(result);
});

router.get('/arlo-registration', async (req, res) => {
  const id = req.query.id || '35';
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(`TEST ARLO: fetching registration ${id}`);

  try {
    const raw = await arlo.fetchRegistration(id);
    const extracted = arlo.extractApplicator(raw);
    res.json({ raw, extracted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/email', async (req, res) => {
  const name = req.query.name || 'Test';
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(`TEST EMAIL: sending sample to test recipient (name: ${name})`);

  const result = await sendWelcomeEmail({ fullName: `${name} Applicant`, email: 'real-applicant@example.com', uniqueCode: null });
  res.json({ message: 'Test email attempt complete', result });
});

module.exports = router;