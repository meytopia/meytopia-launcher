// ============================================================
// Meytopia Launcher — Fichiers distants (CDC §3.3, F16)
// Télécharge les JSON de pilotage depuis meytopia-data, avec
// cache disque pour le mode dégradé hors ligne.
// ============================================================
const fs = require('fs');
const path = require('path');
const { REMOTE, FETCH_TIMEOUT_MS } = require('./config');
const { getLauncherDir } = require('./paths');

let offline = false; // dernier état connu du réseau vers GitHub

const cacheDir = () => path.join(getLauncherDir(), 'cache');
const cacheFile = (name) => path.join(cacheDir(), `${name}.json`);

/** Supprime un éventuel BOM avant le parse JSON. */
const parseJson = (text) => JSON.parse(text.replace(/^\uFEFF/, ''));

/** Télécharge un JSON ; en cas d'échec, retombe sur le cache disque. */
async function fetchJson(name, url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = parseJson(await res.text());
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(cacheFile(name), JSON.stringify(data));
    offline = false;
    return { data, fromCache: false };
  } catch {
    offline = true;
    try {
      return { data: parseJson(fs.readFileSync(cacheFile(name), 'utf8')), fromCache: true };
    } catch {
      return { data: null, fromCache: false };
    }
  }
}

const getLauncherConfig = () => fetchJson('launcher', REMOTE.launcher);
const getNews = () => fetchJson('news', REMOTE.news);
const getBlocklist = () => fetchJson('blocklist', REMOTE.blocklist);
const getOptional = () => fetchJson('optional', REMOTE.optional);
const getChangelog = () => fetchJson('changelog', REMOTE.changelog);

/** Le manifest est à une URL définie par launcher.json. */
async function getManifest(manifestUrl) {
  return fetchJson('manifest', manifestUrl);
}

const isOffline = () => offline;

module.exports = {
  getLauncherConfig,
  getNews,
  getBlocklist,
  getOptional,
  getChangelog,
  getManifest,
  isOffline,
};
