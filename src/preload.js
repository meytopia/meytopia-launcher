// ============================================================
// Meytopia Launcher — Preload
// Pont sécurisé interface ↔ principal (liste blanche, CDC §3.1).
// ============================================================
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (callback) =>
  ipcRenderer.on(channel, (_event, payload) => callback(payload));

contextBridge.exposeInMainWorld('meytopia', {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    close: () => ipcRenderer.send('window:close'),
    maximizeToggle: () => ipcRenderer.send('window:maximize-toggle'),
    fullscreenToggle: () => ipcRenderer.send('window:fullscreen-toggle'),
    onState: on('window:state'),
    onTrayPlay: on('tray:play'),
  },
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    debugInfo: () => ipcRenderer.invoke('app:debugInfo'),
    packInfo: () => ipcRenderer.invoke('pack:info'),
    systemInfo: () => ipcRenderer.invoke('system:info'),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    uninstall: () => ipcRenderer.invoke('app:uninstall'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    migrate: () => ipcRenderer.invoke('storage:migrate'),
  },
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    add: () => ipcRenderer.invoke('accounts:add'),
    remove: (uuid) => ipcRenderer.invoke('accounts:remove', uuid),
    select: (uuid) => ipcRenderer.invoke('accounts:select', uuid),
    onChanged: on('accounts:changed'),
  },
  remote: {
    config: () => ipcRenderer.invoke('remote:config'),
    onOfflinePlay: on('remote:offlinePlay'),
  },
  server: {
    status: () => ipcRenderer.invoke('server:status'),
  },
  news: {
    list: () => ipcRenderer.invoke('news:list'),
    markRead: (ids) => ipcRenderer.invoke('news:markRead', ids),
  },
  changelog: {
    list: () => ipcRenderer.invoke('changelog:list'),
  },
  content: {
    list: () => ipcRenderer.invoke('content:list'),
    pick: () => ipcRenderer.invoke('content:pick'),
    import: (items) => ipcRenderer.invoke('content:import', items),
    remove: (relPath) => ipcRenderer.invoke('content:remove', relPath),
    openFolder: (dirName) => ipcRenderer.invoke('content:openFolder', dirName),
    deleteBlocked: (paths) => ipcRenderer.invoke('blocklist:delete', paths),
    onUnknown: on('content:unknown'),
    onBlocklistHit: on('blocklist:hit'),
  },
  optional: {
    list: () => ipcRenderer.invoke('optional:list'),
    install: (id) => ipcRenderer.invoke('optional:install', id),
    uninstall: (id) => ipcRenderer.invoke('optional:uninstall', id),
  },
  game: {
    play: () => ipcRenderer.invoke('play:start'),
    onState: on('game:state'),
  },
  syncOps: {
    fullCheck: () => ipcRenderer.invoke('sync:fullCheck'),
  },
  downloads: {
    pause: () => ipcRenderer.send('downloads:pause'),
    resume: () => ipcRenderer.send('downloads:resume'),
    retry: () => ipcRenderer.invoke('downloads:retry'),
    onUpdate: on('downloads:update'),
  },
  updater: {
    status: () => ipcRenderer.invoke('updater:status'),
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    onStatus: on('updater:status'),
  },
});
