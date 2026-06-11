# ============================================================
# Meytopia — publier-pack.ps1 (K2)
# Publie une version du MODPACK en une commande :
# manifest + release GitHub + patchnotes pro + annonce Discord
# + bump launcher.json + commit/push de meytopia-data.
# Usage : .\publier-pack.ps1 1.1.0
# ============================================================
param(
  [Parameter(Mandatory=$true)][string]$Version,
  [string]$Pack = "..\pack",
  [string]$Data = "..\meytopia-data"
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$packDir = (Resolve-Path $Pack).Path
$dataDir = (Resolve-Path $Data).Path

Write-Host "=== Modpack $Version : manifest, release, patchnotes ===" -ForegroundColor Cyan
node tools\packtool.js "$packDir" $Version "$dataDir"
if ($LASTEXITCODE -ne 0) { throw "packtool a echoue (code $LASTEXITCODE)." }

Write-Host ""
Write-Host "=== Publication de meytopia-data ===" -ForegroundColor Cyan
git -C "$dataDir" add manifest.json changelog.json launcher.json
git -C "$dataDir" commit -m "Modpack $Version"
git -C "$dataDir" push

Write-Host ""
Write-Host "Modpack $Version publie. Effet communaute d'ici ~5 minutes." -ForegroundColor Green
$annonce = Join-Path $dataDir "annonce-modpack-$Version.md"
if (Test-Path $annonce) {
  Write-Host "--- Annonce Discord (copie-colle) : $annonce ---" -ForegroundColor Yellow
  Get-Content $annonce
}
