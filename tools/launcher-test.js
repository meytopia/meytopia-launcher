#!/usr/bin/env node
/* Test de non-régression des fonctions PURES de la page Communauté du launcher (app.js).
   Les fonctions sont extraites du fichier par ancres (app.js n'est pas un module) puis évaluées
   dans un bac à sable sans DOM. Lancé à la main (node tools/launcher-test.js) et en CI.
   Verrouille : sources de données (totaux réels vs saison), exclusion des joueurs privés,
   jalons collectifs (franchi + prochain cap), plus longue session, formats. */
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'app.js'), 'utf8');

// Extrait une fonction top-level `function name(...) { ... }` (fin = première « } » en colonne 0).
function extractFn(name) {
  const re = new RegExp('^function ' + name + '\\([\\s\\S]*?^\\}', 'm');
  const m = src.match(re);
  if (!m) throw new Error('fonction introuvable : ' + name);
  return m[0];
}
// Extrait une déclaration const top-level d'une ligne.
function extractConst(name) {
  const re = new RegExp('^const ' + name + ' = .*$', 'm');
  const m = src.match(re);
  if (!m) throw new Error('const introuvable : ' + name);
  return m[0];
}

const code = [
  'const escapeHtml = (s) => String(s == null ? "" : s);', // stub suffisant pour les tests (pas de DOM)
  // stubs identiques aux constantes hissées d'app.js (déclarations IIFE multilignes, non extraites)
  'const PULSE_HOUR_FMT = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", hour12: false });',
  'const PARIS_HM_FMT = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", minute: "numeric", hour12: false });',
  extractConst('fmtSlotHM'),
  extractFn('fmtPlayTime'),
  extractFn('fmtShortDate'),
  extractFn('statDayKeys'),
  extractFn('statTodayKey'),
  extractFn('maxSlot'),
  extractFn('dayKeyShift'),
  extractFn('pubEntries'),
  extractFn('fmtKm'),
  extractFn('collectiveStats'),
  extractFn('collectiveMilestones'),
  extractFn('weekActivityHtml'),
  extractFn('computePlayerMetrics'),
  extractFn('percentileOf'),
  extractFn('detectMoments'),
  extractFn('seasonTitles'),
  extractFn('myChallengeShare'),
  extractFn('pulseMessage'),
  'module.exports = { fmtPlayTime, fmtKm, pubEntries, collectiveStats, collectiveMilestones, weekActivityHtml, computePlayerMetrics, percentileOf, detectMoments, seasonTitles, myChallengeShare, pulseMessage, statTodayKey, dayKeyShift };',
].join('\n');
const mod = { exports: {} };
new Function('module', 'require', code)(mod, require);
const L = mod.exports;

let fails = 0;
const check = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) fails++; };
const eq = (name, got, want) => check(`${name} (= ${JSON.stringify(want)}, got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));

// Jeu de données inspiré de l'état réel du serveur (3 joueurs dont les stats des captures) + 1 joueur privé.
const data = {
  version: 5,
  server: { season: 2 },
  seen: {
    Meylou: { uuid: 'u1', minutes: 59, first: '2026-07-01T10:00:00Z', last: '2026-07-01T20:00:00Z',
      mc: { playMin: 953, mobKills: 103, distTotM: 124700, diamonds: 0, fishCaught: 0, adv: 115, noDeathMin: 489 } },
    Alexis: { uuid: 'u2', minutes: 40, first: '2026-07-01T11:00:00Z',
      mc: { playMin: 349, mobKills: 0, distTotM: 7600, diamonds: 8, fishCaught: 2, adv: 43 } },
    Bubbl3: { uuid: 'u3', minutes: 7, first: '2026-07-01T12:00:00Z',
      mc: { playMin: 111, mobKills: 2, distTotM: 9600, diamonds: 0, fishCaught: 0, adv: 26 } },
    Cach3: { uuid: 'up', minutes: 999, first: '2026-07-01T09:00:00Z',
      mc: { playMin: 9999, mobKills: 9999, distTotM: 999999, diamonds: 999, fishCaught: 99, adv: 999 } },
  },
  priv: { up: true },
  days: {},
};

console.log('launcher (page Communauté) — non-régression');

// Confidentialité : le joueur privé est exclu PARTOUT
eq('pubEntries exclut le privé', L.pubEntries(data).map(([n]) => n).sort(), ['Alexis', 'Bubbl3', 'Meylou']);

// Le serveur en chiffres : TOUT en totaux réels (plus de minutes de saison mélangées)
const c = L.collectiveStats(data);
eq('collectiveStats.minutes = somme playMin (totaux réels)', c.minutes, 953 + 349 + 111);
eq('collectiveStats.mobs (privé exclu)', c.mobs, 105);
eq('collectiveStats.distM', c.distM, 141900);
eq('collectiveStats.players', c.players, 3);

// Jalons : cap franchi (100 km à 141.9 km) + prochain cap avec progression
const ms = L.collectiveMilestones(c);
check('jalon 100 km franchi', ms.reached.some((m) => m.includes('100') && m.includes('km')));
check('aucun jalon heures (23 h < 50 h)', !ms.reached.some((m) => m.includes('h de jeu')));
check('prochain cap défini', !!ms.next && ms.next.target > 0);
check('prochain cap = le plus proche en % (heures 47%)', ms.next.label.includes('50') && ms.next.label.includes('h de jeu'));

// fmtKm : format unique fr-FR
check('fmtKm 141900 m → 141,9 km (1 décimale partout)', L.fmtKm(141900) === '141,9 km');
check('fmtKm 124700 m → 124,7 km (virgule fr)', L.fmtKm(124700) === '124,7 km');
check('fmtKm 9000 m → 9 km (zéro superflu coupé)', L.fmtKm(9000) === '9 km');

// computePlayerMetrics : privés exclus + longestSession = minutes PRÉSENTES (les trous ne comptent pas)
const dataDays = JSON.parse(JSON.stringify(data));
dataDays.days = { '2026-07-01': {
  slots: Array(1440).fill(null),
  presence: { Meylou: [600, 601, 602, 604, 605], Cach3: [10, 11, 12] },
  ses: { Meylou: [[36000, 36360]] },
} };
const met = L.computePlayerMetrics(dataDays);
check('metrics exclut le joueur privé', !met.Cach3);
eq('longestSession = 5 minutes présentes (trou d\'1 min toléré mais pas compté)', met.Meylou.longestSession, 5);

// percentileOf : rang exact sous 10 joueurs
eq('percentileOf 3 joueurs → rang exact', L.percentileOf(data, 'adv', 115), 'n°1 sur 3');
check('percentileOf <3 valeurs → null', L.percentileOf(data, 'diamonds', 8) === null);

// detectMoments : privés exclus + saison qui vient d'ouvrir (tous « nouveaux »)
const moments = L.detectMoments(dataDays);
const txt = moments.map((m) => m.text).join(' | ');
check('moments ne citent jamais le joueur privé', !txt.includes('Cach3'));
check('tous nouveaux → message « saison vient d\'ouvrir »', txt.includes('saison 2 vient d\'ouvrir') || txt.includes('La saison'));

// seasonTitles : titres originaux, gagnants publics
const titles = L.seasonTitles(dataDays, met);
check('seasonTitles renvoie une liste', Array.isArray(titles));
check('titres sans le joueur privé', !titles.some((t) => t.name === 'Cach3'));

// myChallengeShare : contribution personnelle
eq('myChallengeShare mobKills', L.myChallengeShare(data, 'mobKills', 'Meylou'), 103);
eq('myChallengeShare totalPlayMinutes (saison)', L.myChallengeShare(data, 'totalPlayMinutes', 'Meylou'), 59);
check('myChallengeShare inconnu → null', L.myChallengeShare(data, 'mobKills', 'Personne') === null);

// pulseMessage : l'heure Europe/Paris doit être un entier fini (le format fr renvoie « 16 h » —
// Number() donnerait NaN silencieusement) + « inconnu » distinct de « éteint »
{
  const hParis = parseInt(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }).format(new Date()), 10);
  check('heure Europe/Paris parseInt = entier 0-23', Number.isFinite(hParis) && hParis >= 0 && hParis <= 23);
  check('pulseMessage(null) = état inconnu (pas « au repos »)', L.pulseMessage(null, 0).text.includes('inconnu'));
  check('pulseMessage(false) = serveur au repos', L.pulseMessage(false, 0).text.includes('repos'));
  check('pulseMessage(true, 2) renvoie un texte', typeof L.pulseMessage(true, 2).text === 'string');
}

// longestSession : les minutes en DOUBLE (déco/reco dans la même minute) ne comptent qu'une fois
{
  const d2 = JSON.parse(JSON.stringify(data));
  d2.days = { '2026-07-01': { slots: Array(1440).fill(null), presence: { Meylou: [600, 600, 601, 602] }, ses: {} } };
  eq('longestSession dédoublonnée (600,600,601,602 → 3)', L.computePlayerMetrics(d2).Meylou.longestSession, 3);
}

// weekActivityHtml : un jour à 0 joueur = barre VIDE (data-h="0"), le jour actif = barre pleine
{
  const today = L.statTodayKey();
  const d3 = { days: { [today]: { slots: (() => { const s = Array(1440).fill(null); s[600] = 2; return s; })() } } };
  const htmlWeek = L.weekActivityHtml(d3);
  check('semaine : jour actif à 100%', htmlWeek.includes('data-h="100"'));
  check('semaine : jours vides à 0 (pas de plancher 6%)', htmlWeek.includes('data-h="0"') && !htmlWeek.includes('data-h="6"'));
}

// « saison vient d'ouvrir » NE se déclenche PAS si un joueur (même privé) est ancien
{
  const d4 = JSON.parse(JSON.stringify(dataDays));
  d4.seen.Cach3.first = '2026-05-01T09:00:00Z'; // le joueur privé est un vétéran → la saison n'est PAS neuve
  const txt4 = L.detectMoments(d4).map((m) => m.text).join(' | ');
  check('vétéran présent → pas de « saison vient d\'ouvrir »', !txt4.includes('vient d\'ouvrir'));
  check('vétéran présent → « premiers pas » à la place', txt4.includes('premiers pas'));
}

// FIXTURE RÉALISTE DE PRODUCTION : la sonde ne publie JAMAIS les privés dans seen — c'est privCount
// (compteur anonyme) qui signale leur existence. Des vétérans cachés ne doivent pas faire croire à
// une ouverture de saison.
{
  const d5 = JSON.parse(JSON.stringify(dataDays));
  delete d5.seen.Cach3; // comme en prod : le privé n'est pas publié
  d5.privCount = 1;     // …mais le mod signale 1 joueur privé (peut-être un vétéran)
  const txt5 = L.detectMoments(d5).map((m) => m.text).join(' | ');
  check('privCount > 0 → pas de « saison vient d\'ouvrir »', !txt5.includes('vient d\'ouvrir'));
  check('privCount > 0 → « premiers pas » à la place', txt5.includes('premiers pas'));
}

// Saison ANCIENNE restée calme : firstStartAt fait foi, pas les dates d'arrivée des joueurs
{
  const d6 = JSON.parse(JSON.stringify(dataDays));
  delete d6.seen.Cach3;
  d6.privCount = 0;
  d6.server.firstStartAt = '2026-05-15T08:00:00Z'; // saison ouverte il y a 6 semaines
  const txt6 = L.detectMoments(d6).map((m) => m.text).join(' | ');
  check('saison ancienne → pas de « vient d\'ouvrir » même si tous récents', !txt6.includes('vient d\'ouvrir'));
}

// Cas nominal : saison jeune + aucun privé + tous récents → le message d'ouverture s'affiche bien
{
  const d7 = JSON.parse(JSON.stringify(dataDays));
  delete d7.seen.Cach3;
  d7.privCount = 0;
  d7.server.firstStartAt = new Date(Date.now() - 2 * 86400000).toISOString(); // ouverte avant-hier
  const txt7 = L.detectMoments(d7).map((m) => m.text).join(' | ');
  check('saison jeune + 0 privé → « vient d\'ouvrir » affiché', txt7.includes('vient d\'ouvrir'));
}

if (fails === 0) { console.log('\n✔ launcher : tous les tests passent.'); process.exit(0); }
console.error('\n✖ launcher : ' + fails + ' test(s) en échec.'); process.exit(1);
