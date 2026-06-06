const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { state } = require('../lib/state');

router.get('/', (req, res) => {
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
      approve: 'POST /api/spraying/approve',
      testRegistration: 'GET /test?id=NN',
      testEmail: 'GET /test/email',
      logs: 'GET /api/logs',
      webhook: 'POST /webhook',
    },
  });
});

router.get('/api/status', (req, res) => {
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

router.get('/api/logs', (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  // Note: Adjust path based on your folder structure if logs is at the root
  const logFile = path.join(__dirname, '../logs', `gmg-api-${date}.log`);

  if (!fs.existsSync(logFile)) {
    return res.json({ date, lines: [], message: 'No logs for this date' });
  }

  const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const tail = lines.slice(-limit);

  res.json({ date, totalLines: lines.length, showing: tail.length, lines: tail });
});

module.exports = router;