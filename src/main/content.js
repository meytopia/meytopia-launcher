// ============================================================
// Meytopia Launcher — Contenus hors modpack (CDC F6, F11)
// Suivi des ajouts perso/optionnels (local-content.json),
// scan de la blocklist, installation du catalogue approuvé.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getGameDir, getLauncherDir, safeGamePath } = require('./paths');
const downloads = require('./downloads');

const TYPE_DIRS = { mod: 'mods', resourcepack: 'resourcepacks', shaderpack: 'shaderpacks' };

const trackFile = () => path.join(getLauncherDir(), 'local-content.json');

function readTracked() {
  try { return JSON.parse(fs.readFileSync(trackFile(), 'utf8')); } catch { return []; }
}
function writeTracked(list) {
  fs.mkdirSync(getLauncherDir(), { recursive: true });
  fs.writeFileSync(trackFile(), JSON.stringify(list, null, 2));
}

/** Enregistre les fichiers inconnus détectés par la synchro (source « detected »). */
function registerDetected(relPaths) {
  const tracked = readTracked();
  const known = new Set(tracked.map((t) => t.path));
  let changed = false;
  for (const rel of relPaths) {
    if (!known.has(rel)) {
      tracked.push({ path: rel, source: 'detected', addedAt: new Date().toISOString() });
      changed = true;
    }
  }
  // Purge : fichiers disparus + anciennes détections dans config/ (le jeu
  // génère ces fichiers lui-même, ils n'ont rien à faire dans « Mes ajouts »)
  const filtered = tracked.filter((t) =>
    fs.existsSync(path.join(getGameDir(), t.path)) &&
    !(t.source === 'detected' && t.path.startsWith('config/')));
  if (changed || filtered.length !== tracked.length) writeTracked(filtered);
  return filtered;
}

const sha1File = (file) => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha1');
  fs.createReadStream(file)
    .on('data', (c) => hash.update(c))
    .on('end', () => resolve(hash.digest('hex')))
    .on('error', reject);
});

/* ── Blocklist (CDC F6) ───────────────────────────────────── */

/**
 * Scanne les dossiers gérés contre la blocklist.
 * @returns {Promise<{path:string, name:string, reason:string}[]>}
 */
async function scanBlocklist(blocklist, managedDirs) {
  const entries = blocklist?.entries ?? [];
  if (!entries.length) return [];
  const matches = [];

  for (const dir of managedDirs) {
    const absDir = path.join(getGameDir(), dir);
    if (!fs.existsSync(absDir)) continue;
    const walk = async (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) { await walk(full); continue; }
        const lower = entry.name.toLowerCase();
        for (const rule of entries) {
          const scopes = rule.scope ?? managedDirs;
          if (!scopes.includes(dir)) continue;
          let hit = false;
          if (rule.match?.fileName) hit = lower === String(rule.match.fileName).toLowerCase();
          else if (rule.match?.contains) hit = lower.includes(String(rule.match.contains).toLowerCase());
          else if (rule.match?.sha1) hit = (await sha1File(full)).toLowerCase() === String(rule.match.sha1).toLowerCase();
          if (hit) {
            matches.push({
              path: path.relative(getGameDir(), full).split(path.sep).join('/'),
              name: entry.name,
              reason: rule.reason ?? 'Fichier interdit',
            });
            break;
          }
        }
      }
    };
    await walk(absDir);
  }
  return matches;
}

/** Supprime les fichiers bloqués, à la demande de l'utilisateur (CDC F6). */
function deleteFiles(relPaths) {
  for (const rel of relPaths) {
    fs.rmSync(path.join(getGameDir(), rel), { force: true });
  }
  registerDetected([]); // purge du suivi
}

/* ── Ajouts perso (CDC F11) ───────────────────────────────── */

/** Copie un fichier choisi par l'utilisateur dans le bon dossier. */
function importFile(srcPath, type) {
  const dir = TYPE_DIRS[type];
  if (!dir) throw new Error(`type inconnu : ${type}`);
  const destDir = path.join(getGameDir(), dir);
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(srcPath));
  fs.copyFileSync(srcPath, dest);
  const rel = `${dir}/${path.basename(srcPath)}`;
  const tracked = readTracked().filter((t) => t.path !== rel);
  tracked.push({ path: rel, source: 'user', addedAt: new Date().toISOString() });
  writeTracked(tracked);
  return rel;
}

/** Supprime un contenu suivi (ajout perso, détecté ou optionnel). */
function removeContent(relPath) {
  fs.rmSync(safeGamePath(relPath), { force: true }); // garde anti path-traversal sur la suppression
  writeTracked(readTracked().filter((t) => t.path !== relPath));
}

/* ── Catalogue approuvé (CDC F11) ─────────────────────────── */

async function installOptional(item) {
  const dest = safeGamePath(item.file.path); // garde anti path-traversal (chemin venant d'optional.json)
  const ok = await downloads.run(item.name, [{
    name: path.basename(item.file.path),
    url: item.file.url,
    dest,
    size: item.file.size || 0,
    sha1: item.file.sha1,
  }]);
  if (!ok) return false;
  const tracked = readTracked().filter((t) => t.path !== item.file.path);
  tracked.push({ path: item.file.path, source: `optional:${item.id}`, addedAt: new Date().toISOString() });
  writeTracked(tracked);
  return true;
}

function uninstallOptional(item) {
  removeContent(item.file.path);
}

module.exports = {
  TYPE_DIRS,
  readTracked,
  registerDetected,
  scanBlocklist,
  deleteFiles,
  importFile,
  removeContent,
  installOptional,
  uninstallOptional,
};
