// ============================================================
// Meytopia Launcher — Lancement du jeu (CDC F4, F5, F6, F7)
// Orchestration du clic JOUER : config distante → synchro du
// pack → blocklist → Java + NeoForge + lancement (lib D9).
// ============================================================
const { app, BrowserWindow } = require('electron');
const mainWin = () => BrowserWindow.getAllWindows()[0] ?? null;
const semverLt = (a, b) => {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let k = 0; k < 3; k++) { if ((pa[k] || 0) !== (pb[k] || 0)) return (pa[k] || 0) < (pb[k] || 0); }
  return false;
};
const path = require('path');
const { Launch } = require('minecraft-java-core');
const { getGameDir } = require('./paths');
const remote = require('./remote');
const sync = require('./sync');
const content = require('./content');
const accounts = require('./accounts');
const servers = require('./servers');
const settings = require('./settings');

let emitToRenderer = () => {};
function bindEmitter(fn) { emitToRenderer = fn; }

let running = false;
const isRunning = () => running;

const setState = (state, text = '') => emitToRenderer('game:state', { state, text });

/**
 * Flux complet du bouton JOUER. Renvoie { ok, reason? } ;
 * la progression passe par les événements game:state et downloads:update.
 */
async function play() {
  if (running) return { ok: false, reason: 'already-running' };

  // 1) Compte actif obligatoire (CDC F2)
  const profile = accounts.getActiveProfile();
  if (!profile) return { ok: false, reason: 'no-account' };

  // 2) Config distante : maintenance + pointeur de modpack (CDC F14, F16)
  setState('checking', 'Vérification de la configuration…');
  const { data: config } = await remote.getLauncherConfig();

  // Verrou à distance : version minimale du launcher exigée par launcher.json (I8)
  const minVersion = config?.minLauncherVersion;
  if (minVersion && app.isPackaged && semverLt(app.getVersion(), minVersion)) {
    setState('error', `Mise à jour du launcher requise (minimum v${minVersion}).`);
    return { ok: false, reason: 'outdated' };
  }
  if (!config) return { ok: false, reason: 'offline-no-cache' };
  if (config.maintenance?.active && config.maintenance?.blockPlay !== false) {
    return { ok: false, reason: 'maintenance' };
  }
  // Verrou « serveur pas encore ouvert » : bloque tant qu'on est avant la date d'ouverture (I-gate)
  if (config.gate && config.gate.openAt) {
    const t = Date.parse(config.gate.openAt);
    if (Number.isFinite(t) && Date.now() < t) return { ok: false, reason: 'not-open' };
  }

  // 3) Synchronisation du modpack (CDC F5) — delta uniquement
  setState('syncing', 'Vérification des fichiers du modpack…');
  const { data: manifest } = await remote.getManifest(config.modpack.manifestUrl);
  if (!manifest) return { ok: false, reason: 'offline-no-cache' };

  if (remote.isOffline()) {
    // Mode dégradé : on joue avec les fichiers en l'état, sans vérification (CDC F16)
    emitToRenderer('remote:offlinePlay', true);
  } else {
    const result = await sync.syncPack(manifest);
    if (result.unknown.length) {
      content.registerDetected(result.unknown);
      emitToRenderer('content:unknown', result.unknown);
    }
    if (!result.ok && result.reason === 'disk') {
      setState('error', `Espace disque insuffisant : ${result.freeGb} Go libres, ~${result.neededGb} Go nécessaires.`);
      return { ok: false, reason: 'disk' };
    }
    if (!result.ok) {
      setState('idle');
      return { ok: false, reason: 'download-interrupted' };
    }
  }

  // 4) Blocklist : lancement bloqué tant que des fichiers interdits existent (CDC F6)
  const { data: blocklist } = await remote.getBlocklist();
  const matches = await content.scanBlocklist(blocklist ?? { entries: [] }, sync.MANAGED_DIRS);
  if (matches.length) {
    setState('blocked');
    emitToRenderer('blocklist:hit', matches);
    return { ok: false, reason: 'blocked' };
  }

  // 5) Connexion directe + serveur enregistré dans le multijoueur
  let gameArgs = [];
  try {
    const address = await servers.joinAddress(config.server ?? {});
    if (address) {
      await servers.ensureServerEntry(address, config.server?.name ?? 'Meytopia');
      if (settings.read().autoJoin !== false) {
        gameArgs = ['--quickPlayMultiplayer', address]; // Quick Play officiel (MC 1.20+)
      }
    }
  } catch { /* confort non bloquant : le jeu se lance quand même */ }

  // 6) Lancement : Java officiel Mojang + loader, gérés par la lib (CDC D7, D9, F4, F7)
  setState('launching', 'Préparation du jeu…');
  const ramGb = Number(settings.read().ramGb) || 8;
  const modpack = config.modpack ?? {};

  const launch = new Launch();
  running = true;

  launch.on('progress', (done, total, element) => {
    const pct = total ? Math.floor((done / total) * 100) : 0;
    setState('launching', `Fichiers du jeu (${element ?? '…'}) — ${pct} %`);
  });
  launch.on('check', (done, total) => {
    const pct = total ? Math.floor((done / total) * 100) : 0;
    setState('launching', `Vérification du jeu — ${pct} %`);
  });
  launch.on('extract', () => setState('launching', 'Extraction…'));
  launch.on('patch', () => setState('launching', `Installation de ${modpack.loader?.type ?? 'loader'}…`));

  let started = false;
  launch.on('data', () => {
    if (!started) {
      started = true;
      setState('ingame', 'En jeu');
      if (settings.read().minimizeOnPlay) mainWin()?.minimize(); // I4
    }
  });
  launch.on('close', () => {
    running = false;
    setState(started ? 'closed' : 'error', started ? '' : 'Le jeu s\'est fermé avant de démarrer.');
    if (settings.read().minimizeOnPlay) {
      const win = mainWin();
      if (win) { if (win.isMinimized()) win.restore(); win.focus(); } // retour du launcher (I4)
    }
  });
  launch.on('error', (err) => {
    running = false;
    setState('error', String(err?.error ?? err?.message ?? err));
  });

  try {
    await launch.Launch({
      authenticator: profile,
      timeout: 10000,
      path: getGameDir(),
      version: modpack.mcVersion,
      detached: false,
      downloadFileMultiple: 8,
      loader: {
        type: modpack.loader?.type ?? 'neoforge',
        build: modpack.loader?.version ?? 'latest',
        enable: Boolean(modpack.loader?.type),
      },
      verify: false,
      ignored: [],
      java: { type: 'jre' }, // version déduite des manifests Mojang (CDC D7)
      JVM_ARGS: [],
      GAME_ARGS: gameArgs,
      screen: {},
      memory: { min: '2G', max: `${ramGb}G` },
    });
  } catch (err) {
    running = false;
    setState('error', String(err?.message ?? err));
    return { ok: false, reason: 'launch-error' };
  }

  return { ok: true };
}

module.exports = { bindEmitter, play, isRunning };
