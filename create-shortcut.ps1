# DevForge Desktop Shortcut Creator
# Run this script to create a desktop shortcut for DevForge

$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [System.Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $DesktopPath "DevForge.lnk"
$TargetPath = Join-Path $PSScriptRoot "DevForge.bat"
$IconPath = Join-Path $PSScriptRoot "assets\devforge.ico"
$WorkingDir = $PSScriptRoot

# Create the shortcut
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $TargetPath
$Shortcut.WorkingDirectory = $WorkingDir
$Shortcut.Description = "DevForge - AI Development Studio"

# Use custom icon if exists, otherwise use default
if (Test-Path $IconPath) {
    $Shortcut.IconLocation = $IconPath
} else {
    # Use electron icon as fallback
    $ElectronIcon = Join-Path $PSScriptRoot "node_modules\electron\dist\electron.exe"
    if (Test-Path $ElectronIcon) {
        $Shortcut.IconLocation = $ElectronIcon
    }
}

$Shortcut.Save()

Write-Host ""
Write-Host "  ✅ DevForge shortcut created on your Desktop!" -ForegroundColor Green
Write-Host ""
Write-Host "  Location: $ShortcutPath" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Double-click the shortcut to start DevForge" -ForegroundColor White
Write-Host "  The console window will remain open for development" -ForegroundColor Gray
Write-Host ""











