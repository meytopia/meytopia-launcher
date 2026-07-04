#!/usr/bin/env node
/* Tests de non-régression de la connexion serveur (src/main/servers.js).
   dns et prismarine-nbt sont bouchonnés ; on exécute le VRAI joinAddress/ensureServerEntry.
   Verrouille le piège trouvé à l'audit : un domaine SRV-only (meytopia.fr, sans IP directe) ne doit
   JAMAIS recevoir « host:port » (Minecraft couperait le SRV → connexion impossible). Et servers.dat
   illisible ne doit JAMAIS être réécrit (sinon on efface les autres serveurs du joueur). CI + manuel. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meytopia-servers-test-'));
const dataDir = path.join(tmp, '.meytopia');
const gameDir = path.join(dataDir, 'game');
fs.mkdirSync(gameDir, { recursive: true });

// ── Bouchons ──
const dnsState = { srv: async () => { const e = new Error('no srv'); e.code = 'ENODATA'; throw e; },
                   a: async () => { const e = new Error('no a'); e.code = 'ENODATA'; throw e; },
                   aaaa: async () => { const e = new Error('no aaaa'); e.code = 'ENODATA'; throw e; } };
const dnsStub = { promises: {
  resolveSrv: (name) => dnsState.srv(name),
  resolve4: (h) => dnsState.a(h),
  resolve6: (h) => dnsState.aaaa(h),
} };
let nbtState = { parse: async () => { throw new Error('unreadable'); }, write: () => Buffer.from([0x0a, 0x00, 0x00]) };
const nbtStub = { parse: (buf) => nbtState.parse(buf), writeUncompressed: (root) => nbtState.write(root) };
const settingsStub = { read: () => ({ dataDir }), write: () => {} };
const electronStub = { app: { getPath: () => dataDir } };

const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'electron') return electronStub;
  if (id === './settings') return settingsStub;
  if (id === 'dns') return dnsStub;          // servers.js fait require('dns').promises
  if (id === 'prismarine-nbt') return nbtStub;
  return orig.apply(this, arguments);
};

const servers = require(path.join(ROOT, 'src', 'main', 'servers.js'));

let fails = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) fails++; };
const setDns = (o) => Object.assign(dnsState, o);
const OK = async () => [{}];      // SRV/A « présent »
const NO = (code) => async () => { const e = new Error(code); e.code = code; throw e; };

(async () => {
  console.log('launcher (connexion serveur) — non-régression');

  // 1) IP brute → connexion directe host:port, sans DNS
  ok('IP brute → host:port direct', (await servers.joinAddress({ host: '162.55.90.254', port: 25598 })) === '162.55.90.254:25598');

  // 2) SRV présent → NOM SEUL (Minecraft résout le SRV, le port du SRV prime)
  setDns({ srv: OK });
  ok('SRV présent → nom seul', (await servers.joinAddress({ host: 'meytopia.fr', port: 25598 })) === 'meytopia.fr');

  // 3) LE FIX : SRV illisible côté launcher + AUCUNE IP directe (meytopia.fr) → NOM SEUL, jamais host:port
  setDns({ srv: NO('ETIMEOUT'), a: NO('ENODATA'), aaaa: NO('ENODATA') });
  ok('SRV injoignable + pas d\'IP directe → nom seul (PAS host:port)', (await servers.joinAddress({ host: 'meytopia.fr', port: 25598 })) === 'meytopia.fr');

  // 4) Vrai serveur à IP directe + port non standard, sans SRV → host:port (comportement conservé)
  setDns({ srv: NO('ENODATA'), a: async () => ['1.2.3.4'], aaaa: NO('ENODATA') });
  ok('IP directe + port → host:port', (await servers.joinAddress({ host: 'play.exemple.com', port: 25598 })) === 'play.exemple.com:25598');

  // 5) Port par défaut → nom seul même sans SRV
  setDns({ srv: NO('ENODATA'), a: NO('ENODATA'), aaaa: NO('ENODATA') });
  ok('port 25565 → nom seul', (await servers.joinAddress({ host: 'meytopia.fr', port: 25565 })) === 'meytopia.fr');

  // 6) Host vide → chaîne vide (non bloquant en amont)
  ok('host vide → \'\'', (await servers.joinAddress({})) === '');

  // ── ensureServerEntry ──
  const datFile = path.join(gameDir, 'servers.dat');

  // 7) Pas de fichier → écrit + renvoie true
  nbtState.write = () => Buffer.from('NBTDATA');
  const added = await servers.ensureServerEntry('meytopia.fr', 'Meytopia');
  ok('1er ajout (pas de fichier) → true + fichier écrit', added === true && fs.existsSync(datFile));

  // 8) LE FIX : fichier ILLISIBLE → ne PAS réécrire (sinon on efface les serveurs du joueur)
  fs.writeFileSync(datFile, 'les-serveurs-perso-du-joueur-corrompus');
  const before = fs.readFileSync(datFile, 'utf8');
  nbtState.parse = async () => { throw new Error('unreadable'); };
  const res = await servers.ensureServerEntry('meytopia.fr', 'Meytopia');
  ok('servers.dat illisible → renvoie false', res === false);
  ok('servers.dat illisible → fichier PAS écrasé (serveurs du joueur préservés)', fs.readFileSync(datFile, 'utf8') === before);

  if (fails === 0) { console.log('\n✔ launcher (connexion) : tous les tests passent.'); process.exit(0); }
  console.error('\n✖ launcher (connexion) : ' + fails + ' test(s) en échec.'); process.exit(1);
})().catch((e) => { console.error('ERREUR', e && e.stack || e); process.exit(1); });
