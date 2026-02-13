@echo off
title DevForge - AI Development Studio
cd /d "%~dp0"

echo.
echo  ========================================================
echo              DEVFORGE - AI Development Studio
echo  ========================================================
echo.

:: Check if node_modules exists
if not exist "node_modules" (
    echo [!] Installing dependencies...
    call npm install
    echo.
)

:: Kill any stuck electron processes
taskkill /f /im electron.exe >nul 2>&1
set ELECTRON_RUN_AS_NODE=

echo [*] Starting DevForge...
echo [*] Launching stable app mode (built UI, no Vite dev server)
echo [*] Close this window to stop the app
echo.
echo ========================================================
echo.

:: Start stable Electron app (auto-builds if needed)
call npm run app

echo.
echo [*] DevForge closed.
pause
