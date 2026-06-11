# ============================================================
# Meytopia — stats.ps1 (K6)
# Compteurs de telechargements des releases (launcher + pack).
# Usage : .\stats.ps1
# ============================================================
param([string]$Owner = "meytopia")
$ErrorActionPreference = "Stop"

Write-Host "=== Launcher ===" -ForegroundColor Cyan
$releases = gh api "repos/$Owner/meytopia-launcher/releases?per_page=100" | ConvertFrom-Json
foreach ($r in $releases) {
  $exe = ($r.assets | Where-Object { $_.name -like "*.exe" } | Measure-Object download_count -Sum).Sum
  $yml = ($r.assets | Where-Object { $_.name -eq "latest.yml" } | Measure-Object download_count -Sum).Sum
  Write-Host ("{0,-10} installeur : {1,5}   controles de maj (latest.yml) : {2}" -f $r.tag_name, [int]$exe, [int]$yml)
}

Write-Host ""
Write-Host "=== Modpack ===" -ForegroundColor Cyan
$packs = gh api "repos/$Owner/meytopia-data/releases?per_page=100" | ConvertFrom-Json
foreach ($r in $packs) {
  $sum = ($r.assets | Measure-Object download_count -Sum).Sum
  Write-Host ("{0,-12} {1,3} fichier(s), {2,6} telechargements" -f $r.tag_name, $r.assets.Count, [int]$sum)
}
