// ============================================================
// Meytopia Launcher — Activation auto des packs fournis
// Le modpack peut contenir resourcepacks/*.zip et shaderpacks/* :
// la synchro les INSTALLE (fichiers) ; ce module les ACTIVE —
// UNE seule fois chacun. Ensuite le choix du joueur est roi :
// s'il désactive un pack en jeu, on ne le lui re-force jamais
// (mémoire activation.json). Tout est best-effort : un échec
// ici ne bloque JAMAIS le lancement du jeu.
// ============================================================
const fs = require('fs');
const path = require('path');
const { getGameDir, getLauncherDir } = require('./paths');

const markerFile = () => path.join(getLauncherDir(), 'activation.json');

function readMarker() {
  try {
    const m = JSON.parse(fs.readFileSync(markerFile(), 'utf8'));
    const shaderpacks = Array.isArray(m.shaderpacks) ? m.shaderpacks.slice() : [];
    // Migration ancien format (un seul nom) → liste, pour ne jamais re-forcer un shader déjà vu.
    if (typeof m.shaderpack === 'string' && m.shaderpack && !shaderpacks.includes(m.shaderpack)) shaderpacks.push(m.shaderpack);
    return { resourcepacks: Array.isArray(m.resourcepacks) ? m.resourcepacks : [], shaderpacks };
  } catch { return { resourcepacks: [], shaderpacks: [] }; }
}
// Écriture ATOMIQUE : fichier temporaire puis renameSync (le rename est atomique sur le même disque).
// Un crash/coupure en plein milieu ne laisse JAMAIS un fichier vide ou tronqué — c'est le .tmp qui
// serait incomplet, pas la cible. Même garantie que downloads.js pour les téléchargements.
function writeAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
function writeMarker(m) {
  fs.mkdirSync(getLauncherDir(), { recursive: true });
  writeAtomic(markerFile(), JSON.stringify(m, null, 2));
}

/** Noms de fichiers du manifest directement dans `prefix` (entrées actives uniquement). */
function packEntries(manifest, prefix) {
  return (manifest?.files ?? [])
    .filter((f) => f && f.enabled !== false && typeof f.path === 'string' && f.path.startsWith(prefix))
    .map((f) => f.path.slice(prefix.length))
    .filter((n) => n && !n.includes('/'));
}

/**
 * Ajoute les resourcepacks du pack à la liste active d'options.txt (entrée "file/<nom>").
 * - options.txt ABSENT (avant la toute première partie) : on ne crée PAS un fichier partiel
 *   (Minecraft/NeoForge y écrivent leurs propres valeurs par défaut, dont "mod_resources") —
 *   on réessaiera au prochain lancement, le fichier existera.
 * - Ligne resourcePacks illisible/inattendue : on ne touche à RIEN (zéro risque de corruption).
 * - Ajout en FIN de liste = priorité la plus haute (c'est la convention de Minecraft).
 * @returns {string[]} les noms réellement activés (marqués seulement si écrits).
 */
function activateResourcePacks(names, marker) {
  const fresh = names.filter((n) => !marker.resourcepacks.includes(n));
  if (!fresh.length) return [];
  const file = path.join(getGameDir(), 'options.txt');
  if (!fs.existsSync(file)) return [];
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const eol = txt.includes('\r\n') ? '\r\n' : '\n';
  const lines = txt.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.startsWith('resourcePacks:'));
  if (idx < 0) return [];
  let arr;
  try { arr = JSON.parse(lines[idx].slice('resourcePacks:'.length)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  let changed = false;
  for (const n of fresh) {
    const id = 'file/' + n;
    if (!arr.includes(id)) { arr.push(id); changed = true; }
  }
  if (changed) {
    lines[idx] = 'resourcePacks:' + JSON.stringify(arr);
    writeAtomic(file, lines.join(eol));
  }
  return fresh; // déjà dans la liste = considéré activé (plus jamais re-forcé)
}

/**
 * Sélectionne le shaderpack du pack dans la config d'Iris (config/iris.properties).
 * Une seule fois par NOM de shader : si le joueur en change ou coupe les shaders ensuite,
 * on respecte son choix. Les autres réglages Iris du joueur sont préservés.
 * @returns {string|null} le nom activé, ou null si rien à faire.
 */
function activateShaderPack(name, marker) {
  // Liste de TOUS les shaders déjà auto-sélectionnés (pas juste le dernier) : si le pack passe de A à B
  // puis revient à A, on ne re-force pas A par-dessus le choix du joueur (défaut trouvé à l'audit).
  if (!name || marker.shaderpacks.includes(name)) return null;
  const file = path.join(getGameDir(), 'config', 'iris.properties');
  let lines = [];
  if (fs.existsSync(file)) {
    try {
      lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
        .filter((l) => l.trim() !== '')
        .filter((l) => !/^\s*(shaderPack|enableShaders)\s*=/.test(l));
    } catch { return null; }
  }
  lines.push('enableShaders=true');
  lines.push('shaderPack=' + name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, lines.join('\n') + '\n');
  return name;
}

/**
 * Point d'entrée (appelé après une synchro réussie, avant le lancement).
 * S'il y a plusieurs shaderpacks dans le manifest, le PREMIER fait foi.
 */
function applyPackActivation(manifest) {
  const result = { resourcepacks: [], shaderpack: null };
  const marker = readMarker();
  let dirty = false;
  try {
    const done = activateResourcePacks(packEntries(manifest, 'resourcepacks/'), marker);
    if (done.length) { marker.resourcepacks.push(...done); result.resourcepacks = done; dirty = true; }
  } catch { /* best-effort */ }
  try {
    const sp = packEntries(manifest, 'shaderpacks/')[0] || null;
    const done = activateShaderPack(sp, marker);
    if (done) { marker.shaderpacks.push(done); result.shaderpack = done; dirty = true; }
  } catch { /* best-effort */ }
  if (dirty) { try { writeMarker(marker); } catch { /* best-effort */ } }
  return result;
}

module.exports = { applyPackActivation, activateResourcePacks, activateShaderPack, packEntries, readMarker };
