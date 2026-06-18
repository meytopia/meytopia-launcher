// ============================================================
// Meytopia Launcher — Processus principal
// Réfère au cahier des charges : §3.1 (architecture), §5.2 (fenêtre)
// ============================================================
const { app, BrowserWindow, ipcMain, shell, dialog, nativeTheme, Notification, Tray, Menu, screen } = require('electron');
const path = require('path');
const os = require('os');
const accounts = require('./accounts');
const settings = require('./settings');
const remote = require('./remote');
const sync = require('./sync');
const content = require('./content');
const downloads = require('./downloads');
const game = require('./game');
const updater = require('./updater');
const { getServerStatus } = require('./serverStatus');
const { getGameDir, getLauncherDir } = require('./paths');
const fs = require('fs');

// Filet de sécurité : une promesse égarée (y compris à l'intérieur des
// bibliothèques, ex. rafraîchissement Microsoft) ne doit jamais afficher
// d'avertissement effrayant ni menacer l'application — on journalise, point.
process.on('unhandledRejection', (reason) => {
  console.warn('[promesse non geree]', reason?.message ?? reason);
});

// Filet pour les erreurs synchrones imprevues : on les journalise au lieu de laisser
// l'application se fermer brutalement. Le launcher reste ouvert et utilisable.
process.on('uncaughtException', (err) => {
  console.error('[erreur non geree]', err?.stack ?? err?.message ?? err);
});

// Identité Windows : nécessaire aux notifications et à la barre des tâches (I2, I14)
app.setAppUserModelId('fr.meytopia.launcher');

let mainWindow = null;
let tray = null;
let quitting = false;
app.on('before-quit', () => { quitting = true; });

/** Icône de la zone de notification : Ouvrir / Jouer / Quitter (J8). */
function setupTray() {
  if (tray) return;
  tray = new Tray(path.join(__dirname, '..', 'renderer', 'assets', 'logo.png'));
  tray.setToolTip('Meytopia Launcher');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: 'Jouer', click: () => { mainWindow?.show(); mainWindow?.focus(); emitToRenderer('tray:play'); } },
    { type: 'separator' },
    { label: 'Quitter', click: () => app.quit() },
  ]));
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

/** Émet un événement vers l'interface (utilisé par tous les modules). */
function emitToRenderer(channel, payload) {
  // Progression dans la barre des tâches Windows (I14)
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (channel === 'downloads:update') {
      const ratio = payload?.active && payload?.global?.totalBytes > 0
        ? Math.min(payload.global.doneBytes / payload.global.totalBytes, 1) : -1;
      mainWindow.setProgressBar(ratio);
    } else if (channel === 'updater:status') {
      mainWindow.setProgressBar(payload?.state === 'downloading' ? Math.min((payload.percent ?? 0) / 100, 1) : -1);
    }
    mainWindow.webContents.send(channel, payload);
  }
}
downloads.bindEmitter(emitToRenderer);
game.bindEmitter(emitToRenderer);
updater.bindEmitter(emitToRenderer);

const broadcastAccounts = () => emitToRenderer('accounts:changed', accounts.summary());

// Une seule instance du launcher à la fois (CDC §7)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  const themePref = settings.read().theme ?? 'dark';
  const isLight = themePref === 'light' || (themePref === 'system' && !nativeTheme.shouldUseDarkColors);
  const remembered = settings.read().windowState ?? null;
  mainWindow = new BrowserWindow({
    width: Number.isFinite(remembered?.width) ? Math.max(1100, Math.round(remembered.width)) : 1280,
    height: Number.isFinite(remembered?.height) ? Math.max(700, Math.round(remembered.height)) : 768,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    backgroundColor: isLight ? '#F3F0FA' : '#120D1F',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'logo.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Console de débogage uniquement en développement (jamais en version installée)
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Tout lien externe s'ouvre dans le navigateur, jamais dans le launcher (CDC §3.1)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Etat de la fenetre (agrandie / plein ecran) pour l'interface (B1, B2)
  const sendWindowState = () => emitToRenderer('window:state', {
    maximized: mainWindow?.isMaximized() ?? false,
    fullscreen: mainWindow?.isFullScreen() ?? false,
  });
  ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'].forEach((event) =>
    mainWindow.on(event, sendWindowState));

  // Fenêtre qui se souvient : position, taille, état agrandi (J7)
  const savedState = settings.read().windowState ?? null;
  if (Number.isFinite(savedState?.x) && Number.isFinite(savedState?.y)) {
    const onScreen = screen.getAllDisplays().some((d) =>
      savedState.x >= d.workArea.x - 8 && savedState.y >= d.workArea.y - 8 &&
      savedState.x < d.workArea.x + d.workArea.width && savedState.y < d.workArea.y + d.workArea.height);
    if (onScreen) mainWindow.setPosition(Math.round(savedState.x), Math.round(savedState.y));
  }
  if (savedState?.maximized) mainWindow.maximize();
  let windowStateTimer = null;
  const persistWindowState = () => {
    clearTimeout(windowStateTimer);
    windowStateTimer = setTimeout(() => {
      if (!mainWindow) return;
      const bounds = mainWindow.getNormalBounds();
      settings.write({ windowState: { ...bounds, maximized: mainWindow.isMaximized() } });
    }, 600);
  };
  ['resize', 'move', 'maximize', 'unmaximize'].forEach((ev) => mainWindow.on(ev, persistWindowState));

  // « Garder en arrière-plan » : fermer cache la fenêtre, le launcher veille (J8)
  mainWindow.on('close', (event) => {
    if (!quitting && settings.read().minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

/* ── IPC : fenêtre ──────────────────────────────────────────── */
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:close', () => mainWindow?.close());
ipcMain.on('window:maximize-toggle', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:fullscreen-toggle', () => {
  mainWindow?.setFullScreen(!mainWindow.isFullScreen());
});

/* ── IPC : application / système ───────────────────────────── */
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('system:info', () => ({
  totalRamGb: Math.round(os.totalmem() / (1024 ** 3)),
  dataDir: require('./paths').getDataDir(),
}));
ipcMain.handle('shell:openExternal', (_e, url) => {
  if (typeof url === 'string' && url.startsWith('https://')) shell.openExternal(url);
});

/* ── IPC : réglages (CDC §6.7) ─────────────────────────────── */
ipcMain.handle('settings:get', () => settings.read());
ipcMain.handle('settings:set', (_e, patch) => {
  if (patch && typeof patch === 'object') return settings.write(patch);
  return settings.read();
});

/* ── IPC : comptes Microsoft (CDC F2) ──────────────────────── */
ipcMain.handle('accounts:list', () => accounts.summary());
ipcMain.handle('accounts:add', async () => {
  const result = await accounts.add();
  broadcastAccounts();
  return result;
});
ipcMain.handle('accounts:remove', (_e, uuid) => {
  if (typeof uuid !== 'string') return;
  accounts.remove(uuid);
  broadcastAccounts();
});
ipcMain.handle('accounts:select', (_e, uuid) => {
  if (typeof uuid !== 'string') return;
  accounts.select(uuid);
  broadcastAccounts();
});

/* ── IPC : config distante et statut serveur (CDC F8, F14) ─── */
ipcMain.handle('remote:config', async () => {
  const { data } = await remote.getLauncherConfig();
  return { config: data, offline: remote.isOffline() };
});
ipcMain.handle('server:status', async () => {
  const { data: config } = await remote.getLauncherConfig();
  if (!config?.server) return { online: false };
  return getServerStatus(config.server);
});

/* ── IPC : news (CDC F9) ───────────────────────────────────── */
const newsReadFile = () => path.join(getLauncherDir(), 'news-read.json');
const readNewsIds = () => {
  try { return JSON.parse(fs.readFileSync(newsReadFile(), 'utf8')); } catch { return []; }
};
ipcMain.handle('news:list', async () => {
  const { data } = await remote.getNews();
  return { news: data?.news ?? [], readIds: readNewsIds() };
});
ipcMain.handle('news:markRead', (_e, ids) => {
  if (!Array.isArray(ids)) return;
  const merged = [...new Set([...readNewsIds(), ...ids.filter((i) => typeof i === 'string')])];
  fs.mkdirSync(getLauncherDir(), { recursive: true });
  fs.writeFileSync(newsReadFile(), JSON.stringify(merged));
});

/* ── IPC : patchnotes (CDC F12) ────────────────────────────── */
ipcMain.handle('changelog:list', async () => {
  const { data } = await remote.getChangelog();
  return data?.entries ?? [];
});

/* ── IPC : contenus et blocklist (CDC F6, F11) ─────────────── */
const typeFromPath = (rel) => {
  if (rel.startsWith('mods/')) return 'mod';
  if (rel.startsWith('resourcepacks/')) return 'resourcepack';
  if (rel.startsWith('shaderpacks/')) return 'shaderpack';
  return 'config';
};

ipcMain.handle('content:list', async () => {
  const tracked = content.registerDetected([]);
  const { data: blocklist } = await remote.getBlocklist();
  const matches = await content.scanBlocklist(blocklist ?? { entries: [] }, sync.MANAGED_DIRS);
  const blockedByPath = new Map(matches.map((m) => [m.path, m.reason]));
  return tracked.map((t) => ({
    path: t.path,
    name: path.basename(t.path),
    type: typeFromPath(t.path),
    source: t.source,
    blocked: blockedByPath.has(t.path),
    reason: blockedByPath.get(t.path) ?? null,
  }));
});

ipcMain.handle('content:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Ajouter des fichiers',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Mods et packs', extensions: ['jar', 'zip'] }],
  });
  if (result.canceled) return [];
  return result.filePaths.map((p) => ({
    src: p,
    name: path.basename(p),
    ext: path.extname(p).toLowerCase(),
  }));
});

ipcMain.handle('content:import', (_e, items) => {
  if (!Array.isArray(items)) return [];
  const done = [];
  for (const item of items) {
    if (typeof item?.src === 'string' && typeof item?.type === 'string') {
      try { done.push(content.importFile(item.src, item.type)); } catch { /* ignoré */ }
    }
  }
  return done;
});

ipcMain.handle('content:remove', (_e, relPath) => {
  if (typeof relPath === 'string' && !relPath.includes('..')) content.removeContent(relPath);
});

ipcMain.handle('content:openFolder', (_e, dirName) => {
  const openable = [...sync.MANAGED_DIRS, 'screenshots']; // dossiers ouvrables (I5)
  if (!openable.includes(dirName)) return;
  const dir = path.join(getGameDir(), dirName);
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
});

ipcMain.handle('blocklist:delete', (_e, paths) => {
  if (!Array.isArray(paths)) return;
  content.deleteFiles(paths.filter((p) => typeof p === 'string' && !p.includes('..')));
});

/* ── IPC : catalogue optionnel (CDC F11) ───────────────────── */
ipcMain.handle('optional:list', async () => {
  const { data } = await remote.getOptional();
  const items = data?.items ?? [];
  const tracked = content.readTracked();
  const installed = {};
  for (const item of items) {
    installed[item.id] = tracked.some(
      (t) => t.source === `optional:${item.id}` && fs.existsSync(path.join(getGameDir(), t.path)),
    );
  }
  return { items, installed };
});
ipcMain.handle('optional:install', async (_e, id) => {
  const { data } = await remote.getOptional();
  const item = (data?.items ?? []).find((i) => i.id === id);
  if (!item) return false;
  return content.installOptional(item);
});
ipcMain.handle('optional:uninstall', async (_e, id) => {
  const { data } = await remote.getOptional();
  const item = (data?.items ?? []).find((i) => i.id === id);
  if (item) content.uninstallOptional(item);
});

/* ── IPC : jeu, synchro, téléchargements ───────────────────── */
ipcMain.handle('play:start', () => game.play());
ipcMain.handle('sync:fullCheck', async () => {
  sync.clearHashCache(); // re-hash intégral (CDC F5, F13)
  const { data: config } = await remote.getLauncherConfig();
  if (!config?.modpack?.manifestUrl) return { ok: false };
  const { data: manifest } = await remote.getManifest(config.modpack.manifestUrl);
  if (!manifest) return { ok: false };
  const result = await sync.syncPack(manifest);
  if (result.unknown.length) content.registerDetected(result.unknown);
  return result;
});
ipcMain.handle('downloads:retry', () => sync.retry());
ipcMain.on('downloads:pause', () => downloads.pause());
ipcMain.on('downloads:resume', () => downloads.resume());

/* ── IPC : migration du dossier de données (CDC F13) ───────── */
ipcMain.handle('storage:migrate', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choisir le nouveau dossier des données',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, reason: 'cancelled' };
  const newRoot = result.filePaths[0];
  const oldRoot = require('./paths').getDataDir();
  if (path.resolve(newRoot) === path.resolve(oldRoot)) return { ok: false, reason: 'same' };
  try {
    // Copie assistée : game + runtime + launcher (CDC F13)
    for (const sub of ['game', 'runtime', 'launcher']) {
      const src = path.join(oldRoot, sub);
      if (fs.existsSync(src)) {
        await fs.promises.cp(src, path.join(newRoot, sub), { recursive: true, force: true });
      }
    }
    settings.write({ dataDir: newRoot });
    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err?.message ?? err) };
  }
});

/* ── IPC : désinstallation complète, sans trace ────────────── */
ipcMain.handle('app:uninstall', async () => {
  if (game.isRunning()) return { ok: false, reason: 'game-running' };

  // Cibles calculées AVANT de supprimer settings.json (dossier migré inclus)
  const paths = require('./paths');
  const dataRoot = paths.getDataDir();
  const targets = [
    path.join(dataRoot, 'game'),
    path.join(dataRoot, 'runtime'),
    path.join(dataRoot, 'launcher'),
    paths.getConfigDir(), // settings.json (+ données si emplacement par défaut)
  ];
  for (const dir of targets) {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
  // Caches Electron : au mieux maintenant (certains fichiers sont verrouillés
  // tant que l'app tourne) ; le désinstalleur NSIS termine le travail.
  try { await fs.promises.rm(app.getPath('userData'), { recursive: true, force: true }); } catch { /* verrouillé */ }

  // Version installée : on lance le désinstalleur NSIS puis on quitte
  if (app.isPackaged) {
    const uninstaller = path.join(path.dirname(app.getPath('exe')), 'Uninstall Meytopia Launcher.exe');
    if (fs.existsSync(uninstaller)) {
      require('child_process').spawn(uninstaller, [], { detached: true, stdio: 'ignore' }).unref();
    }
  }
  setTimeout(() => app.quit(), 200);
  return { ok: true };
});

/* ── IPC : mise à jour du launcher (CDC F3) ────────────────── */
ipcMain.handle('updater:status', () => updater.getStatus());
ipcMain.handle('updater:check', () => updater.check());
ipcMain.handle('updater:install', () => updater.quitAndInstall());

// Infos de débogage à copier-coller sur Discord (I12)
ipcMain.handle('app:debugInfo', async () => {
  let config = null;
  try { ({ data: config } = await remote.getLauncherConfig()); } catch { /* hors ligne */ }
  const s = settings.read();
  return {
    launcher: app.getVersion(),
    pack: config?.modpack?.version ?? '?',
    mc: config?.modpack?.mcVersion ?? '?',
    loader: `${config?.modpack?.loader?.type ?? '?'} ${config?.modpack?.loader?.version ?? ''}`.trim(),
    windows: os.release(),
    ramTotalGb: Math.round(os.totalmem() / 1073741824),
    ramGb: Number(s.ramGb) || 8,
    theme: s.theme ?? 'dark',
    autoJoin: s.autoJoin !== false,
  };
});

// Infos du modpack pour l'en-tête de Contenus (J5)
ipcMain.handle('pack:info', async () => {
  try {
    const [{ data: config }, { data: manifest }] = await Promise.all([
      remote.getLauncherConfig(),
      remote.getManifest(),
    ]);
    const files = manifest?.files ?? [];
    if (!files.length) return null;
    return {
      version: config?.modpack?.version ?? manifest?.version ?? '?',
      count: files.length,
      totalBytes: files.reduce((n, f) => n + (f.size ?? 0), 0),
    };
  } catch { return null; }
});

// Stats du joueur : telecharge le releve de la sonde (branche stats, lecture seule)
// et renvoie { me, data } ou me = pseudo Minecraft du compte actif.
ipcMain.handle('stats:get', async () => {
  try {
    const { STATS_URL, FETCH_TIMEOUT_MS } = require('./config');
    const active = accounts.summary().find((a) => a.active);
    const me = active ? active.name : null;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS ?? 10000);
    const res = await fetch(STATS_URL + '?nc=' + Date.now(), { signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) return { me, data: null };
    return { me, data: await res.json() };
  } catch { return { me: null, data: null }; }
});

// Veille serveur (30 s) : « de retour en ligne » (I2) et « un ami se connecte » (J4)
let lastServerOnline = null;
let lastPlayers = null;
let confirming = false; // evite deux rafales de confirmation en parallele

// Confirmation anti-faux-positif : quand un ping rate, on re-verifie 5 fois,
// espacees de 3 s. Il faut les 5 echecs d'affilee pour declarer le serveur hors ligne ;
// un seul succes parmi les 5 annule la fausse alerte. On ne martele qu'en cas de doute.
async function confirmOffline(server) {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const s = await getServerStatus(server);
      if (s.online) return { stillOnline: true, status: s }; // un succes => fausse alerte
    } catch { /* echec compte comme hors ligne */ }
  }
  return { stillOnline: false }; // 5 echecs d'affilee => vraiment hors ligne
}

setInterval(async () => {
  try {
    const prefs = settings.read();
    const friends = Array.isArray(prefs.friends) ? prefs.friends : [];
    if (!prefs.notifyServerBack && !friends.length) { lastServerOnline = null; lastPlayers = null; return; }
    const { data: config } = await remote.getLauncherConfig();
    if (!config?.server) return;
    let status = await getServerStatus(config.server);

    // Si le serveur semble hors ligne et qu'on le croyait en ligne (ou inconnu),
    // on confirme par une rafale avant de basculer l'etat. Evite les faux "de retour".
    let effectiveOnline = Boolean(status.online);
    if (!status.online && lastServerOnline !== false && !confirming) {
      confirming = true;
      try {
        const res = await confirmOffline(config.server);
        if (res.stillOnline) { effectiveOnline = true; status = res.status; } // c'etait un faux negatif
        else effectiveOnline = false; // confirme hors ligne
      } finally { confirming = false; }
    } else if (!status.online && lastServerOnline === false) {
      effectiveOnline = false; // deja connu hors ligne, pas besoin de reconfirmer
    }

    if (prefs.notifyServerBack && lastServerOnline === false && effectiveOnline === true && Notification.isSupported()) {
      new Notification({ title: 'Meytopia', body: 'Le serveur est de retour en ligne !', urgency: 'critical', timeoutType: 'never' }).show();
    }
    lastServerOnline = effectiveOnline;

    const players = status.online && Array.isArray(status.players) ? status.players : null;
    if (players && friends.length && lastPlayers && Notification.isSupported()) {
      const own = new Set(accounts.summary().map((a) => String(a.name).toLowerCase()));
      const before = new Set(lastPlayers.map((nick) => nick.toLowerCase()));
      const watched = new Set(friends.map((f) => String(f).toLowerCase()));
      const arrivals = players.filter((nick) => {
        const low = nick.toLowerCase();
        return watched.has(low) && !before.has(low) && !own.has(low);
      });
      if (arrivals.length) {
        const body = arrivals.length === 1
          ? `${arrivals[0]} vient de se connecter sur Meytopia !`
          : `${arrivals.join(', ')} viennent de se connecter sur Meytopia !`;
        new Notification({ title: 'Meytopia', body, urgency: 'critical', timeoutType: 'never' }).show();
      }
    }
    if (players) lastPlayers = players;
  } catch { /* silencieux */ }
}, 30000);

/* ── Cycle de vie ──────────────────────────────────────────── */
app.whenReady().then(() => {
  accounts.load();
  createWindow();
  setupTray();
  updater.init(); // vérification au démarrage (CDC F3)

  // Reconnexion silencieuse des sessions, sans bloquer l'ouverture (CDC F2)
  accounts.refreshAll().then(broadcastAccounts).catch(() => broadcastAccounts());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
