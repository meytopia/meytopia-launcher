// ============================================================
// Meytopia Launcher — Synchronisation du modpack (CDC F5)
// Compare le manifest au disque (cache de hash), télécharge le
// delta, détecte les fichiers hors modpack sans les supprimer.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getGameDir, getLauncherDir, safeGamePath } = require('./paths');
const downloads = require('./downloads');

const MANAGED_DIRS = ['mods', 'config', 'resourcepacks', 'shaderpacks']; // CDC §6.2
// Détection « hors modpack » : config/ exclu, car le jeu et les mods y
// génèrent leurs fichiers en permanence — ce serait du bruit pour le joueur.
const DETECT_DIRS = ['mods', 'resourcepacks', 'shaderpacks'];

const hashCacheFile = () => path.join(getLauncherDir(), 'cache', 'hashes.json');
let lastManifest = null; // pour « Relancer » après interruption

const sha1File = (file) => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha1');
  fs.createReadStream(file)
    .on('data', (c) => hash.update(c))
    .on('end', () => resolve(hash.digest('hex')))
    .on('error', reject);
});

function readHashCache() {
  try { return JSON.parse(fs.readFileSync(hashCacheFile(), 'utf8')); } catch { return {}; }
}
function writeHashCache(cache) {
  fs.mkdirSync(path.dirname(hashCacheFile()), { recursive: true });
  fs.writeFileSync(hashCacheFile(), JSON.stringify(cache));
}
function clearHashCache() {
  fs.rmSync(hashCacheFile(), { force: true });
}

/** Octets libres sur le disque du dossier de jeu (null si indéterminable). */
async function freeDiskBytes(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const s = await fs.promises.statfs(dir);
    return Number(s.bsize) * Number(s.bavail);
  } catch { return null; }
}

/** SHA-1 d'un fichier, via cache (taille + date inchangées → pas de re-hash, CDC §7). */
async function cachedSha1(absPath, cache) {
  const stat = fs.statSync(absPath);
  const key = absPath;
  const hit = cache[key];
  if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return hit.sha1;
  const sha1 = await sha1File(absPath);
  cache[key] = { size: stat.size, mtimeMs: stat.mtimeMs, sha1 };
  return sha1;
}

/** Liste récursive des fichiers d'un dossier (chemins relatifs au dossier de jeu). */
function listFiles(relDir) {
  const absDir = path.join(getGameDir(), relDir);
  if (!fs.existsSync(absDir)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(getGameDir(), full).split(path.sep).join('/'));
    }
  };
  walk(absDir);
  return out;
}

/**
 * Compare le manifest au disque.
 * @param {(done:number, total:number) => void} [onProgress]  Avancement de la vérification
 *   (appelé au plus toutes les ~150 ms : le premier lancement re-hache tout le pack, c'est long —
 *   sans retour visuel, le joueur croit que le launcher est gelé).
 * @returns {Promise<{toDownload: object[], unknown: string[]}>}
 */
async function diff(manifest, onProgress) {
  const cache = readHashCache();
  const toDownload = [];
  const manifestPaths = new Set();
  const total = (manifest.files ?? []).length;
  let done = 0, lastTick = 0;
  const tick = () => {
    done += 1;
    if (!onProgress) return;
    const now = Date.now();
    if (done === total || now - lastTick >= 150) { lastTick = now; try { onProgress(done, total); } catch { /* affichage seulement */ } }
  };

  for (const file of manifest.files ?? []) {
    // Mod désactivé depuis la régie (enabled:false) : on ne le télécharge pas, et on le marque
    // comme "connu" pour ne pas le signaler hors-modpack (sa suppression éventuelle passe par la blocklist).
    if (file && file.enabled === false) { if (file.path) manifestPaths.add(file.path); tick(); continue; }
    let abs;
    try { abs = safeGamePath(file.path); }
    catch (e) { console.warn('[sync] entrée manifest ignorée (chemin refusé) :', file.path); tick(); continue; }
    manifestPaths.add(file.path);
    // Intégrité obligatoire : sans SHA-1 vérifiable (40 hex), on n'installe pas ce fichier.
    // Il reste "connu" (déjà dans manifestPaths → pas signalé hors-modpack) mais n'est pas téléchargé.
    if (!/^[0-9a-f]{40}$/i.test(String(file.sha1 || ''))) {
      console.warn('[sync] fichier ignoré (SHA-1 manquant/invalide dans le manifest) :', file.path);
      tick();
      continue;
    }
    let needs = true;
    if (fs.existsSync(abs)) {
      try {
        const sha1 = await cachedSha1(abs, cache);
        needs = sha1.toLowerCase() !== String(file.sha1).toLowerCase();
      } catch { needs = true; }
    }
    if (needs) {
      toDownload.push({
        name: path.basename(file.path),
        url: file.url,
        dest: abs,
        size: file.size || 0,
        sha1: file.sha1,
        relPath: file.path,
      });
    }
    tick();
  }

  // Fichiers hors modpack : signalés, JAMAIS supprimés (CDC F5).
  // Les restes de téléchargement du LAUNCHER (.part + sa méta .part.sha1, laissés par downloads.js
  // pour la reprise après coupure) ne sont PAS des ajouts du joueur : on ne les signale pas — sinon
  // fausse alerte à chaque reprise. En revanche, un .part POSÉ PAR LE JOUEUR (ex. téléchargement
  // navigateur inachevé glissé dans mods/, SANS méta .part.sha1) reste un fichier hors modpack normal :
  // on le signale comme avant (et on n'y touchera jamais).
  const unknown = [];
  for (const dir of DETECT_DIRS) {
    const files = listFiles(dir);
    const present = new Set(files);
    for (const rel of files) {
      if (isLauncherPart(rel, present)) continue;
      if (!manifestPaths.has(rel)) unknown.push(rel);
    }
  }

  writeHashCache(cache);
  return { toDownload, unknown };
}

/**
 * Reste de téléchargement créé par LE LAUNCHER, distinct d'un fichier homonyme du joueur.
 * Le launcher écrit toujours la paire « X.part » + « X.part.sha1 » (downloads.js) :
 *  - un « .part.sha1 » n'est jamais créé par un joueur → c'est toujours notre méta ;
 *  - un « .part » n'est à nous que si sa méta « .part.sha1 » est présente à côté.
 * Un « .part » seul (téléchargement navigateur inachevé déposé par le joueur) n'est donc PAS à nous.
 */
function isLauncherPart(rel, presentSet) {
  const r = String(rel);
  if (/\.part\.sha1$/i.test(r)) return true;
  if (/\.part$/i.test(r)) return presentSet.has(r + '.sha1');
  return false;
}

/**
 * Ménage des restes .part orphelins DU LAUNCHER uniquement : un téléchargement coupé laisse « X.part »
 * + « X.part.sha1 » pour la reprise (downloads.js). Si le fichier visé n'est plus au programme — déjà
 * à jour, retiré du pack, ou version changée — ces restes ne seront jamais repris : on les efface
 * (espace disque + plus jamais signalés « hors modpack »). On ne touche JAMAIS à un .part du joueur
 * (sans méta .part.sha1), ni aux .part encore à télécharger (reprise en cours).
 */
function cleanupOrphanParts(toDownloadDests) {
  const keep = new Set(toDownloadDests.map((d) => path.resolve(d)));
  for (const dir of MANAGED_DIRS) {
    const files = listFiles(dir);
    const present = new Set(files);
    for (const rel of files) {
      if (!isLauncherPart(rel, present)) continue; // reste du launcher seulement
      const abs = path.join(getGameDir(), rel);
      const base = path.resolve(abs.replace(/\.part(\.sha1)?$/i, ''));
      if (!keep.has(base)) { try { fs.rmSync(abs, { force: true }); } catch { /* best-effort */ } }
    }
  }
}

/**
 * Vérifie et télécharge le delta du modpack.
 * @returns {Promise<{ok:boolean, unknown:string[], downloaded:number}>}
 */
async function syncPack(manifest, onProgress, onDownloadStart) {
  lastManifest = manifest;
  const { toDownload, unknown } = await diff(manifest, onProgress);
  // Efface les .part orphelins (fichiers déjà à jour, retirés du pack ou de version changée) AVANT
  // le retour anticipé « rien à télécharger » — sinon un orphelin survivrait à chaque synchro.
  cleanupOrphanParts(toDownload.map((j) => j.dest));
  if (!toDownload.length) return { ok: true, unknown, downloaded: 0 };

  // Garde-fou espace disque : on refuse de démarrer un téléchargement voué à l'échec (I11)
  const neededBytes = toDownload.reduce((n, job) => n + (job.size ?? 0), 0) + 1024 * 1024 * 1024; // marge 1 Go
  const free = await freeDiskBytes(getGameDir());
  if (free !== null && free < neededBytes) {
    return {
      ok: false, unknown, downloaded: 0, reason: 'disk',
      neededGb: Number((neededBytes / 1073741824).toFixed(1)),
      freeGb: Number((free / 1073741824).toFixed(1)),
    };
  }
  // Le hachage est fini, le téléchargement commence : on le signale pour que le bouton JOUER ne reste
  // pas figé sur « Vérification… X/X » pendant toute la descente des fichiers (le volet, lui, détaille).
  if (onDownloadStart) { try { onDownloadStart(toDownload.length); } catch { /* affichage seulement */ } }
  const ok = await downloads.run(`Modpack ${manifest.version ?? ''}`.trim(), toDownload);
  if (ok) {
    // Met à jour le cache de hash pour les fichiers fraîchement écrits
    const cache = readHashCache();
    for (const job of toDownload) {
      try {
        const stat = fs.statSync(job.dest);
        cache[job.dest] = { size: stat.size, mtimeMs: stat.mtimeMs, sha1: job.sha1 };
      } catch { /* fichier en erreur : ignoré */ }
    }
    writeHashCache(cache);
  }
  return { ok, unknown, downloaded: toDownload.length };
}

/** « Relancer » après interruption : rejoue la dernière synchro (CDC F10). */
async function retry() {
  if (!lastManifest) return { ok: false, unknown: [], downloaded: 0 };
  return syncPack(lastManifest);
}

module.exports = { syncPack, retry, clearHashCache, MANAGED_DIRS };
