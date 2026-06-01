require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const { log } = require('./lib/logger');
const ArloClient = require('./lib/arloClient');
const WpClient = require('./lib/wpClient');
const Geocoder = require('./lib/geocoder');
const { processApplicator } = require('./lib/processor');
const { sendCongratulationsEmail } = require('./lib/emailSender');
const { runSync } = require('./lib/syncRunner');

const PORT = process.env.PORT || 3000;

// ===== Initialize shared clients =====
const arlo = new ArloClient({
  clientId: process.env.ARLO_CLIENT_ID,
  clientSecret: process.env.ARLO_CLIENT_SECRET,
  platform: process.env.ARLO_PLATFORM,
  refreshToken: process.env.ARLO_REFRESH_TOKEN,
});

const wp = new WpClient({
  url: process.env.WP_URL,
  user: process.env.WP_USER,
  appPassword: process.env.WP_APP_PASSWORD,
});

const geocoder = new Geocoder(process.env.GOOGLE_API_KEY);

// ===== In-memory state for the UI =====
const state = {
  startedAt: new Date().toISOString(),
  lastSync: null,
  syncHistory: [],       // last 20 sync results
  webhookHistory: [],    // last 50 webhook events
  isSyncing: false,
};

const MAX_SYNC_HISTORY = 20;
const MAX_WEBHOOK_HISTORY = 50;

// ===== Process one registration by ID (webhook/test) =====
async function handleRegistration(registrationId) {
  log(`Processing registration ${registrationId}...`);

  let reg;
  try {
    reg = await arlo.fetchRegistration(registrationId);
  } catch (err) {
    log(`  ERROR fetching registration ${registrationId}: ${err.message}`);
    return { ok: false, reason: 'fetch_failed', error: err.message };
  }

  const data = arlo.extractApplicator(reg);
  if (!data) {
    log(`  No data extracted for registration ${registrationId}`);
    return { ok: false, reason: 'no_data' };
  }

  log(`  ${data.firstName} ${data.lastName} | ${data.courseCode} | outcome: ${data.outcome}`);

  const result = await processApplicator(data, { wp, geocoder }, { dryRun: false });

  return {
    ...result,
    name: `${data.firstName} ${data.lastName}`.trim(),
    email: data.email,
    company: data.company,
    courseCode: data.courseCode,
    outcome: data.outcome,
  };
}

// ===== Express server =====
const app = express();
app.use(express.json());

// ------ Health check ------
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    service: 'GMG API',
    uptime: process.uptime(),
    time: new Date().toISOString(),
    isSyncing: state.isSyncing,
    endpoints: {
      health: 'GET /',
      status: 'GET /api/status',
      sync: 'POST /api/sync',
      syncDry: 'POST /api/sync/dry',
      syncHistory: 'GET /api/sync/history',
      webhookHistory: 'GET /api/webhook/history',
      testRegistration: 'GET /test?id=NN',
      webhook: 'POST /webhook',
    },
  });
});

// ============================
//  SYNC API ROUTES
// ============================

// GET /api/status - overall status for the dashboard
app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    uptime: Math.round(process.uptime()),
    startedAt: state.startedAt,
    isSyncing: state.isSyncing,
    lastSync: state.lastSync
      ? {
          completedAt: state.lastSync.completedAt,
          durationMs: state.lastSync.durationMs,
          dryRun: state.lastSync.dryRun,
          success: state.lastSync.success,
          created: state.lastSync.wordpress.created,
          updated: state.lastSync.wordpress.updated,
          unchanged: state.lastSync.wordpress.unchanged,
          skipped: state.lastSync.wordpress.skipped,
          errors: state.lastSync.wordpress.errors,
        }
      : null,
    totalSyncs: state.syncHistory.length,
    totalWebhooks: state.webhookHistory.length,
  });
});

// POST /api/sync - run a real sync
app.post('/api/sync', async (req, res) => {
  if (state.isSyncing) {
    return res.status(409).json({
      error: 'A sync is already in progress',
      startedAt: state.lastSync?.startedAt,
    });
  }

  state.isSyncing = true;
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('SYNC: triggered via API');

  try {
    const result = await runSync(arlo, wp, geocoder, { dryRun: false });

    state.lastSync = result;
    state.syncHistory.unshift(result);
    if (state.syncHistory.length > MAX_SYNC_HISTORY) {
      state.syncHistory = state.syncHistory.slice(0, MAX_SYNC_HISTORY);
    }

    res.json(result);
  } catch (err) {
    log(`SYNC ERROR: ${err.message}`);
    res.status(500).json({ error: err.message });
  } finally {
    state.isSyncing = false;
  }
});

// POST /api/sync/dry - run a dry run sync
app.post('/api/sync/dry', async (req, res) => {
  if (state.isSyncing) {
    return res.status(409).json({
      error: 'A sync is already in progress',
    });
  }

  state.isSyncing = true;
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('SYNC DRY RUN: triggered via API');

  try {
    const result = await runSync(arlo, wp, geocoder, { dryRun: true });

    state.syncHistory.unshift(result);
    if (state.syncHistory.length > MAX_SYNC_HISTORY) {
      state.syncHistory = state.syncHistory.slice(0, MAX_SYNC_HISTORY);
    }

    res.json(result);
  } catch (err) {
    log(`SYNC ERROR: ${err.message}`);
    res.status(500).json({ error: err.message });
  } finally {
    state.isSyncing = false;
  }
});

// GET /api/sync/history - last N sync results
app.get('/api/sync/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, MAX_SYNC_HISTORY);
  res.json({
    total: state.syncHistory.length,
    results: state.syncHistory.slice(0, limit),
  });
});

// ============================
//  WEBHOOK ROUTES
// ============================

// GET /api/webhook/history - last N webhook events
app.get('/api/webhook/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, MAX_WEBHOOK_HISTORY);
  res.json({
    total: state.webhookHistory.length,
    events: state.webhookHistory.slice(0, limit),
  });
});

// GET /test - manually process a registration (testing)
app.get('/test', async (req, res) => {
  const id = req.query.id;
  if (!id) {
    return res.status(400).json({ error: 'Provide a registration ID: /test?id=32' });
  }

  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(`TEST: manual trigger for registration ${id}`);

  const result = await handleRegistration(id);

  // Store in webhook history
  state.webhookHistory.unshift({
    type: 'test',
    registrationId: id,
    time: new Date().toISOString(),
    result,
  });
  if (state.webhookHistory.length > MAX_WEBHOOK_HISTORY) {
    state.webhookHistory = state.webhookHistory.slice(0, MAX_WEBHOOK_HISTORY);
  }

  res.json(result);
});

// GET /test/email - preview the congratulations email
app.get('/test/email', async (req, res) => {
  const name = req.query.name || 'Test';
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(`TEST EMAIL: sending sample to test recipient (name: ${name})`);

  const result = await sendCongratulationsEmail({
    firstName: name,
    lastName: 'Applicant',
    email: 'real-applicant@example.com',
  });

  res.json({
    message: 'Test email attempt complete',
    result,
  });
});

// POST /webhook - receives Arlo webhook events
app.post('/webhook', async (req, res) => {
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('Webhook received');
  log(`Payload: ${JSON.stringify(req.body)}`);

  // Acknowledge immediately
  res.status(200).json({ received: true });

  const events = req.body?.events || [];
  if (events.length === 0) {
    log('  No events in payload');
    return;
  }

  for (const event of events) {
    const { resourceType, type, resourceId } = event;
    log(`  Event: ${resourceType} | ${type} | ID ${resourceId}`);

    if (resourceType !== 'Registration') {
      log('  SKIP: not a Registration event');

      state.webhookHistory.unshift({
        type: 'skipped',
        resourceType,
        eventType: type,
        resourceId,
        time: new Date().toISOString(),
        reason: 'not_registration',
      });
      continue;
    }

    const result = await handleRegistration(resourceId);

    state.webhookHistory.unshift({
      type: 'webhook',
      resourceType,
      eventType: type,
      registrationId: resourceId,
      time: new Date().toISOString(),
      result,
    });

    if (state.webhookHistory.length > MAX_WEBHOOK_HISTORY) {
      state.webhookHistory = state.webhookHistory.slice(0, MAX_WEBHOOK_HISTORY);
    }
  }

  log('Webhook processing complete');
});

// ============================
//  LOGS API
// ============================

// GET /api/logs - read today's log file
app.get('/api/logs', (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const logFile = path.join(__dirname, 'logs', `gmg-api-${date}.log`);

  if (!fs.existsSync(logFile)) {
    return res.json({ date, lines: [], message: 'No logs for this date' });
  }

  const content = fs.readFileSync(logFile, 'utf-8');
  const lines = content.split('\n').filter(Boolean);

  // Return last N lines (default 100)
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const tail = lines.slice(-limit);

  res.json({
    date,
    totalLines: lines.length,
    showing: tail.length,
    lines: tail,
  });
});

// ===== Start =====
app.listen(PORT, () => {
  log('');
  log('========================================');
  log('  GMG API');
  log('========================================');
  log(`  Port:    ${PORT}`);
  log('');
  log('  Endpoints:');
  log(`  GET  /                    Health check`);
  log(`  GET  /api/status          Dashboard status`);
  log(`  POST /api/sync            Run sync`);
  log(`  POST /api/sync/dry        Run dry sync`);
  log(`  GET  /api/sync/history    Sync history`);
  log(`  GET  /api/webhook/history Webhook history`);
  log(`  GET  /api/logs            View logs`);
  log(`  GET  /test?id=NN          Test a registration`);
  log(`  GET  /test/email          Test congratulations email`);
  log(`  POST /webhook             Arlo webhook`);
  log('========================================');
  log('');
});
