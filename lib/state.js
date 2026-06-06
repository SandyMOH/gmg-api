const state = {
  startedAt: new Date().toISOString(),
  lastSync: null,
  syncHistory: [],
  webhookHistory: [],
  isSyncing: false,
};

const MAX_SYNC_HISTORY = 20;
const MAX_WEBHOOK_HISTORY = 50;

function pushHistory(array, item, max) {
  array.unshift(item);
  if (array.length > max) array.length = max;
}

module.exports = {
  state,
  MAX_SYNC_HISTORY,
  MAX_WEBHOOK_HISTORY,
  pushHistory
};