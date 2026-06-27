// ============================================================
// Meytopia Launcher — Configuration codée en dur
// SEUL endroit où le dépôt de données est référencé.
// ============================================================
const DATA_OWNER = 'meytopia';
const DATA_REPO = 'meytopia-data';

const RAW_BASE = `https://raw.githubusercontent.com/${DATA_OWNER}/${DATA_REPO}/main`;
const STATS_URL = `https://raw.githubusercontent.com/${DATA_OWNER}/${DATA_REPO}/stats/stats-serveur.json`;
const LIVE_URL = `https://raw.githubusercontent.com/${DATA_OWNER}/${DATA_REPO}/stats/live.json`;

module.exports = {
  DATA_OWNER,
  DATA_REPO,
  STATS_URL,
  LIVE_URL,
  REMOTE: {
    launcher: `${RAW_BASE}/launcher.json`,
    news: `${RAW_BASE}/news.json`,
    blocklist: `${RAW_BASE}/blocklist.json`,
    optional: `${RAW_BASE}/optional.json`,
    changelog: `${RAW_BASE}/changelog.json`,
  },
  FETCH_TIMEOUT_MS: 15000,
  PARALLEL_DOWNLOADS: 3, // CDC F10
  DOWNLOAD_RETRIES: 2,   // CDC §7
};
