# DevForge Desktop Shortcut Creator
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\create-shortcut.ps1
#   powershell -ExecutionPolicy Bypass -File .\create-shortcut.ps1 -Mode Dev
# Or via npm:
#   npm run shortcut
#   npm run shortcut:dev
#
# Creates a clickable icon on the Desktop that launches DevForge.
# Stable mode runs the built UI (fast, no Vite dev server).
# Dev mode runs `npm run dev` with hot reload.

param(
    [ValidateSet('Stable', 'Dev')]
    [string]$Mode = 'Stable'
)

$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [System.Environment]::GetFolderPath('Desktop')

if ($Mode -eq 'Dev') {
    $ShortcutPath = Join-Path $DesktopPath "DevForge (Dev).lnk"
    $TargetPath = Join-Path $PSScriptRoot "DevForge-Dev.bat"
    $Description = "DevForge - Development Mode (Hot Reload)"
} else {
    $ShortcutPath = Join-Path $DesktopPath "DevForge.lnk"
    $TargetPath = Join-Path $PSScriptRoot "DevForge.bat"
    $Description = "DevForge - AI Development Studio"
}

if (-not (Test-Path $TargetPath)) {
    Write-Host ""
    Write-Host "  [X] Launcher not found: $TargetPath" -ForegroundColor Red
    Write-Host "      Make sure you run this script from the project root." -ForegroundColor Red
    Write-Host ""
    exit 1
}

$WorkingDir = $PSScriptRoot

# Resolve the best available icon.
$IconCandidates = @(
    (Join-Path $PSScriptRoot "assets\icon.ico"),
    (Join-Path $PSScriptRoot "assets\devforge.ico"),
    (Join-Path $PSScriptRoot "node_modules\electron\dist\electron.exe")
)
$ResolvedIcon = $IconCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

# Create the shortcut
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $TargetPath
$Shortcut.WorkingDirectory = $WorkingDir
$Shortcut.Description = $Description
if ($ResolvedIcon) {
    $Shortcut.IconLocation = $ResolvedIcon
}
$Shortcut.Save()

Write-Host ""
Write-Host "  [OK] DevForge shortcut created on your Desktop" -ForegroundColor Green
Write-Host ""
Write-Host "  Mode:     $Mode" -ForegroundColor White
Write-Host "  Location: $ShortcutPath" -ForegroundColor Cyan
if ($ResolvedIcon) {
    Write-Host "  Icon:     $ResolvedIcon" -ForegroundColor DarkGray
}
Write-Host ""
Write-Host "  Double-click the shortcut to start DevForge." -ForegroundColor White
Write-Host "  The console window will remain open while the app runs." -ForegroundColor DarkGray
Write-Host ""











