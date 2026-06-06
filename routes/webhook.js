const express = require('express');
const router = express.Router();
const { log } = require('../lib/logger');
const { state, MAX_WEBHOOK_HISTORY, pushHistory } = require('../lib/state');
const { handleRegistration } = require('../lib/registrationHandler');

router.get('/api/webhook/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, MAX_WEBHOOK_HISTORY);
  res.json({ total: state.webhookHistory.length, events: state.webhookHistory.slice(0, limit) });
});

router.post('/webhook', async (req, res) => {
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(`Webhook received: ${JSON.stringify(req.body)}`);

  res.status(200).json({ received: true });

  const events = req.body?.events || [];
  if (!events.length) {
    log('  No events in payload');
    return;
  }

  for (const event of events) {
    const { resourceType, type, resourceId } = event;
    log(`  Event: ${resourceType} | ${type} | ID ${resourceId}`);

    if (resourceType !== 'Registration') {
      log('  SKIP: not a Registration event');
      pushHistory(state.webhookHistory, { type: 'skipped', resourceType, eventType: type, resourceId, time: new Date().toISOString(), reason: 'not_registration' }, MAX_WEBHOOK_HISTORY);
      continue;
    }

    const result = await handleRegistration(resourceId);
    pushHistory(state.webhookHistory, { type: 'webhook', resourceType, eventType: type, registrationId: resourceId, time: new Date().toISOString(), result }, MAX_WEBHOOK_HISTORY);
  }

  log('Webhook processing complete');
});

module.exports = router;