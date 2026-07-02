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
/** Identité interne d'un .jar (modId + displayName, minuscules) — pour bloquer même si le fichier est renommé. */
function jarIdentity(fullPath) {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(fullPath);
    const e = zip.getEntry('META-INF/neoforge.mods.toml') || zip.getEntry('META-INF/mods.toml');
    if (!e) return '';
    const t = e.getData().toString('utf8');
    const id = (t.match(/modId\s*=\s*"([^"]+)"/) || [])[1] || '';
    const name = (t.match(/displayName\s*=\s*"([^"]+)"/) || [])[1] || '';
    return (id + ' ' + name).toLowerCase();
  } catch (e) {
    return '';
  }
}

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
        const isJar = lower.endsWith('.jar');
        let jarId = null; // identité interne du .jar (modId + displayName), lue à la demande (anti-renommage)
        for (const rule of entries) {
          const scopes = rule.scope ?? managedDirs;
          if (!scopes.includes(dir)) continue;
          let hit = false;
          if (rule.match?.fileName) {
            hit = lower === String(rule.match.fileName).toLowerCase();
          } else if (rule.match?.contains) {
            const kw = String(rule.match.contains).toLowerCase();
            hit = lower.includes(kw);
            if (!hit && isJar) {
              // Le fichier a pu être renommé : on regarde AUSSI l'identifiant interne du mod (modId/displayName).
              if (jarId === null) jarId = jarIdentity(full);
              hit = jarId.includes(kw);
            }
          } else if (rule.match?.sha1) {
            hit = (await sha1File(full)).toLowerCase() === String(rule.match.sha1).toLowerCase();
          }
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
    // safeGamePath : même garde anti path-traversal que removeContent (refuse « .. » et chemins absolus).
    try { fs.rmSync(safeGamePath(rel), { force: true }); } catch { /* chemin refusé : ignoré */ }
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

/** Vrai si l'entrée du catalogue (id) est installée : suivie ET fichier présent sur le disque. */
function isOptionalInstalled(id) {
  return readTracked().some((t) => t.source === `optional:${id}` && fs.existsSync(path.join(getGameDir(), t.path)));
}

/**
 * Installe un contenu du catalogue AVEC ses dépendances (bibliothèques présentes au catalogue).
 * @param {object} item      entrée à installer
 * @param {object[]} allItems catalogue complet (pour résoudre item.deps)
 * @returns {Promise<boolean>}
 */
async function installOptional(item, allItems) {
  allItems = Array.isArray(allItems) ? allItems : [item];
  const byId = new Map(allItems.map((i) => [i.id, i]));
  // Chaîne transitive : dépendances d'abord, puis le mod demandé.
  const chain = [];
  const seen = new Set();
  const visit = (it) => {
    if (!it || seen.has(it.id)) return;
    seen.add(it.id);
    for (const depId of (it.deps || [])) visit(byId.get(depId));
    chain.push(it);
  };
  visit(item);
  // Ne télécharge que ce qui a un SHA-1 valide et n'est pas déjà installé (hors item demandé).
  const jobs = [];
  for (const it of chain) {
    if (!/^[0-9a-f]{40}$/i.test(String(it.file?.sha1 || ''))) {
      if (it.id === item.id) return false; // le mod demandé DOIT être vérifiable
      continue;                            // dépendance non vérifiable : ignorée
    }
    if (it.id !== item.id && isOptionalInstalled(it.id)) continue; // dépendance déjà présente
    jobs.push({ name: path.basename(it.file.path), url: it.file.url, dest: safeGamePath(it.file.path),
      size: it.file.size || 0, sha1: it.file.sha1, _id: it.id, _path: it.file.path });
  }
  if (!jobs.length) return true;
  const ok = await downloads.run(item.name, jobs);
  // Suivi : marque tout fichier réellement présent (même si la file s'est interrompue en cours de route).
  let tracked = readTracked();
  for (const j of jobs) {
    if (!fs.existsSync(j.dest)) continue;
    tracked = tracked.filter((t) => t.path !== j._path);
    tracked.push({ path: j._path, source: `optional:${j._id}`, addedAt: new Date().toISOString() });
  }
  writeTracked(tracked);
  return ok && fs.existsSync(safeGamePath(item.file.path));
}

/**
 * Supprime TOUTES les versions installées d'une entrée du catalogue, par les chemins SUIVIS
 * (local-content.json) — pas par le chemin du catalogue actuel : si le joueur a une ANCIENNE
 * version (le catalogue a été mis à jour depuis), c'est bien son fichier à lui qu'il faut retirer.
 */
function removeOptionalById(id, fallbackPath) {
  const mine = readTracked().filter((t) => t.source === `optional:${id}`);
  if (!mine.length && fallbackPath) { removeContent(fallbackPath); return; }
  for (const t of mine) removeContent(t.path);
}

/**
 * Désinstalle un contenu du catalogue, dépendances comprises.
 * - Bibliothèque : retire AUSSI les mods installés qui en dépendent.
 * - Mod : retire ses bibliothèques devenues inutiles (plus aucun mod installé ne les utilise).
 */
function uninstallOptional(item, allItems) {
  allItems = Array.isArray(allItems) ? allItems : [item];
  const byId = new Map(allItems.map((i) => [i.id, i]));
  if (item.lib) {
    for (const m of allItems) {
      if (m.id !== item.id && (m.deps || []).includes(item.id) && isOptionalInstalled(m.id)) removeOptionalById(m.id, m.file.path);
    }
    removeOptionalById(item.id, item.file.path);
    return;
  }
  removeOptionalById(item.id, item.file.path);
  for (const depId of (item.deps || [])) {
    const dep = byId.get(depId);
    if (!dep || !dep.lib) continue;
    const stillUsed = allItems.some((m) => m.id !== item.id && (m.deps || []).includes(depId) && isOptionalInstalled(m.id));
    if (!stillUsed && isOptionalInstalled(depId)) removeOptionalById(depId, dep.file.path);
  }
}

/**
 * Met à jour un contenu installé vers la version actuelle du catalogue :
 * télécharge le NOUVEAU fichier d'abord (SHA-1 vérifié), puis supprime les anciennes versions
 * suivies — jamais de trou : en cas d'échec du téléchargement, l'ancienne version reste en place.
 * Et JAMAIS de doublon : si la file échoue à moitié (ex. une dépendance en erreur) alors que le
 * nouveau jar a déjà été écrit, on retire le NOUVEAU — deux versions du même mod dans mods/
 * feraient refuser le démarrage à NeoForge (duplicate mod id).
 */
async function updateOptional(item, allItems, _seen) {
  allItems = Array.isArray(allItems) ? allItems : [item];
  _seen = _seen || new Set();
  if (_seen.has(item.id)) return true; // anti-cycle (deps déclarées à la main en régie)
  _seen.add(item.id);
  // Dépendances PÉRIMÉES d'abord : mettre à jour le mod en gardant une vieille bibliothèque casserait la
  // compatibilité (installOptional saute les deps « déjà installées », même en ancienne version).
  const byId = new Map(allItems.map((i) => [i.id, i]));
  for (const depId of (item.deps || [])) {
    const dep = byId.get(depId);
    if (!dep || !dep.file?.path) continue;
    const depOld = readTracked().some((t) => t.source === `optional:${depId}` && t.path !== dep.file.path
      && fs.existsSync(path.join(getGameDir(), t.path)));
    if (depOld && !(await updateOptional(dep, allItems, _seen))) return false; // lib en échec → on ne touche pas au mod
  }
  const old = readTracked().filter((t) => t.source === `optional:${item.id}` && t.path !== item.file?.path);
  const ok = await installOptional(item, allItems);
  if (ok) {
    // Si l'ancien jar est verrouillé (jeu/antivirus), on retire le NOUVEAU (jamais de duplicate mod id).
    try { for (const t of old) removeContent(t.path); return true; }
    catch (e) {
      try { if (item.file?.path) removeContent(item.file.path); } catch (_) { /* au pire : l'échec est signalé */ }
      return false;
    }
  }
  const oldStillHere = old.some((t) => fs.existsSync(path.join(getGameDir(), t.path)));
  if (oldStillHere && item.file?.path && fs.existsSync(safeGamePath(item.file.path))) {
    removeContent(item.file.path); // rollback du nouveau : l'ancienne version reste la seule en place
  }
  return false;
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
  updateOptional,
};
