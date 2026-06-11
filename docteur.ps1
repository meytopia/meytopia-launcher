# ============================================================
# Meytopia — docteur.ps1 (K4)
# Bilan de sante complet de la chaine de distribution.
# Usage : .\docteur.ps1
# ============================================================
param(
  [string]$Owner = "meytopia",
  [string]$ServerHost = "meytopia.fr"
)
$script:nbErr = 0
$script:nbWarn = 0
function Line([string]$status, [string]$label, [string]$detail = "") {
  $color = switch ($status) { "OK" { "Green" } "WARN" { "Yellow" } default { "Red" } }
  if ($status -eq "ERR") { $script:nbErr++ }
  if ($status -eq "WARN") { $script:nbWarn++ }
  Write-Host ("[{0,-4}] {1}" -f $status, $label) -ForegroundColor $color
  if ($detail) { Write-Host ("       {0}" -f $detail) -ForegroundColor DarkGray }
}

Write-Host "=== Docteur Meytopia ===" -ForegroundColor Cyan

# 1) Derniere release du launcher : 3 assets attendus
try {
  $rel = gh release view --repo "$Owner/meytopia-launcher" --json tagName,assets | ConvertFrom-Json
  $names = @($rel.assets.name)
  $okAssets = ($names -contains "latest.yml") -and (($names -like "*.exe").Count -ge 1) -and (($names -like "*.blockmap").Count -ge 1)
  if ($okAssets) { Line "OK" "Release launcher $($rel.tagName) complete" ($names -join ", ") }
  else { Line "ERR" "Release launcher $($rel.tagName) incomplete" ($names -join ", ") }
} catch { Line "ERR" "Release launcher illisible" $_.Exception.Message }

# 2) latest.yml vs package.json
try {
  $resp = Invoke-WebRequest -UseBasicParsing "https://github.com/$Owner/meytopia-launcher/releases/latest/download/latest.yml"
  $yml = if ($resp.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($resp.Content) } else { [string]$resp.Content }
  $ymlVer = ([regex]::Match($yml, 'version:\s*(\S+)')).Groups[1].Value
  $pkgVer = (Get-Content (Join-Path $PSScriptRoot "package.json") -Raw | ConvertFrom-Json).version
  if ($ymlVer -eq $pkgVer) { Line "OK" "Version distribuee = code local (v$ymlVer)" }
  else { Line "WARN" "Version distribuee v$ymlVer, code local v$pkgVer" "normal en plein cycle de publication" }
} catch { Line "ERR" "latest.yml injoignable" $_.Exception.Message }

# 3) Les 6 JSON de meytopia-data : joignables et valides
$manifest = $null
foreach ($name in @("launcher", "news", "changelog", "blocklist", "optional", "manifest")) {
  try {
    $doc = Invoke-RestMethod "https://raw.githubusercontent.com/$Owner/meytopia-data/main/$name.json?t=$([DateTime]::Now.Ticks)"
    if ($name -eq "manifest") { $manifest = $doc }
    Line "OK" "$name.json valide et joignable"
  } catch { Line "ERR" "$name.json invalide ou injoignable" $_.Exception.Message }
}

# 4) Echantillon de fichiers du manifest reellement telechargeables
if ($manifest -and $manifest.files.Count -gt 0) {
  $files = @($manifest.files)
  $total = [int]$files.Count
  $picks = @(0, [int][math]::Floor($total / 4), [int][math]::Floor($total / 2), [int][math]::Floor((3 * $total) / 4), ($total - 1)) | Select-Object -Unique
  $bad = 0
  foreach ($i in $picks) {
    try { Invoke-WebRequest -Method Head -UseBasicParsing $files[$i].url | Out-Null }
    catch { $bad++; Line "ERR" "Fichier du pack injoignable" $files[$i].path }
  }
  if ($picks.Count -gt 0 -and $bad -eq 0) { Line "OK" "Fichiers du pack telechargeables ($($picks.Count) testes sur $total)" }
  elseif ($picks.Count -eq 0) { Line "WARN" "Echantillon du pack vide : rien n'a ete teste" }
} else { Line "WARN" "Manifest vide ou illisible : fichiers du pack non testes" }

# 5) SRV Minecraft
try {
  $srv = Resolve-DnsName -Type SRV "_minecraft._tcp.$ServerHost" -ErrorAction Stop | Where-Object { $_.Type -eq "SRV" } | Select-Object -First 1
  Line "OK" "SRV $ServerHost resolu" "$($srv.NameTarget):$($srv.Port)"
} catch { Line "ERR" "SRV $ServerHost introuvable" $_.Exception.Message }

Write-Host ""
if ($script:nbErr -eq 0 -and $script:nbWarn -eq 0) { Write-Host "Tout est vert. La chaine est saine." -ForegroundColor Green }
elseif ($script:nbErr -eq 0) { Write-Host "$($script:nbWarn) avertissement(s), aucune erreur." -ForegroundColor Yellow }
else { Write-Host "$($script:nbErr) erreur(s), $($script:nbWarn) avertissement(s)." -ForegroundColor Red }
exit $script:nbErr
