# 🛠 Outils d'administration Meytopia

Tout se pilote depuis la racine de `meytopia-launcher`, en PowerShell. Les trois dossiers doivent être côte à côte :

```
meytopia\
├── meytopia-launcher\   ← les scripts sont ici
├── meytopia-data\       ← les 6 JSON + le changelog
└── pack\                ← le modpack de référence (mods, config…)
```

## Prérequis (une seule fois)

1. **GitHub CLI** connecté : `gh auth status` (sinon `gh auth login`).
2. **Node.js** (déjà installé pour le launcher) et `npm install` fait dans `meytopia-launcher` (la dépendance `adm-zip` sert à lire l'intérieur des `.jar`).
3. Git configuré (ce qui est déjà le cas si tu pushes).

## Vue d'ensemble

| Script | Rôle | Quand |
|---|---|---|
| `publier.ps1` | Publie une **version du launcher** | Après chaque évolution du code |
| `publier-pack.ps1` | Publie une **version du modpack** | Après chaque ajout/retrait/maj de mod ou config |
| `pilote.ps1` | **Télécommande** : maintenance, événement, couleur… | Au quotidien, sans toucher au code |
| `docteur.ps1` | **Bilan de santé** de toute la chaîne | Au moindre doute, avant un événement |
| `stats.ps1` | Compteurs de **téléchargements** | Par curiosité |

Règle d'or : ces scripts font *modifier → committer → pousser* à ta place. Tu n'édites jamais un JSON distant à la main.

---

## `publier.ps1` — publier le launcher

**Avant** : ajoute l'entrée de version dans `meytopia-data\changelog.json` (c'est elle qui alimente la modale « Quoi de neuf » des joueurs).

### Mode habituel (build local)
```powershell
.\publier.ps1 0.0.7
```
Ce qu'il fait : ① `npm version` + commit + push → ② build de l'installeur (`electron-builder`) → ③ renomme les fichiers avec des tirets (GitHub n'aime pas les espaces) → ④ crée la release `v0.0.7` avec **4 assets** : exe, blockmap, `latest.yml` (canal stable) et `beta.yml` (copie, pour que les testeurs bêta suivent aussi les stables) → ⑤ liste les assets en contrôle final.

### Mode cloud (GitHub Actions construit à ta place)
```powershell
.\publier.ps1 0.0.7 -Cloud
```
Le script pousse seulement le **tag** `v0.0.7` ; le workflow `.github/workflows/release.yml` fait le build et la release sur les serveurs GitHub (~5 min). Suivi en direct dans l'onglet **Actions** du dépôt. Rien à configurer : le jeton est automatique. Pratique quand tu n'es pas sur ton PC de build.

### Mode bêta (canal de test)
```powershell
.\publier.ps1 0.0.7-beta.1 -Beta
```
Crée une **prerelease** avec `beta.yml`. Seuls les launchers ayant activé **Paramètres → À propos → Canal bêta** la reçoivent ; tous les autres l'ignorent totalement. Combinable : `.\publier.ps1 0.0.7-beta.1 -Beta -Cloud`. Idéal pour tester une version sur ton propre PC avant de la donner à tout le monde.

### Comment marchent les canaux
Les launchers stables lisent `latest.yml` de la dernière release *non-bêta*. Les launchers bêta lisent `beta.yml` de la dernière release *toute confondue*. C'est pour ça qu'une release stable embarque les deux fichiers : les testeurs reviennent automatiquement sur la stable quand elle dépasse la bêta.

---

## `publier-pack.ps1` — publier le modpack

```powershell
.\publier-pack.ps1 1.1.0
```
Ce qu'il fait : ① lance `tools\packtool.js` qui scanne `..\pack`, calcule les SHA-1, téléverse **uniquement les fichiers modifiés** (delta) sur la release `pack-1.1.0` de `meytopia-data`, **lit l'identité réelle de chaque mod dans son .jar** (nom officiel + version), écrit les patchnotes dans `changelog.json` (`➕ Create 6.0.4`, `🔁 Sodium : 0.6.13 → 0.6.14`, `➖ …`), génère `annonce-modpack-1.1.0.md` et met `modpack.version` à jour dans `launcher.json` → ② commit + push de `meytopia-data` → ③ **affiche l'annonce Discord** prête à coller.

Notes : les fichiers inchangés gardent l'URL de leur ancienne release (pas de re-téléversement) ; relançable sans risque (l'entrée changelog est remplacée, pas dupliquée) ; options `-Pack` / `-Data` si tes dossiers sont ailleurs.

---

## `pilote.ps1` — la télécommande

Chaque commande édite `launcher.json`, committe et pousse. **Effet sur toute la communauté en ~5 minutes** (durée du cache côté launcher).

```powershell
.\pilote.ps1 maintenance on "Redemarrage a 21h"               # bandeau + Jouer bloqué
.\pilote.ps1 maintenance on "Maintenance" 2026-06-12T21:00:00+02:00   # avec horaire affiché
.\pilote.ps1 maintenance off
.\pilote.ps1 accent "#F97316"                                  # couleur du launcher
.\pilote.ps1 accent off
.\pilote.ps1 event "Event d'ete" "Double XP !" 2026-06-12T18:00:00+02:00 2026-06-15T00:00:00+02:00 "#F59E0B" https://discord.gg/zaXjrpcGat
.\pilote.ps1 event off
.\pilote.ps1 minversion 0.0.6      # bloque les launchers plus vieux (urgence sécurité)
.\pilote.ps1 minversion off
.\pilote.ps1 servername "Meytopia [ETE]"
.\pilote.ps1 intervalle 1          # fréquence (s) du statut serveur
```
La bannière d'événement affiche un **compte à rebours** avant `startsAt` (« commence dans… ») puis pendant (« se termine dans… »). Sans argument valide, le script affiche l'aide.

---

## `docteur.ps1` — bilan de santé

```powershell
.\docteur.ps1
```
Cinq familles de contrôles : ① la dernière release du launcher a bien ses 3+ assets → ② la version distribuée (`latest.yml`) correspond au code local → ③ les **6 JSON** sont joignables et valides → ④ un échantillon de 5 fichiers du pack est réellement téléchargeable → ⑤ le SRV Minecraft résout. Sortie `[OK]`/`[WARN]`/`[ERR]` ; le code retour vaut le nombre d'erreurs (utilisable en script). À lancer avant un événement, après une publication, ou quand un joueur signale un souci.

## `stats.ps1` — l'adoption en chiffres

```powershell
.\stats.ps1
```
Par release du launcher : téléchargements de l'installeur + contrôles de mise à jour (`latest.yml` ≈ taille du parc actif). Par release du pack : nombre de fichiers et téléchargements cumulés.

---

## La CI (GitHub Actions)

- **`meytopia-launcher` → `release.yml`** : à chaque tag `v*`, vérifie que le tag correspond au `package.json` (sinon échec clair), construit l'installeur sur un runner Windows et publie la release — stable ou bêta selon le suffixe de version. C'est le moteur du mode `-Cloud`.
- **`meytopia-data` → `valider.yml`** : à chaque push, `node valider.js` contrôle les 6 JSON (types, dates, URLs https, SHA-1, doublons, traversées de chemin…). Un fichier cassé = **croix rouge + e-mail GitHub avant que le moindre joueur ne le télécharge**. Tu peux aussi le lancer à la main : `node valider.js` dans `meytopia-data`.

## Champs pilotables de `launcher.json`

| Champ | Effet côté joueur |
|---|---|
| `maintenance.{active,message,scheduledAt,blockPlay}` | Bandeau orange + bouton Jouer désactivé |
| `server.{host,port,name,statusIntervalS}` | Cible du statut en ligne, nom affiché, fréquence |
| `event.{id,title,message,startsAt,endsAt,color,url}` | Bannière avec compte à rebours |
| `theme.accent` | Couleur d'accent du launcher |
| `minLauncherVersion` | Verrouille les versions trop anciennes |
| `modpack.{version,mcVersion,loader,manifestUrl}` | Version du pack (géré par `publier-pack.ps1`) |

## Dépannage

**Téléversement raté en plein `publier.ps1`** (coupure réseau…) — la roue de secours, sans tout refaire :
```powershell
Copy-Item "dist\Meytopia Launcher Setup X.Y.Z.exe" "dist\Meytopia-Launcher-Setup-X.Y.Z.exe" -Force
Copy-Item "dist\Meytopia Launcher Setup X.Y.Z.exe.blockmap" "dist\Meytopia-Launcher-Setup-X.Y.Z.exe.blockmap" -Force
gh release upload vX.Y.Z dist\Meytopia-Launcher-Setup-X.Y.Z.exe dist\Meytopia-Launcher-Setup-X.Y.Z.exe.blockmap dist\latest.yml dist\beta.yml --clobber --repo meytopia/meytopia-launcher
```
**`packtool a echoue`** → vérifie `gh auth status` et que `npm install` a bien été fait. **Docteur en `[ERR]` sur un JSON** → ouvre le fichier ; la CI `valider.yml` te dira la ligne exacte. **Tag poussé avec la mauvaise version** → `gh release delete vX.Y.Z --yes`, `git push --delete origin vX.Y.Z`, `git tag -d vX.Y.Z`, puis on recommence proprement.
