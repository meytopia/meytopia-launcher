#!/usr/bin/env node
/* Tests de non-régression des modules du PROCESSUS PRINCIPAL (sync.js, accounts.js).
   Electron et minecraft-java-core sont remplacés par des bouchons ; on exécute le VRAI code.
   Verrouille des invariants sensibles trouvés à l'audit de la vague C (0.28.0) :
     - un fichier .part POSÉ PAR LE JOUEUR (sans méta .part.sha1) n'est JAMAIS supprimé (CDC F5)
       et reste signalé « hors modpack » ;
     - les restes .part DU LAUNCHER (paire .part + .part.sha1) sont ignorés du scan et nettoyés
       quand ils deviennent orphelins, mais conservés tant que le fichier est à télécharger ;
     - la reconnexion bascule le compte actif quand l'ancien était cassé, sans le voler s'il est sain.
   Lancé à la main (node tools/main-test.js) et en CI. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meytopia-main-test-'));
const dataDir = path.join(tmp, '.meytopia');
const gameDir = path.join(dataDir, 'game');
fs.mkdirSync(path.join(gameDir, 'mods'), { recursive: true });
fs.mkdirSync(path.join(gameDir, 'config', 'mymod'), { recursive: true });

// ── Bouchons stables (mêmes instances vues par les modules ET par le test) ──
let mockActive = null;                 // settings.activeAccount
let nextAuth = null;                   // profil renvoyé par Microsoft().getAuth
let refreshResult = (p) => p;          // comportement de Microsoft().refresh
const settingsMock = {
  read: () => ({ dataDir, activeAccount: mockActive }),
  write: (patch) => { if ('activeAccount' in patch) mockActive = patch.activeAccount; },
};
const electronStub = { app: { getPath: () => dataDir }, safeStorage: { isEncryptionAvailable: () => false } };
class MicrosoftStub { async getAuth() { return nextAuth; } async refresh(p) { return refreshResult(p); } }
const mjcStub = { Microsoft: MicrosoftStub };
const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'electron') return electronStub;
  if (id === './settings') return settingsMock;      // pour paths.js
  if (id === 'minecraft-java-core') return mjcStub;  // pour accounts.js
  return orig.apply(this, arguments);
};

const sync = require(path.join(ROOT, 'src', 'main', 'sync.js'));
// downloads.run stubé : on ne télécharge rien (succès instantané), on teste la logique de diff/ménage.
const dlPath = require.resolve(path.join(ROOT, 'src', 'main', 'downloads.js'));
require(dlPath);
require.cache[dlPath].exports.run = async () => true;

let fails = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) fails++; };
const g = (...p) => path.join(gameDir, ...p);
const sha = 'a'.repeat(40);
const crypto = require('crypto');
const fooSha = crypto.createHash('sha1').update('foo').digest('hex');
const manifest = (files) => ({ version: '1.0.0', files });

(async () => {
  console.log('launcher (processus principal) — non-régression');

  // ── sync.js : .part joueur vs .part launcher ──
  // Reste launcher (paire) pour un fichier ENCORE à télécharger → conservé (reprise).
  fs.writeFileSync(g('mods', 'bar.jar.part'), 'xx');
  fs.writeFileSync(g('mods', 'bar.jar.part.sha1'), sha);
  // Fichier déjà à jour.
  fs.writeFileSync(g('mods', 'foo.jar'), 'foo');
  // .part DU JOUEUR (sans méta) — ne doit jamais bouger, et rester signalé.
  fs.writeFileSync(g('mods', 'FirefoxPartial.jar.part'), 'partiel navigateur');
  fs.writeFileSync(g('config', 'mymod', 'winter.part'), 'reglages joueur');

  const r1 = await sync.syncPack(manifest([
    { path: 'mods/foo.jar', url: 'https://github.com/x', sha1: fooSha, size: 3 },
    { path: 'mods/bar.jar', url: 'https://github.com/x', sha1: sha, size: 999 },
  ]));
  ok('reste launcher .part/.part.sha1 jamais dans « hors modpack »', r1.unknown.indexOf('mods/bar.jar.part') < 0 && r1.unknown.indexOf('mods/bar.jar.part.sha1') < 0);
  ok('.part du JOUEUR (sans méta) signalé « hors modpack »', r1.unknown.indexOf('mods/FirefoxPartial.jar.part') >= 0);
  ok('reste launcher conservé tant que le fichier est à télécharger (reprise)', fs.existsSync(g('mods', 'bar.jar.part')) && fs.existsSync(g('mods', 'bar.jar.part.sha1')));
  ok('.part du JOUEUR jamais supprimé (mods/)', fs.existsSync(g('mods', 'FirefoxPartial.jar.part')));

  // Orphelin launcher : fichier retiré du manifest → paire effacée ; .part joueur intact.
  fs.writeFileSync(g('mods', 'old.jar.part'), 'zz');
  fs.writeFileSync(g('mods', 'old.jar.part.sha1'), sha);
  const r2 = await sync.syncPack(manifest([{ path: 'mods/foo.jar', url: 'https://github.com/x', sha1: fooSha, size: 3 }]));
  ok('orphelin launcher (paire) effacé quand retiré du manifest', !fs.existsSync(g('mods', 'old.jar.part')) && !fs.existsSync(g('mods', 'old.jar.part.sha1')));
  ok('reste launcher bar.* effacé quand bar quitte le manifest', !fs.existsSync(g('mods', 'bar.jar.part')));
  ok('.part joueur (mods/) TOUJOURS conservé après ménage', fs.existsSync(g('mods', 'FirefoxPartial.jar.part')));
  ok('.part joueur (config/, sous-dossier) TOUJOURS conservé', fs.existsSync(g('config', 'mymod', 'winter.part')));
  ok('.part joueur toujours signalé « hors modpack »', r2.unknown.indexOf('mods/FirefoxPartial.jar.part') >= 0);

  // onDownloadStart appelé quand il y a des fichiers à télécharger (sinon état figé « Vérification X/X »).
  fs.rmSync(g('mods', 'foo.jar'), { force: true });
  let started = 0, checks = 0;
  await sync.syncPack(
    manifest([{ path: 'mods/foo.jar', url: 'https://github.com/x', sha1: fooSha, size: 3 }]),
    () => { checks++; },
    (n) => { started = n; },
  );
  ok('onProgress (vérification) appelé', checks >= 1);
  ok('onDownloadStart appelé avec le nombre de fichiers', started === 1);
  // sync.retry (downloads:retry) : syncPack SANS onDownloadStart ne casse pas.
  ok('syncPack sans onDownloadStart ne plante pas (chemin Relancer)', (await sync.retry()) && true);

  // ── accounts.js : bascule de compte à la reconnexion ──
  delete require.cache[require.resolve(path.join(ROOT, 'src', 'main', 'accounts.js'))];
  const accounts = require(path.join(ROOT, 'src', 'main', 'accounts.js'));

  mockActive = null;
  nextAuth = { uuid: 'A', name: 'Alexis' };
  await accounts.add();
  ok('premier compte devient actif', mockActive === 'A');

  refreshResult = () => ({ error: 'expired' });
  await accounts.refreshAll();
  refreshResult = (p) => p;
  ok('compte actif marqué « reconnexion requise » après refresh échoué', accounts.summary().find((a) => a.uuid === 'A').needsRelogin === true);

  nextAuth = { uuid: 'B', name: 'FrereCadet' };
  const addB = await accounts.add();
  ok('reconnexion avec un AUTRE compte réussit', addB.ok);
  ok('reconnexion bascule l\'actif sur le nouveau compte (ancien cassé)', mockActive === 'B');
  ok('le nouvel actif est sain', accounts.summary().find((a) => a.active).needsRelogin === false);

  nextAuth = { uuid: 'C', name: 'Copain' };
  await accounts.add();
  ok('ajouter un compte sain supplémentaire ne vole PAS l\'actif', mockActive === 'B');

  if (fails === 0) { console.log('\n✔ launcher (main) : tous les tests passent.'); process.exit(0); }
  console.error('\n✖ launcher (main) : ' + fails + ' test(s) en échec.'); process.exit(1);
})().catch((e) => { console.error('ERREUR', e && e.stack || e); process.exit(1); });
