#!/usr/bin/env node
// ============================================================
// Meytopia — packtool v2 (CDC P4 + Lot 2 K1/K2)
// 1) Manifest du modpack + publication delta sur GitHub Releases
// 2) Patchnotes « pro » : lit l'identité réelle des mods dans les
//    .jar (neoforge.mods.toml), diffe par modId, écrit l'entrée
//    changelog.json et une annonce Discord prête à coller
// 3) Met à jour modpack.version dans launcher.json
//
// Usage :
//   node tools\packtool.js <dossier-du-pack> <version> <dossier-meytopia-data>
//
// Prérequis : gh CLI connecté · npm install adm-zip --save-dev
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

let AdmZip = null;
try { AdmZip = require('adm-zip'); } catch { /* dégradé : noms de fichiers */ }

const MANAGED_DIRS = ['mods', 'config', 'resourcepacks', 'shaderpacks'];
const DATA_REPO_NAME = 'meytopia-data';
const UPLOAD_BATCH = 12; // évite de dépasser la limite de ligne de commande Windows

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

/* ───────────────── Identité des mods (K1) ───────────────── */

/** Lit modId / displayName / version dans le .jar (neoforge.mods.toml, repli mods.toml puis MANIFEST.MF). */
function readModMeta(absJar) {
  const base = path.basename(absJar, '.jar');
  const fallback = { id: `file:${base.toLowerCase()}`, name: base, version: '' };
  if (!AdmZip) return fallback;
  try {
    const zip = new AdmZip(absJar);
    const entry = zip.getEntry('META-INF/neoforge.mods.toml') || zip.getEntry('META-INF/mods.toml');
    if (!entry) return fallback;
    const toml = zip.readAsText(entry);
    const block = toml.split(/\[\[mods\]\]/)[1] ?? toml;
    const grab = (key) => {
      const m = block.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"'\\n]*)["']`, 'mi'));
      return m ? m[1].trim() : '';
    };
    const id = grab('modId');
    const name = grab('displayName') || id || base;
    let version = grab('version');
    if (!version || /\$\{/.test(version)) {
      const mf = zip.getEntry('META-INF/MANIFEST.MF');
      const match = mf ? zip.readAsText(mf).match(/Implementation-Version:\s*([^\r\n]+)/i) : null;
      version = match ? match[1].trim() : '';
    }
    return { id: id ? id.toLowerCase() : fallback.id, name, version };
  } catch {
    return fallback;
  }
}

/** Indexe les mods d'un manifest par identité (modId, repli nom de fichier). */
function modIndex(entries) {
  const map = new Map();
  for (const f of entries ?? []) {
    if (!String(f.path).startsWith('mods/')) continue;
    const base = path.posix.basename(f.path, '.jar');
    const meta = f.mod ?? { id: `file:${base.toLowerCase()}`, name: base, version: '' };
    map.set(meta.id, { ...meta, sha1: String(f.sha1).toLowerCase() });
  }
  return map;
}

/** Diff complet ancien manifest → nouveaux fichiers. */
function buildDiff(oldManifest, newFiles) {
  const before = modIndex(oldManifest?.files);
  const after = modIndex(newFiles);
  const added = [];
  const removed = [];
  const updated = [];
  for (const [id, mod] of after) {
    const prev = before.get(id);
    if (!prev) added.push(mod);
    else if (prev.sha1 !== mod.sha1) updated.push({ name: mod.name, from: prev.version, to: mod.version });
  }
  for (const [id, mod] of before) {
    if (!after.has(id)) removed.push(mod);
  }
  const byName = (a, b) => a.name.localeCompare(b.name, 'fr');
  added.sort(byName); removed.sort(byName); updated.sort(byName);

  const oldOthers = new Map((oldManifest?.files ?? [])
    .filter((f) => !String(f.path).startsWith('mods/'))
    .map((f) => [f.path, String(f.sha1).toLowerCase()]));
  let othersAdded = 0;
  let othersModified = 0;
  for (const f of newFiles.filter((x) => !x.path.startsWith('mods/'))) {
    const prev = oldOthers.get(f.path);
    if (prev === undefined) othersAdded += 1;
    else if (prev !== String(f.sha1).toLowerCase()) othersModified += 1;
    oldOthers.delete(f.path);
  }
  return { added, removed, updated, others: { added: othersAdded, modified: othersModified, removed: oldOthers.size } };
}

/** Lignes de patchnotes pour le launcher (changelog.json). */
function diffToLines(diff) {
  const v = (s) => (s ? ` ${s}` : '');
  const lines = [];
  for (const m of diff.added) lines.push(`➕ ${m.name}${v(m.version)}`);
  for (const u of diff.updated) lines.push(`🔁 ${u.name}${u.from || u.to ? ` : ${u.from || '?'} → ${u.to || '?'}` : ''}`);
  for (const m of diff.removed) lines.push(`➖ ${m.name}${v(m.version)}`);
  const { added, modified, removed } = diff.others;
  if (added + modified + removed > 0) {
    const parts = [];
    if (modified) parts.push(`${modified} modifié(s)`);
    if (added) parts.push(`${added} ajouté(s)`);
    if (removed) parts.push(`${removed} retiré(s)`);
    lines.push(`🛠 Autres fichiers (configs, packs…) : ${parts.join(', ')}`);
  }
  if (!lines.length) lines.push('Mise à jour technique du pack (aucun changement de mod).');
  return lines;
}

/** Entrée changelog.json (remplace une entrée existante de la même version : relançable). */
function writeChangelogEntry(dataRepoDir, version, lines) {
  const file = path.join(dataRepoDir, 'changelog.json');
  let doc = { entries: [] };
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { /* nouveau */ }
  if (!Array.isArray(doc.entries)) doc.entries = [];
  const id = `modpack-${version}`;
  doc.entries = doc.entries.filter((e) => e.id !== id);
  doc.entries.unshift({
    id,
    target: 'modpack',
    version,
    date: new Date().toISOString().slice(0, 10),
    title: `Modpack ${version}`,
    changes: lines,
  });
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  return file;
}

/** Annonce Discord prête à coller. */
function writeAnnouncement(dataRepoDir, version, diff) {
  const file = path.join(dataRepoDir, `annonce-modpack-${version}.md`);
  const v = (s) => (s ? ` \`${s}\`` : '');
  const out = [`# 📦 Modpack **${version}** est en ligne !`, ''];
  if (diff.added.length) {
    out.push('## ➕ Nouveaux mods');
    for (const m of diff.added) out.push(`- **${m.name}**${v(m.version)}`);
    out.push('');
  }
  if (diff.updated.length) {
    out.push('## 🔁 Mises à jour');
    for (const u of diff.updated) out.push(`- **${u.name}** : \`${u.from || '?'}\` → \`${u.to || '?'}\``);
    out.push('');
  }
  if (diff.removed.length) {
    out.push('## ➖ Retirés');
    for (const m of diff.removed) out.push(`- **${m.name}**${v(m.version)}`);
    out.push('');
  }
  const { added, modified, removed } = diff.others;
  if (added + modified + removed > 0) {
    out.push(`## 🛠 Autres fichiers`);
    out.push(`- ${modified} modifié(s), ${added} ajouté(s), ${removed} retiré(s) (configs, packs…)`);
    out.push('');
  }
  if (!diff.added.length && !diff.updated.length && !diff.removed.length) {
    out.push('_Mise à jour technique du pack._', '');
  }
  out.push('🚀 **Rien à faire** : le launcher installe tout au prochain lancement.');
  fs.writeFileSync(file, out.join('\n') + '\n');
  return file;
}

/** modpack.version dans launcher.json. */
function bumpLauncherVersion(dataRepoDir, version) {
  const file = path.join(dataRepoDir, 'launcher.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  cfg.modpack = cfg.modpack ?? {};
  cfg.modpack.version = version;
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return file;
}

module.exports = { readModMeta, modIndex, buildDiff, diffToLines, writeChangelogEntry, writeAnnouncement, bumpLauncherVersion };

/* ───────────────────────── CLI ───────────────────────────── */
if (require.main === module) {
  const [packDir, version, dataRepoDir] = process.argv.slice(2);
  if (!packDir || !version || !dataRepoDir) {
    console.error('Usage : node tools/packtool.js <dossier-du-pack> <version> <dossier-meytopia-data>');
    process.exit(1);
  }
  if (!fs.existsSync(packDir)) { console.error(`Dossier introuvable : ${packDir}`); process.exit(1); }
  if (!fs.existsSync(dataRepoDir)) { console.error(`Dépôt data introuvable : ${dataRepoDir}`); process.exit(1); }
  if (!AdmZip) console.log('ℹ adm-zip absent (npm install adm-zip --save-dev) : noms de mods limités aux noms de fichiers.\n');

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

  /* 2) Ancien manifest (delta + diff des patchnotes) */
  const manifestPath = path.join(dataRepoDir, 'manifest.json');
  let oldManifest = null;
  let oldFiles = new Map();
  try {
    oldManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
    oldFiles = new Map((oldManifest.files ?? []).map((f) => [f.path, f]));
    console.log(`Ancien manifest : ${oldFiles.size} fichier(s) (version ${oldManifest.version ?? '?'})`);
  } catch {
    console.log('Aucun manifest existant : publication complète.');
  }

  /* 3) Scan du pack (+ identité des mods) */
  const files = [];
  const toUpload = [];
  for (const dir of MANAGED_DIRS) {
    for (const rel of listFiles(packDir, dir)) {
      const abs = path.join(packDir, rel);
      const stat = fs.statSync(abs);
      const sha1 = sha1File(abs);
      const previous = oldFiles.get(rel);
      const entry = { path: rel, sha1, size: stat.size, url: null };
      if (rel.startsWith('mods/') && rel.endsWith('.jar')) entry.mod = readModMeta(abs);
      if (previous && String(previous.sha1).toLowerCase() === sha1) {
        entry.url = previous.url; // inchangé : URL de la release précédente (delta, CDC §6.2)
      } else {
        entry.url = `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(assetName(rel))}`;
        toUpload.push({ abs, name: assetName(rel) });
      }
      files.push(entry);
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

  /* 5) Manifest */
  const manifest = {
    version,
    generatedAt: new Date().toISOString(),
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`manifest.json écrit (${files.length} fichiers)`);

  /* 6) Patchnotes pro + annonce + bump (K1/K2) */
  const diff = buildDiff(oldManifest, files);
  const lines = diffToLines(diff);
  writeChangelogEntry(dataRepoDir, version, lines);
  console.log(`changelog.json : entrée Modpack ${version} (${lines.length} ligne(s))`);
  const hadLegacy = oldManifest && (oldManifest.files ?? []).some((f) => String(f.path).startsWith('mods/') && !f.mod);
  if (hadLegacy) console.log('ℹ Ancien manifest sans identités de mods : diff par noms de fichiers pour cette fois, complet dès la prochaine version.');
  const annonce = writeAnnouncement(dataRepoDir, version, diff);
  console.log(`Annonce Discord prête : ${annonce}`);
  bumpLauncherVersion(dataRepoDir, version);
  console.log('launcher.json : modpack.version =', version);

  console.log('\nDernière étape (ou utilise publier-pack.ps1 qui fait tout) :');
  console.log('  git -C <meytopia-data> add manifest.json changelog.json launcher.json');
  console.log(`  git -C <meytopia-data> commit -m "Modpack ${version}" && git -C <meytopia-data> push`);
}
