// ============================================================
// Meytopia Launcher — settings.json (CDC §6.7)
// Toujours stocké dans %APPDATA%\.meytopia (indépendant du
// dossier de données, pour éviter toute dépendance circulaire).
// ============================================================
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const dir = () => path.join(app.getPath('appData'), '.meytopia');
const file = () => path.join(dir(), 'settings.json');

/** Lit les réglages (objet vide si le fichier n'existe pas encore). */
function read() {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    return {};
  }
}

/** Fusionne `patch` dans les réglages et écrit le fichier. */
function write(patch) {
  const next = { ...read(), ...patch };
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(next, null, 2));
  return next;
}

module.exports = { read, write };
