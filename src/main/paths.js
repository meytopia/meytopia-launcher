// ============================================================
// Meytopia Launcher — Chemins de données (CDC §3.2)
// settings.json vit TOUJOURS dans %APPDATA%\.meytopia (fixe) ;
// les données (game/runtime/launcher) suivent settings.dataDir
// si l'utilisateur a migré son dossier (CDC F13).
// ============================================================
const { app } = require('electron');
const path = require('path');
const settings = require('./settings');

const getConfigDir = () => path.join(app.getPath('appData'), '.meytopia');

function getDataDir() {
  const custom = settings.read().dataDir;
  return typeof custom === 'string' && custom.length ? custom : getConfigDir();
}

const getLauncherDir = () => path.join(getDataDir(), 'launcher');
const getGameDir = () => path.join(getDataDir(), 'game');
const getRuntimeDir = () => path.join(getDataDir(), 'runtime');

// Sécurité : résout un chemin RELATIF venant du réseau (manifest/optional) en chemin absolu
// DANS le dossier de jeu. Rejette tout « .. » ou chemin absolu (anti path-traversal :
// empêche d'écrire/supprimer un fichier hors du dossier de jeu).
function safeGamePath(rel) {
  const root = path.resolve(getGameDir());
  const abs = path.resolve(root, String(rel == null ? '' : rel));
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error('Chemin hors du dossier de jeu refusé : ' + rel);
  }
  return abs;
}

module.exports = { getConfigDir, getDataDir, getLauncherDir, getGameDir, getRuntimeDir, safeGamePath };
