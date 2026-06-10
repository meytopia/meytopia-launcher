// ============================================================
// Meytopia Launcher — Processus principal (P1 : squelette)
// Réfère au cahier des charges : §3.1 (architecture), §5.2 (fenêtre)
// ============================================================
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

let mainWindow = null;

// Une seule instance du launcher à la fois (CDC §7 — fiabilité)
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

/**
 * Crée la fenêtre principale du launcher.
 * Fenêtre sans bordure Windows : la barre de titre est dessinée
 * par le renderer (CDC §5.2), les contrôles passent par IPC.
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 768,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    backgroundColor: '#120D1F',
    show: false, // évite le flash blanc : on affiche quand tout est prêt
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Tout lien externe s'ouvre dans le navigateur, jamais dans le launcher (CDC §3.1)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- IPC : contrôles de la fenêtre sans bordure -------------
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:close', () => mainWindow?.close());

// --- IPC : informations de l'application --------------------
ipcMain.handle('app:version', () => app.getVersion());

// --- Cycle de vie -------------------------------------------
app.whenReady().then(() => {
  createWindow();

  // Comportement standard macOS (préparation multi-OS, CDC §7)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
