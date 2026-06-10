// ============================================================
// Meytopia Launcher — Preload (P1)
// Pont sécurisé entre l'interface et le processus principal.
// Seules les fonctions listées ici sont accessibles au renderer
// (CDC §3.1 : liste blanche de canaux IPC).
// ============================================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meytopia', {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    close: () => ipcRenderer.send('window:close'),
  },
  app: {
    version: () => ipcRenderer.invoke('app:version'),
  },
});
