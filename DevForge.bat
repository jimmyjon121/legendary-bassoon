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

echo [*] Starting DevForge...
echo [*] Console will show logs for development
echo [*] Close this window to stop the app
echo.
echo ========================================================
echo.

:: Start the development server + electron
call npm run dev

echo.
echo [*] DevForge closed.
pause
