param([Parameter(Mandatory=$true)][string]$Version)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# 1) Version + commit + push
npm version $Version --no-git-tag-version
git add package.json package-lock.json
git commit -m "Version $Version"
git push

# 2) Build local (l'upload electron-builder est contourne, peu fiable)
npx electron-builder --publish never

# 3) Noms a tirets (GitHub remplace les espaces par des points)
Copy-Item "dist\Meytopia Launcher Setup $Version.exe" "dist\Meytopia-Launcher-Setup-$Version.exe" -Force
Copy-Item "dist\Meytopia Launcher Setup $Version.exe.blockmap" "dist\Meytopia-Launcher-Setup-$Version.exe.blockmap" -Force

# 4) Release publiee directement avec les 3 assets, via gh
gh release create "v$Version" --repo meytopia/meytopia-launcher --title "v$Version" --notes "Meytopia Launcher $Version" "dist\Meytopia-Launcher-Setup-$Version.exe" "dist\Meytopia-Launcher-Setup-$Version.exe.blockmap" "dist\latest.yml"

# 5) Controle final : doit lister exactement 3 assets
gh release view "v$Version" --repo meytopia/meytopia-launcher --json assets -q ".assets[].name"
Write-Host "Release v$Version publiee." -ForegroundColor Green
