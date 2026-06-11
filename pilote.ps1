# ============================================================
# Meytopia — pilote.ps1 (K5)
# Telecommande de launcher.json : edite, committe et pousse.
# Effet sur toute la communaute d'ici ~5 minutes.
#
# Usage :
#   .\pilote.ps1 maintenance on "Redemarrage a 21h" [2026-06-12T21:00:00+02:00]
#   .\pilote.ps1 maintenance off
#   .\pilote.ps1 accent "#F97316"        | .\pilote.ps1 accent off
#   .\pilote.ps1 event "Titre" "Message" 2026-06-12T18:00:00+02:00 2026-06-15T00:00:00+02:00 ["#F59E0B"] [https://lien]
#   .\pilote.ps1 event off
#   .\pilote.ps1 minversion 0.0.6        | .\pilote.ps1 minversion off
#   .\pilote.ps1 servername "Meytopia [ETE]"
#   .\pilote.ps1 intervalle 1
# ============================================================
param(
  [Parameter(Mandatory=$true, Position=0)][string]$Commande,
  [Parameter(Position=1)][string]$A1,
  [Parameter(Position=2)][string]$A2,
  [Parameter(Position=3)][string]$A3,
  [Parameter(Position=4)][string]$A4,
  [Parameter(Position=5)][string]$A5,
  [Parameter(Position=6)][string]$A6,
  [string]$Data = "..\meytopia-data"
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$dataDir = (Resolve-Path $Data).Path
$file = Join-Path $dataDir "launcher.json"
$cfg = Get-Content $file -Raw | ConvertFrom-Json

function SetProp($obj, [string]$name, $value) {
  $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value -Force
}
function Save([string]$message) {
  $json = $cfg | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText($file, $json + "`n", [System.Text.UTF8Encoding]::new($false))
  git -C "$dataDir" add launcher.json
  git -C "$dataDir" commit -m $message
  git -C "$dataDir" push
  Write-Host "Pousse. Effet sur la communaute d'ici ~5 minutes." -ForegroundColor Green
}
function Usage {
  Write-Host "Commandes : maintenance on/off, accent #hex/off, event .../off, minversion X.Y.Z/off, servername, intervalle N" -ForegroundColor Yellow
  Get-Content $PSCommandPath | Select-String "^#   " | ForEach-Object { Write-Host $_.Line.Substring(2) -ForegroundColor DarkGray }
}

switch ($Commande.ToLower()) {
  "maintenance" {
    if ($A1 -eq "on") {
      if (-not $cfg.PSObject.Properties["maintenance"]) { SetProp $cfg "maintenance" ([pscustomobject]@{ active = $true; message = ""; scheduledAt = $null; blockPlay = $true }) }
      $cfg.maintenance.active = $true
      SetProp $cfg.maintenance "message" $(if ($A2) { $A2 } else { "Le serveur est en maintenance." })
      SetProp $cfg.maintenance "scheduledAt" $(if ($A3) { $A3 } else { $null })
      Save "pilote: maintenance on"
    } elseif ($A1 -eq "off") {
      $cfg.maintenance.active = $false
      SetProp $cfg.maintenance "message" ""
      SetProp $cfg.maintenance "scheduledAt" $null
      Save "pilote: maintenance off"
    } else { Usage }
  }
  "accent" {
    if ($A1 -eq "off") {
      if ($cfg.PSObject.Properties["theme"]) { $cfg.PSObject.Properties.Remove("theme") }
      Save "pilote: accent off"
    } elseif ($A1 -match "^#[0-9A-Fa-f]{6}$") {
      if (-not $cfg.PSObject.Properties["theme"]) { SetProp $cfg "theme" ([pscustomobject]@{}) }
      SetProp $cfg.theme "accent" $A1
      Save "pilote: accent $A1"
    } else { Usage }
  }
  "event" {
    if ($A1 -eq "off") {
      if ($cfg.PSObject.Properties["event"]) { $cfg.PSObject.Properties.Remove("event") }
      Save "pilote: event off"
    } elseif ($A1 -and $A2) {
      $ev = [ordered]@{ id = "event-" + (Get-Date -Format "yyyyMMddHHmm"); title = $A1; message = $A2 }
      if ($A3) { $ev.startsAt = $A3 }
      if ($A4) { $ev.endsAt = $A4 }
      if ($A5) { $ev.color = $A5 }
      if ($A6) { $ev.url = $A6 }
      SetProp $cfg "event" ([pscustomobject]$ev)
      Save "pilote: event"
    } else { Usage }
  }
  "minversion" {
    if ($A1 -eq "off") {
      if ($cfg.PSObject.Properties["minLauncherVersion"]) { $cfg.PSObject.Properties.Remove("minLauncherVersion") }
      Save "pilote: minversion off"
    } elseif ($A1 -match "^\d+\.\d+\.\d+$") {
      SetProp $cfg "minLauncherVersion" $A1
      Save "pilote: minversion $A1"
    } else { Usage }
  }
  "servername" {
    if ($A1) { SetProp $cfg.server "name" $A1; Save "pilote: servername" } else { Usage }
  }
  "intervalle" {
    if ($A1 -match "^\d+$") { SetProp $cfg.server "statusIntervalS" ([int]$A1); Save "pilote: intervalle $A1" } else { Usage }
  }
  default { Usage }
}
