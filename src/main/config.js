// ============================================================
// Meytopia Launcher — Configuration codée en dur
// SEUL endroit où le dépôt de données est référencé.
// __GITHUB_USER__ est remplacé par la commande d'installation.
// ============================================================
const DATA_OWNER = '__GITHUB_USER__';
const DATA_REPO = 'meytopia-data';

const RAW_BASE = `https://raw.githubusercontent.com/${DATA_OWNER}/${DATA_REPO}/main`;

module.exports = {
  DATA_OWNER,
  DATA_REPO,
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
