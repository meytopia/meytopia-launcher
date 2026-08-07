#!/usr/bin/env node
/* Test de non-régression des fonctions PURES de la page Communauté du launcher (app.js).
   Les fonctions sont extraites du fichier par ancres (app.js n'est pas un module) puis évaluées
   dans un bac à sable sans DOM. Lancé à la main (node tools/launcher-test.js) et en CI.
   Verrouille : sources de données (totaux réels vs saison), exclusion des joueurs privés,
   jalons collectifs (franchi + prochain cap), plus longue session, formats. */
'use strict';
const fs = require('fs');
const path = require('path');
const EX = require('./extract'); // outillage d'extraction commun (partagé avec la régie)

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'app.js'), 'utf8');

// Adaptateurs liés à `src` : mêmes noms qu'avant, logique déportée dans tools/extract.js.
const extractFn = (name) => EX.extractFn(src, name);
const extractConst = (name) => EX.extractConst(src, name);

const code = [
  'const escapeHtml = (s) => String(s == null ? "" : s);', // stub suffisant pour les tests (pas de DOM)
  // stubs identiques aux constantes hissées d'app.js (déclarations IIFE multilignes, non extraites)
  'const PULSE_HOUR_FMT = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", hour12: false });',
  'const PARIS_HM_FMT = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", minute: "numeric", hour12: false });',
  extractConst('fmtSlotHM'),
  extractFn('fmtPlayTime'),
  extractFn('fmtNum'),
  extractFn('playtime'),
  extractFn('fmtShortDate'),
  extractFn('statDayKeys'),
  extractFn('statTodayKey'),
  extractFn('maxSlot'),
  extractConst('_calcMemo'),
  extractFn('calcMemo'),
  extractFn('dayPeaks'),
  extractFn('dayKeyShift'),
  extractFn('pubEntries'),
  extractFn('fmtKm'),
  extractFn('collectiveStats'),
  extractFn('collectiveMilestones'),
  extractFn('weekActivityHtml'),
  extractFn('computePlayerMetrics'),
  extractConst('computePlayerMetricsMemo'),
  extractFn('survieMoyenne'),
  extractFn('challengeEndsText'),
  extractFn('liveAgeText'),
  extractFn('percentileOf'),
  extractFn('detectMoments'),
  extractFn('seasonTitles'),
  extractFn('myChallengeShare'),
  extractFn('pulseMessage'),
  'module.exports = { fmtPlayTime, fmtNum, playtime, fmtKm, pubEntries, collectiveStats, collectiveMilestones, weekActivityHtml, computePlayerMetrics, computePlayerMetricsMemo, percentileOf, detectMoments, seasonTitles, myChallengeShare, pulseMessage, statTodayKey, dayKeyShift, maxSlot, dayPeaks, challengeEndsText, liveAgeText, survieMoyenne };',
].join('\n');
const mod = { exports: {} };
new Function('module', 'require', code)(mod, require);
const L = mod.exports;

let fails = 0;
const check = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) fails++; };
const eq = (name, got, want) => check(`${name} (= ${JSON.stringify(want)}, got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));

// Dates RELATIVES à maintenant : « nouveau joueur » se juge sur une fenêtre glissante de 7 jours.
// Avec des dates fixes, ces tests s'éteignaient tout seuls au bout d'une semaine (vécu : 4 tests
// tombés en panne silencieusement). Toute fixture liée à cette fenêtre DOIT rester relative.
const ilYa = (jours) => new Date(Date.now() - jours * 86400000).toISOString();

// Jeu de données inspiré de l'état réel du serveur (3 joueurs dont les stats des captures) + 1 joueur privé.
const data = {
  version: 5,
  server: { season: 2 },
  seen: {
    Meylou: { uuid: 'u1', minutes: 59, first: ilYa(2), last: ilYa(2),
      mc: { playMin: 953, mobKills: 103, distTotM: 124700, diamonds: 0, fishCaught: 0, adv: 115, noDeathMin: 489 } },
    Alexis: { uuid: 'u2', minutes: 40, first: ilYa(2),
      mc: { playMin: 349, mobKills: 0, distTotM: 7600, diamonds: 8, fishCaught: 2, adv: 43 } },
    Bubbl3: { uuid: 'u3', minutes: 7, first: ilYa(3),
      mc: { playMin: 111, mobKills: 2, distTotM: 9600, diamonds: 0, fishCaught: 0, adv: 26 } },
    Cach3: { uuid: 'up', minutes: 999, first: ilYa(1),
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
// Le défi « temps de jeu » = VRAI temps Minecraft (mc.playMin 953), cohérent avec « de jeu cumulé ».
eq('myChallengeShare totalPlayMinutes = vrai temps de jeu', L.myChallengeShare(data, 'totalPlayMinutes', 'Meylou'), 953);
// playtime() : préfère totalMin, puis mc.playMin, puis minutes
eq('playtime préfère totalMin', L.playtime({ totalMin: 500, mc: { playMin: 200 }, minutes: 10 }), 500);
eq('playtime → mc.playMin si pas de totalMin', L.playtime({ mc: { playMin: 200 }, minutes: 10 }), 200);
eq('playtime → minutes en dernier repli', L.playtime({ minutes: 10 }), 10);
eq('playtime(vide) = 0', L.playtime(null), 0);
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

// Vague C (0.28.0) — #2 : temps restant d'un défi en français simple
{
  const now = Date.UTC(2026, 6, 3, 12, 0, 0);
  eq('challengeEndsText 3,5 jours → jours entiers', L.challengeEndsText(new Date(now + 3.5 * 86400000).toISOString(), now), 'se termine dans 3 jours');
  eq('challengeEndsText 26 h → 1 jour (singulier)', L.challengeEndsText(new Date(now + 26 * 3600000).toISOString(), now), 'se termine dans 1 jour');
  eq('challengeEndsText 2 h → heures', L.challengeEndsText(new Date(now + 2 * 3600000 + 60000).toISOString(), now), 'se termine dans 2 h');
  eq('challengeEndsText 30 min → moins d\'une heure', L.challengeEndsText(new Date(now + 30 * 60000).toISOString(), now), 'se termine dans moins d\'une heure');
  eq('challengeEndsText passé → vide', L.challengeEndsText(new Date(now - 1000).toISOString(), now), '');
  eq('challengeEndsText date illisible → vide', L.challengeEndsText('pas-une-date', now), '');
}

// Vague C — #3 : âge du dernier relevé live (état honnête au lieu de masquer le bloc)
{
  const now = Date.UTC(2026, 6, 3, 12, 0, 0);
  eq('liveAgeText 2 min', L.liveAgeText(new Date(now - 2 * 60000).toISOString(), now), 'il y a 2 min');
  eq('liveAgeText 90 min → heures', L.liveAgeText(new Date(now - 90 * 60000).toISOString(), now), 'il y a 1 h');
  eq('liveAgeText 30 h → plus d\'un jour', L.liveAgeText(new Date(now - 30 * 3600000).toISOString(), now), 'il y a plus d\'un jour');
  check('liveAgeText horodatage illisible → null', L.liveAgeText('n\'importe quoi', now) === null);
  check('liveAgeText absent → null', L.liveAgeText(undefined, now) === null);
}

// Vague C — #5 : dayPeaks = mêmes pics que maxSlot jour par jour, et mémorisé par relevé
{
  const d8 = { days: {
    '2026-07-01': { slots: (() => { const s = Array(1440).fill(null); s[100] = 3; s[200] = 5; return s; })() },
    '2026-07-02': { slots: Array(1440).fill(null) },
    '2026-07-03': {},
  } };
  const p1 = L.dayPeaks(d8);
  eq('dayPeaks calcule le pic de chaque jour', p1, { '2026-07-01': 5, '2026-07-02': 0, '2026-07-03': 0 });
  check('dayPeaks mémorisé (même objet data → même résultat, sans recalcul)', L.dayPeaks(d8) === p1);
  check('computePlayerMetricsMemo mémorisé par relevé', L.computePlayerMetricsMemo(d8) === L.computePlayerMetricsMemo(d8));
  check('dayPeaks({}) et data null : pas de plantage', JSON.stringify(L.dayPeaks({})) === '{}' && JSON.stringify(L.dayPeaks(null)) === '{}');
}

// Vague C — #1 : la semaine affiche des libellés « lun. » (pas une lettre) et une infobulle française
{
  const today = L.statTodayKey();
  const d9 = { days: { [today]: { slots: (() => { const s = Array(1440).fill(null); s[600] = 2; return s; })() } } };
  const w = L.weekActivityHtml(d9);
  check('semaine : infobulle « pic : 2 joueurs » en français', w.includes('pic : 2 joueurs'));
  check('semaine : jours vides « personne » dans l\'infobulle', w.includes('personne'));
  check('semaine : plus de date machine AAAA-MM-JJ dans l\'infobulle', !/title="\d{4}-\d{2}-\d{2}/.test(w));
}

// 0.29.0 — nombres groupés (fmtNum). Parité avec la page publique garantie par le même rendu
// toLocaleString('fr-FR') que stats-core.fmtNum (on compare au rendu réel, pas à un ' ' littéral).
{
  eq('fmtNum 12345 groupé (= page publique)', L.fmtNum(12345), (12345).toLocaleString('fr-FR'));
  eq('fmtNum 1000000 groupé', L.fmtNum(1000000), (1000000).toLocaleString('fr-FR'));
  eq('fmtNum 0', L.fmtNum(0), '0');
  eq('fmtNum arrondit', L.fmtNum(3.7), '4');
  eq('fmtNum non-nombre → 0', L.fmtNum(undefined), '0');
}

// Survie moyenne (nouvelle stat) : temps de jeu ÷ (morts + 1) — ne s'efface JAMAIS, contrairement à
// noDeathMin (= time_since_death, remis à zéro par Minecraft à chaque mort).
{
  eq('survieMoyenne 120 min / 0 mort', L.survieMoyenne({ playMin: 120, deaths: 0 }), 120);
  eq('survieMoyenne 120 min / 3 morts', L.survieMoyenne({ playMin: 120, deaths: 3 }), 30);
  eq('survieMoyenne sans deaths → tout le temps', L.survieMoyenne({ playMin: 60 }), 60);
  eq('survieMoyenne 0 min → null (carte masquée)', L.survieMoyenne({ playMin: 0, deaths: 5 }), null);
  eq('survieMoyenne mc absent → null', L.survieMoyenne(null), null);
  eq('survieMoyenne deaths négatif → ignoré', L.survieMoyenne({ playMin: 60, deaths: -2 }), 60);
  // Cohérence avec le launcher ET le site : mêmes entrées → même résultat (parité web/launcher).
  check('survieMoyenne cohérente pour un joueur réel (953 min, 2 morts → 318)', L.survieMoyenne({ playMin: 953, deaths: 2 }) === 318);
  // Arrondi à 0 (5 min de jeu, 10 morts) : la carte doit être MASQUÉE, comme les classements
  // qui excluent les 0 — sinon le joueur voit « 0 min » sans apparaître nulle part.
  eq('survieMoyenne 5 min / 10 morts → 0 (carte masquée par la garde > 0)', L.survieMoyenne({ playMin: 5, deaths: 10 }), 0);
}

// percentileOf : le joueur COURANT peut être en mode privé (donc absent des listes publiques) — son
// rang ne doit jamais dépasser le total (« n°4 sur 3 »), ni le pourcentage dépasser 100 % (« 108 % »).
{
  const pub = (n) => { const seen = {}; for (let i = 0; i < n; i++) seen['J' + i] = { uuid: 'u' + i, mc: { mobKills: 100 + i } }; return { seen, priv: {} }; };
  // 3 joueurs publics (tous > 5), moi privé avec la plus petite valeur → rang 4 sur 4, pas « 4 sur 3 »
  eq('privé sous tous les publics → « n°4 sur 4 » (jamais 4 sur 3)', L.percentileOf(pub(3), 'mobKills', 5), 'n°4 sur 4');
  // 12 joueurs publics, moi privé dessous → pourcentage borné à 100
  const p = L.percentileOf(pub(12), 'mobKills', 1);
  check('privé sous 12 publics → pourcentage ≤ 100 % (got ' + p + ')', /parmi les (\d+) %/.test(p) && Number(p.match(/parmi les (\d+) %/)[1]) <= 100);
  // Non-régression : un joueur PUBLIC garde exactement l'ancien affichage
  eq('joueur public n°1 sur 3 (inchangé)', L.percentileOf(pub(3), 'mobKills', 102), 'n°1 sur 3');
  eq('joueur public dernier sur 3 (inchangé)', L.percentileOf(pub(3), 'mobKills', 100), 'n°3 sur 3');
}

if (fails === 0) { console.log('\n✔ launcher : tous les tests passent.'); process.exit(0); }
console.error('\n✖ launcher : ' + fails + ' test(s) en échec.'); process.exit(1);
