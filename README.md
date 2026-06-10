# Meytopia Launcher

Launcher officiel du serveur Minecraft communautaire **Meytopia** (NeoForge 1.21.1).
Développé d'après le cahier des charges v1.1 (+ avenant n°1).

## État des phases

- [x] P1 — Squelette : fenêtre, navigation, thème
- [x] P2 — Comptes Microsoft (multi-comptes, sessions chiffrées)
- [x] P3 — Lancement du jeu : Java auto (Mojang), NeoForge, RAM
- [x] P4 — Modpack : manifest, synchro delta, volet téléchargements, packtool
- [x] P5 — Accueil : statut serveur (ping + query), News, Patchnotes
- [x] P6 — Contenus : catalogue approuvé, ajouts perso, blocklist
- [x] P7 — Onboarding, mode dégradé, maintenance, migration du dossier
- [x] P8 — Installeur NSIS + mises à jour automatiques (GitHub Releases)
- [ ] P9 — Panneau d'administration web (meytopia-data)

## Démarrage (développement)

```powershell
npm install
npm start
```

Avant le premier lancement, remplacer le pseudo GitHub dans la config :

```powershell
$user = gh api user -q .login
foreach ($f in "src\main\config.js", "package.json") {
  [IO.File]::WriteAllText($f, ([IO.File]::ReadAllText($f) -replace "__GITHUB_USER__", $user))
}
```

## Publier une version du modpack

```powershell
node tools\packtool.js "C:\chemin\vers\le\pack" 1.0.0 "C:\chemin\vers\meytopia-data"
# puis, dans meytopia-data : git add manifest.json ; git commit -m "Modpack 1.0.0" ; git push
```

Le « pack » est un dossier contenant `mods/`, `config/`, `resourcepacks/`, `shaderpacks/`.

## Publier une version du launcher

```powershell
# Incrémenter "version" dans package.json, puis :
$env:GH_TOKEN = (gh auth token)
npm run publish
```

electron-builder construit l'installeur NSIS et le publie sur GitHub Releases ;
les launchers installés se mettent à jour automatiquement (electron-updater).

## Architecture

- `src/main/` — processus principal : comptes, synchro, téléchargements, jeu, updater
- `src/preload.js` — pont sécurisé (contextBridge)
- `src/renderer/` — interface (HTML/CSS/JS, sans framework)
- `tools/packtool.js` — génération du manifest + upload delta sur GitHub Releases

Les JSON de pilotage (launcher, news, blocklist, optional, changelog, manifest)
vivent dans le dépôt **meytopia-data**.
