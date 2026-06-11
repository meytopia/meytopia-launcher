# ============================================================
# Meytopia — publier.ps1 v2
# Publie une version du LAUNCHER. Trois modes :
#   .\publier.ps1 0.0.7              -> build local + release (mode habituel)
#   .\publier.ps1 0.0.7 -Cloud       -> GitHub Actions construit et publie (tag)
#   .\publier.ps1 0.0.7-beta.1 -Beta -> prerelease pour le canal beta
# Voir OUTILS-ADMIN.md pour le detail.
# ============================================================
param(
  [Parameter(Mandatory=$true)][string]$Version,
  [switch]$Beta,
  [switch]$Cloud
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if ($Beta -and $Version -notmatch "-beta\.\d+$") { throw "Version beta attendue au format X.Y.Z-beta.N (ex: 0.0.7-beta.1)" }
if (-not $Beta -and $Version -match "-") { throw "Version stable attendue au format X.Y.Z (ajoute -Beta pour une prerelease)" }

# 1) Version + commit + push
npm version $Version --no-git-tag-version
git add package.json package-lock.json
git commit -m "Version $Version"
git push

# 2cloud) Publication par GitHub Actions : on pousse simplement le tag
if ($Cloud) {
  git tag "v$Version"
  git push origin "v$Version"
  Write-Host ""
  Write-Host "Tag v$Version pousse : GitHub Actions construit et publie la release (~5 min)." -ForegroundColor Green
  Write-Host "Suivi : https://github.com/meytopia/meytopia-launcher/actions" -ForegroundColor Yellow
  exit 0
}

# 2) Build local (sans l'upload electron-builder, peu fiable)
npx electron-builder --publish never

# 3) Noms a tirets (GitHub remplace les espaces par des points)
Copy-Item "dist\Meytopia Launcher Setup $Version.exe" "dist\Meytopia-Launcher-Setup-$Version.exe" -Force
Copy-Item "dist\Meytopia Launcher Setup $Version.exe.blockmap" "dist\Meytopia-Launcher-Setup-$Version.exe.blockmap" -Force

# 4) Release via gh, avec les bons fichiers de canal
$assets = @(
  "dist\Meytopia-Launcher-Setup-$Version.exe",
  "dist\Meytopia-Launcher-Setup-$Version.exe.blockmap"
)
if ($Beta) {
  $assets += "dist\beta.yml"
  gh release create "v$Version" --repo meytopia/meytopia-launcher --title "v$Version (beta)" --notes "Meytopia Launcher $Version - canal beta" --prerelease @assets
} else {
  # Les clients beta suivent aussi les versions stables : copie du canal
  Copy-Item "dist\latest.yml" "dist\beta.yml" -Force
  $assets += @("dist\latest.yml", "dist\beta.yml")
  gh release create "v$Version" --repo meytopia/meytopia-launcher --title "v$Version" --notes "Meytopia Launcher $Version" @assets
}

# 5) Controle final
gh release view "v$Version" --repo meytopia/meytopia-launcher --json assets -q ".assets[].name"
Write-Host "Release v$Version publiee." -ForegroundColor Green
