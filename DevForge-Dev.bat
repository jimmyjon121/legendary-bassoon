@echo off
title DevForge - Development Mode
cd /d "%~dp0"

echo.
echo  ========================================================
echo       DEVFORGE - DEVELOPMENT MODE (Hot Reload)
echo  ========================================================
echo.

:: Kill any stuck electron processes
taskkill /f /im electron.exe >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5173 ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>&1
set ELECTRON_RUN_AS_NODE=

:: Open project in Cursor (or VS Code as fallback)
echo [*] Opening project in editor...
where cursor >nul 2>&1
if %errorlevel%==0 (
    start "" cursor .
    echo     Opened in Cursor
) else (
    where code >nul 2>&1
    if %errorlevel%==0 (
        start "" code .
        echo     Opened in VS Code
    ) else (
        echo     No editor found, skipping...
    )
)

:: Wait a moment for editor to open
timeout /t 2 /nobreak >nul

echo.
echo [*] Starting DevForge with hot reload...
echo.
echo ========================================================
echo   TIP: Changes auto-reload! Just save your files.
echo   Press Ctrl+C to stop the development server.
echo ========================================================
echo.

call npm run dev

echo.
echo [*] DevForge closed.
pause







