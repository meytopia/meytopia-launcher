// ============================================================
// Meytopia Launcher — Mise à jour du launcher (CDC F3, P8)
// electron-updater + GitHub Releases. Obligatoire avant de
// jouer, non bloquante pour la navigation. Inactif en dev.
// ============================================================
const { app } = require('electron');
const settings = require('./settings');

let emitToRenderer = () => {};
function bindEmitter(fn) { emitToRenderer = fn; }

let status = { state: 'none', percent: 0 }; // none | checking | available | downloading | ready | error | dev
const getStatus = () => status;
const setStatus = (next) => { status = { ...status, ...next }; emitToRenderer('updater:status', status); };

/** Le jeu est-il bloqué par une mise à jour obligatoire ? (CDC F3) */
const updateRequired = () => ['available', 'downloading', 'ready'].includes(status.state);

let autoUpdater = null;
let lastCheckMs = 0; // dernière vérification lancée (auto, focus ou manuelle)

/** Canal de mise à jour : stable (latest) ou bêta, selon le réglage — relu avant chaque vérification. */
function applyChannel() {
  if (!autoUpdater) return;
  const beta = settings.read().betaChannel === true;
  autoUpdater.allowPrerelease = beta;
  autoUpdater.channel = beta ? 'beta' : 'latest';
}

function init() {
  if (!app.isPackaged) { status = { state: 'dev' }; return; } // en développement : rien à mettre à jour

  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  applyChannel();

  autoUpdater.on('checking-for-update', () => {
    if (!updateRequired()) setStatus({ state: 'checking' });
  });
  autoUpdater.on('update-available', (info) => setStatus({ state: 'available', percent: 0, newVersion: info?.version ?? null, checkError: false }));
  autoUpdater.on('download-progress', (p) => setStatus({
    state: 'downloading',
    percent: Math.floor(p.percent),
    bytesPerSecond: Math.round(p.bytesPerSecond ?? 0),
    transferred: p.transferred ?? 0,
    total: p.total ?? 0,
  }));
  autoUpdater.on('update-downloaded', () => setStatus({ state: 'ready', percent: 100 }));
  autoUpdater.on('update-not-available', () => setStatus({ state: 'none', percent: 0, newVersion: null, checkedAt: Date.now(), checkError: false }));
  autoUpdater.on('error', () => {
    if (status.state === 'none' || status.state === 'checking') setStatus({ state: 'none', checkError: true });
    else setStatus({ state: 'error' });
  });

  lastCheckMs = Date.now();
  autoUpdater.checkForUpdates().catch(() => {});
  // Vérification automatique toutes les 30 minutes : inutile d'interroger le CDN chaque minute
  // (règle « le PC du joueur d'abord ») — le retour de focus et le clic JOUER couvrent l'entre-deux.
  setInterval(() => { check(); }, 30 * 60 * 1000);
}

function check() {
  if (!autoUpdater) return;
  lastCheckMs = Date.now();
  applyChannel();
  autoUpdater.checkForUpdates().catch(() => {});
}

/** Re-vérification quand la fenêtre reprend le focus — au plus une fois toutes les 5 minutes
 *  (un joueur qui alterne entre le jeu et le launcher ne doit pas mitrailler le CDN). */
function focusCheck() {
  if (!autoUpdater) return;
  if (Date.now() - lastCheckMs < 5 * 60 * 1000) return;
  check();
}

/** « Redémarrer et installer » (CDC F3). */
function quitAndInstall() {
  // Installation silencieuse + relance automatique : pas de fenêtre d'installeur
  if (autoUpdater && status.state === 'ready') autoUpdater.quitAndInstall(true, true);
}

module.exports = { bindEmitter, init, check, focusCheck, quitAndInstall, getStatus, updateRequired };
