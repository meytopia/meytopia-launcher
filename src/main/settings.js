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

/** Lit les réglages (objet vide si absent ; bascule sur la sauvegarde si le fichier est corrompu). */
function read() {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch (e) {
    // Fichier absent OU corrompu (ex. crash en pleine ecriture) : on tente la sauvegarde.
    try {
      return JSON.parse(fs.readFileSync(file() + '.bak', 'utf8'));
    } catch {
      return {};
    }
  }
}

/** Fusionne `patch` dans les réglages et écrit le fichier de façon atomique.
 *  Ecriture sur un fichier temporaire puis rename (operation atomique du systeme de
 *  fichiers) : un crash en cours d'ecriture ne peut donc pas corrompre settings.json.
 *  Une copie .bak est conservee avant chaque ecriture comme ultime filet de securite. */
function write(patch) {
  const next = { ...read(), ...patch };
  fs.mkdirSync(dir(), { recursive: true });
  const target = file();
  const tmp = target + '.tmp';
  // Sauvegarde de l'ancien fichier valide (best-effort)
  try { if (fs.existsSync(target)) fs.copyFileSync(target, target + '.bak'); } catch {}
  // Ecriture atomique : tmp puis rename
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, target);
  return next;
}

module.exports = { read, write };
