const express = require('express');
const router = express.Router();
const { log } = require('../lib/logger');
const { runSync } = require('../lib/syncRunner');
const { state, MAX_SYNC_HISTORY, pushHistory } = require('../lib/state');
const { arlo, wp, geocoder } = require('../lib/clients');

// Extracted handler logic
async function handleSync(req, res, dryRun) {
  if (state.isSyncing) {
    return res.status(409).json({ error: 'A sync is already in progress', startedAt: state.lastSync?.startedAt });
  }

  state.isSyncing = true;
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(`SYNC${dryRun ? ' DRY RUN' : ''}: triggered via API`);

  try {
    const result = await runSync(arlo, wp, geocoder, { dryRun });
    if (!dryRun) state.lastSync = result;
    pushHistory(state.syncHistory, result, MAX_SYNC_HISTORY);
    res.json(result);
  } catch (err) {
    log(`SYNC ERROR: ${err.message}`);
    res.status(500).json({ error: err.message });
  } finally {
    state.isSyncing = false;
  }
}

// Define routes using the base path '/' (which will map to /api/sync later)
router.post('/', (req, res) => handleSync(req, res, false));
router.post('/dry', (req, res) => handleSync(req, res, true));

router.get('/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, MAX_SYNC_HISTORY);
  res.json({ total: state.syncHistory.length, results: state.syncHistory.slice(0, limit) });
});

module.exports = router;