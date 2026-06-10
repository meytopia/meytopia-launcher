#!/usr/bin/env node
// ============================================================
// Meytopia — packtool (CDC P4)
// Génère le manifest du modpack et publie les fichiers modifiés
// sur une release GitHub du dépôt meytopia-data (delta uniquement).
//
// Usage :
//   node tools\packtool.js <dossier-du-pack> <version> <dossier-meytopia-data>
//
// Exemple :
//   node tools\packtool.js "C:\packs\meytopia" 1.0.0 "C:\Users\Admin\Desktop\Perso\meytopia\meytopia-data"
//
// Prérequis : gh CLI connecté (gh auth status).
// Ensuite : commit + push du manifest.json dans meytopia-data.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const MANAGED_DIRS = ['mods', 'config', 'resourcepacks', 'shaderpacks'];
const DATA_REPO_NAME = 'meytopia-data';
const UPLOAD_BATCH = 12; // évite de dépasser la limite de ligne de commande Windows

const [packDir, version, dataRepoDir] = process.argv.slice(2);
if (!packDir || !version || !dataRepoDir) {
  console.error('Usage : node tools/packtool.js <dossier-du-pack> <version> <dossier-meytopia-data>');
  process.exit(1);
}
if (!fs.existsSync(packDir)) { console.error(`Dossier introuvable : ${packDir}`); process.exit(1); }
if (!fs.existsSync(dataRepoDir)) { console.error(`Dépôt data introuvable : ${dataRepoDir}`); process.exit(1); }

/** Exécute gh en citant chaque argument (compatible Windows). */
function gh(args, options = {}) {
  const quoted = args.map((a) => `"${String(a).replace(/"/g, '\\"')}"`).join(' ');
  return spawnSync(`gh ${quoted}`, { shell: true, encoding: 'utf8', ...options });
}

const sha1File = (file) => {
  const hash = crypto.createHash('sha1');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
};

/** Nom d'asset GitHub : chemin relatif avec les / remplacés par _ . */
const assetName = (relPath) => relPath.replace(/[\\/]/g, '_');

function listFiles(baseDir, sub) {
  const absDir = path.join(baseDir, sub);
  if (!fs.existsSync(absDir)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(baseDir, full).split(path.sep).join('/'));
    }
  };
  walk(absDir);
  return out;
}

/* 1) Propriétaire GitHub */
const ownerResult = gh(['api', 'user', '-q', '.login']);
if (ownerResult.status !== 0) {
  console.error('Impossible de lire le compte GitHub. Lance `gh auth login` d\'abord.');
  process.exit(1);
}
const owner = ownerResult.stdout.trim();
const repo = `${owner}/${DATA_REPO_NAME}`;
const tag = `pack-${version}`;
console.log(`Compte : ${owner} · dépôt : ${repo} · release : ${tag}\n`);

/* 2) Ancien manifest (pour le delta) */
const manifestPath = path.join(dataRepoDir, 'manifest.json');
let oldFiles = new Map();
try {
  const old = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  oldFiles = new Map((old.files ?? []).map((f) => [f.path, f]));
  console.log(`Ancien manifest : ${oldFiles.size} fichier(s) (version ${old.version ?? '?'})`);
} catch {
  console.log('Aucun manifest existant : publication complète.');
}

/* 3) Scan du pack */
const files = [];
const toUpload = [];
for (const dir of MANAGED_DIRS) {
  for (const rel of listFiles(packDir, dir)) {
    const abs = path.join(packDir, rel);
    const stat = fs.statSync(abs);
    const sha1 = sha1File(abs);
    const previous = oldFiles.get(rel);
    if (previous && String(previous.sha1).toLowerCase() === sha1) {
      // Inchangé : on réutilise l'URL de la release précédente (delta, CDC §6.2)
      files.push({ path: rel, sha1, size: stat.size, url: previous.url });
    } else {
      const url = `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(assetName(rel))}`;
      files.push({ path: rel, sha1, size: stat.size, url });
      toUpload.push({ abs, name: assetName(rel) });
    }
  }
}
console.log(`Pack scanné : ${files.length} fichier(s), ${toUpload.length} à téléverser.\n`);

/* 4) Release + upload du delta */
if (toUpload.length) {
  const exists = gh(['release', 'view', tag, '--repo', repo]).status === 0;
  if (!exists) {
    const created = gh(['release', 'create', tag, '--repo', repo, '--title', `Modpack ${version}`, '--notes', `Fichiers du modpack ${version}`], { stdio: 'inherit' });
    if (created.status !== 0) { console.error('Echec de creation de la release.'); process.exit(1); }
  }

  // Téléversement avec des noms d'assets aplatis : copie temporaire renommée
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'meytopia-pack-'));
  const tmpFiles = toUpload.map(({ abs, name }) => {
    const dest = path.join(tmp, name);
    fs.copyFileSync(abs, dest);
    return dest;
  });
  for (let i = 0; i < tmpFiles.length; i += UPLOAD_BATCH) {
    const batch = tmpFiles.slice(i, i + UPLOAD_BATCH);
    console.log(`Téléversement ${Math.min(i + UPLOAD_BATCH, tmpFiles.length)}/${tmpFiles.length}…`);
    const uploaded = gh(['release', 'upload', tag, ...batch, '--clobber', '--repo', repo], { stdio: 'inherit' });
    if (uploaded.status !== 0) { console.error('Echec du televersement.'); process.exit(1); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* 5) Écriture du manifest */
const manifest = {
  version,
  mcVersion: undefined, // informatif : défini par launcher.json
  generatedAt: new Date().toISOString(),
  files: files.sort((a, b) => a.path.localeCompare(b.path)),
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\nmanifest.json écrit (${files.length} fichiers) → ${manifestPath}`);
console.log('\nDernière étape (dans le dossier meytopia-data) :');
console.log('  git add manifest.json');
console.log(`  git commit -m "Modpack ${version}"`);
console.log('  git push');
