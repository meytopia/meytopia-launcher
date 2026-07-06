#!/usr/bin/env node
/* Tests de non-régression de l'activation auto des packs (src/main/activation.js).
   Verrouille : options.txt patché SANS toucher au reste (et jamais créé s'il n'existe pas),
   respect du choix du joueur (jamais re-forcé), iris.properties qui préserve les réglages,
   et zéro écriture quand le manifest n'a ni resourcepack ni shaderpack. CI + manuel. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meytopia-activation-test-'));
const dataDir = path.join(tmp, '.meytopia');
const gameDir = path.join(dataDir, 'game');
fs.mkdirSync(gameDir, { recursive: true });

const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'electron') return { app: { getPath: () => dataDir } };
  if (id === './settings') return { read: () => ({ dataDir }), write: () => {} };
  return orig.apply(this, arguments);
};
const act = require(path.join(ROOT, 'src', 'main', 'activation.js'));

let fails = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) fails++; };
const optionsFile = path.join(gameDir, 'options.txt');
const irisFile = path.join(gameDir, 'config', 'iris.properties');
const manifest = (paths) => ({ files: paths.map((p) => ({ path: p, sha1: 'a'.repeat(40) })) });

console.log('launcher (activation packs) — non-régression');

// 1) Manifest sans rp/sp → aucune écriture (ni options.txt, ni iris, ni marqueur)
let r = act.applyPackActivation(manifest(['mods/foo.jar']));
ok('manifest sans packs → rien activé', r.resourcepacks.length === 0 && r.shaderpack === null);
ok('manifest sans packs → aucun fichier créé', !fs.existsSync(optionsFile) && !fs.existsSync(irisFile));

// 2) options.txt ABSENT → resourcepack PAS activé (on n'invente pas le fichier), retenté plus tard
r = act.applyPackActivation(manifest(['resourcepacks/textures.zip']));
ok('options.txt absent → pas d\'activation forcée', r.resourcepacks.length === 0);
ok('options.txt absent → fichier toujours pas créé', !fs.existsSync(optionsFile));

// 3) options.txt présent → "file/textures.zip" ajouté EN FIN, reste du fichier intact (CRLF préservé)
fs.writeFileSync(optionsFile, 'version:3955\r\nresourcePacks:["vanilla","mod_resources"]\r\nfov:0.0\r\n');
r = act.applyPackActivation(manifest(['resourcepacks/textures.zip']));
let txt = fs.readFileSync(optionsFile, 'utf8');
ok('resourcepack activé', r.resourcepacks.join() === 'textures.zip');
ok('ajout en fin de liste (priorité max)', txt.includes('resourcePacks:["vanilla","mod_resources","file/textures.zip"]'));
ok('autres lignes intactes', txt.includes('version:3955') && txt.includes('fov:0.0'));
ok('fins de ligne CRLF préservées', txt.includes('resourcePacks:["vanilla","mod_resources","file/textures.zip"]\r\nfov'));

// 4) Le joueur retire le pack de sa liste → JAMAIS re-forcé (mémoire activation.json)
fs.writeFileSync(optionsFile, 'version:3955\r\nresourcePacks:["vanilla","mod_resources"]\r\nfov:0.0\r\n');
r = act.applyPackActivation(manifest(['resourcepacks/textures.zip']));
txt = fs.readFileSync(optionsFile, 'utf8');
ok('choix du joueur respecté (pas re-forcé)', r.resourcepacks.length === 0 && !txt.includes('file/textures.zip'));

// 5) NOUVEAU resourcepack dans le pack → activé, sans doublon de l'ancien
r = act.applyPackActivation(manifest(['resourcepacks/textures.zip', 'resourcepacks/noel.zip']));
txt = fs.readFileSync(optionsFile, 'utf8');
ok('nouveau pack activé, ancien laissé au choix du joueur', r.resourcepacks.join() === 'noel.zip'
  && txt.includes('"file/noel.zip"') && !txt.includes('"file/textures.zip"'));

// 6) Ligne resourcePacks illisible → AUCUNE écriture (zéro corruption)
fs.writeFileSync(optionsFile, 'resourcePacks:PAS-DU-JSON\r\nfov:0.0\r\n');
const before = fs.readFileSync(optionsFile, 'utf8');
r = act.applyPackActivation(manifest(['resourcepacks/autre.zip']));
ok('ligne illisible → fichier intact', fs.readFileSync(optionsFile, 'utf8') === before && r.resourcepacks.length === 0);

// 7) Shaderpack : iris.properties créé avec enableShaders + shaderPack
r = act.applyPackActivation(manifest(['shaderpacks/Complementary.zip']));
let iris = fs.readFileSync(irisFile, 'utf8');
ok('shaderpack activé', r.shaderpack === 'Complementary.zip');
ok('iris.properties : enableShaders=true + shaderPack', iris.includes('enableShaders=true') && iris.includes('shaderPack=Complementary.zip'));

// 8) Le joueur change de shader → PAS re-forcé (même nom dans le manifest)
fs.writeFileSync(irisFile, 'enableShaders=false\nshaderPack=SonShaderALui.zip\nmaxShadowRenderDistance=8\n');
r = act.applyPackActivation(manifest(['shaderpacks/Complementary.zip']));
iris = fs.readFileSync(irisFile, 'utf8');
ok('choix de shader du joueur respecté', r.shaderpack === null && iris.includes('SonShaderALui.zip'));

// 9) NOUVEAU shader dans le pack → activé, réglages Iris du joueur préservés
r = act.applyPackActivation(manifest(['shaderpacks/BSL.zip']));
iris = fs.readFileSync(irisFile, 'utf8');
ok('nouveau shader activé', r.shaderpack === 'BSL.zip' && iris.includes('shaderPack=BSL.zip') && iris.includes('enableShaders=true'));
ok('autres réglages Iris préservés', iris.includes('maxShadowRenderDistance=8'));

// 10) Entrée enabled:false ou en sous-dossier → ignorée
r = act.applyPackActivation({ files: [
  { path: 'resourcepacks/off.zip', enabled: false },
  { path: 'resourcepacks/sous/dossier.zip' },
] });
ok('enabled:false + sous-dossier ignorés', r.resourcepacks.length === 0);

// 11) A → B → A : le shader A (déjà vu) n'est JAMAIS re-forcé (mémoire = LISTE, pas dernier nom)
// (à ce stade la liste contient déjà Complementary.zip [test 7] et BSL.zip [test 9])
fs.writeFileSync(irisFile, 'enableShaders=false\nshaderPack=ChoixDuJoueur.zip\n');
r = act.applyPackActivation(manifest(['shaderpacks/Complementary.zip'])); // retour à un ancien shader
iris = fs.readFileSync(irisFile, 'utf8');
ok('A→B→A : shader déjà vu non re-forcé', r.shaderpack === null && iris.includes('ChoixDuJoueur.zip'));

// 12) Migration de l'ancien marqueur (shaderpack: "nom" unique) → traité comme déjà activé
const markerPath = path.join(dataDir, 'launcher', 'activation.json');
fs.mkdirSync(path.dirname(markerPath), { recursive: true });
fs.writeFileSync(markerPath, JSON.stringify({ resourcepacks: [], shaderpack: 'Ancien.zip' }));
fs.writeFileSync(irisFile, 'shaderPack=ChoixDuJoueur.zip\n');
r = act.applyPackActivation(manifest(['shaderpacks/Ancien.zip']));
ok('migration ancien format → shader déjà vu non re-forcé', r.shaderpack === null && fs.readFileSync(irisFile, 'utf8').includes('ChoixDuJoueur.zip'));

// 13) Écriture atomique : aucun fichier .tmp ne traîne après activation
fs.rmSync(markerPath, { force: true });
fs.writeFileSync(optionsFile, 'resourcePacks:["vanilla"]\nfov:0.0\n');
act.applyPackActivation(manifest(['resourcepacks/atomic.zip', 'shaderpacks/Atomic.zip']));
const leftovers = [optionsFile + '.tmp', irisFile + '.tmp', markerPath + '.tmp'].filter((f) => fs.existsSync(f));
ok('aucun .tmp résiduel après écriture atomique', leftovers.length === 0);

if (fails === 0) { console.log('\n✔ launcher (activation) : tous les tests passent.'); process.exit(0); }
console.error('\n✖ launcher (activation) : ' + fails + ' test(s) en échec.'); process.exit(1);
