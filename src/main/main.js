// ============================================================
// Meytopia Launcher — Processus principal
// Réfère au cahier des charges : §3.1 (architecture), §5.2 (fenêtre)
// ============================================================
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
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

let mainWindow = null;

/** Émet un événement vers l'interface (utilisé par tous les modules). */
function emitToRenderer(channel, payload) {
  mainWindow?.webContents.send(channel, payload);
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
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 768,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    backgroundColor: '#120D1F',
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

  mainWindow.on('closed', () => { mainWindow = null; });
}

/* ── IPC : fenêtre ──────────────────────────────────────────── */
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:close', () => mainWindow?.close());

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
  if (!sync.MANAGED_DIRS.includes(dirName)) return;
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

/* ── IPC : mise à jour du launcher (CDC F3) ────────────────── */
ipcMain.handle('updater:status', () => updater.getStatus());
ipcMain.handle('updater:check', () => updater.check());
ipcMain.handle('updater:install', () => updater.quitAndInstall());

/* ── Cycle de vie ──────────────────────────────────────────── */
app.whenReady().then(() => {
  accounts.load();
  createWindow();
  updater.init(); // vérification au démarrage (CDC F3)

  // Reconnexion silencieuse des sessions, sans bloquer l'ouverture (CDC F2)
  accounts.refreshAll().then(broadcastAccounts);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
