// ============================================================
// tools/extract.js — extraction de code pour les tests (sans navigateur).
// Les fichiers testés ne sont pas des modules (JS inline d'une page HTML, ou
// gros fichier renderer) : on en extrait des morceaux pour les exécuter isolément.
// Deux modes :
//   • par MARQUEURS explicites — robuste, à préférer pour les zones sensibles :
//       /* TEST-DEBUT:nom */ … code … /* TEST-FIN:nom */
//     (déplacer le code ne casse plus l'extraction ; marqueur manquant/dupliqué = erreur claire) ;
//   • par NOM — pratique pour les fonctions/consts top-level d'un fichier .js.
// Toute extraction échoue BRUYAMMENT (throw) plutôt que de renvoyer un mauvais fragment.
// Fichier identique côté launcher et côté data (outillage commun).
// ============================================================
'use strict';

/** Code situé STRICTEMENT entre les marqueurs `/* TEST-DEBUT:name *​/` et `/* TEST-FIN:name *​/`. */
function extractMarked(src, name) {
  const begin = '/* TEST-DEBUT:' + name + ' */';
  const end = '/* TEST-FIN:' + name + ' */';
  const i = src.indexOf(begin);
  if (i < 0) throw new Error('extract: marqueur TEST-DEBUT introuvable pour « ' + name + ' »');
  if (src.indexOf(begin, i + begin.length) >= 0) throw new Error('extract: marqueur TEST-DEBUT dupliqué pour « ' + name + ' »');
  const j = src.indexOf(end, i + begin.length);
  if (j < 0) throw new Error('extract: marqueur TEST-FIN introuvable pour « ' + name + ' »');
  return src.slice(i + begin.length, j);
}

/** Fonction top-level `function name(...) { ... }` (fin = première « } » en colonne 0). */
function extractFn(src, name) {
  const re = new RegExp('^function ' + name + '\\([\\s\\S]*?^\\}', 'm');
  const m = src.match(re);
  if (!m) throw new Error('extract: fonction introuvable : ' + name);
  return m[0];
}

/** Déclaration `const name = …` sur une seule ligne (top-level). */
function extractConst(src, name) {
  const re = new RegExp('^const ' + name + ' = .*$', 'm');
  const m = src.match(re);
  if (!m) throw new Error('extract: const introuvable : ' + name);
  return m[0];
}

module.exports = { extractMarked, extractFn, extractConst };
