# Meytopia Launcher

Launcher officiel du serveur Minecraft communautaire **Meytopia**.
Développé d'après le cahier des charges v1.0 (+ avenant n°1).

## Lancer en développement

Prérequis : [Node.js](https://nodejs.org) 20 ou plus récent (LTS conseillé).

```bash
npm install
npm start
```

## Structure du projet

```
src/
├── main/
│   └── main.js        ← processus principal (fenêtre, IPC, sécurité)
├── preload.js         ← pont sécurisé interface ↔ principal (contextBridge)
└── renderer/
    ├── index.html     ← structure de l'interface (barre de titre, nav, pages, volet)
    ├── css/
    │   ├── theme.css  ← charte : toutes les couleurs et variables (CDC §5.1)
    │   └── app.css    ← mise en page et composants
    └── js/
        └── app.js     ← navigation, volet, contrôles fenêtre, toasts
```

## État d'avancement

| Phase | Contenu | État |
|---|---|---|
| **P1** | Squelette sécurisé, fenêtre sans bordure, thème, navigation, pages, volet droit | ✅ Livré |
| P2 | Authentification Microsoft, multi-comptes | À venir |
| P3 | Runtimes Java + lancement du jeu (NeoForge 1.21.1) | À venir |
| P4 | Manifest, synchronisation delta, téléchargements | À venir |
| P5 | Statut serveur, News, Patchnotes | À venir |
| P6 | Page Contenus, blocklist | À venir |
| P7 | Onboarding, Paramètres complets, maintenance | À venir |
| P8 | Installeur NSIS + auto-update | À venir |
| P9 | Panneau d'administration web (GitHub Pages) | À venir |

## Notes

- Le bloc « M » de la barre de titre et le titre « MEYTOPIA » de l'accueil sont des
  **emplacements provisoires** : remplacer par le logo dès qu'il sera fourni
  (commentaires `<!-- Emplacement du logo -->` dans `index.html`).
- Sécurité Electron : `contextIsolation`, `sandbox`, pas de `nodeIntegration`,
  liens externes ouverts uniquement dans le navigateur.
