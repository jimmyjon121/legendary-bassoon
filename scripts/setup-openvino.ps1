<#
    DevForge - OpenVINO Setup Helper (Windows)

    This script prepares a Python environment with Intel OpenVINO
    so you can run the local NPU inference server used by DevForge.

    What it does:
      - Verifies you are on Windows with Python 3.9+
      - Optionally creates a virtual environment under .\openvino-env
      - Installs/updates pip
      - Installs the OpenVINO Python package (openvino-dev)

    Usage (from DevForge project root, in PowerShell):
      Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
      .\scripts\setup-openvino.ps1

    You can re-run this script safely; it will only update packages.
#>

param(
    [switch]$NoVenv
)

Write-Host "=== DevForge OpenVINO Setup ===" -ForegroundColor Cyan

if ($IsLinux -or $IsMacOS) {
    Write-Warning "This helper script is intended for Windows. Exiting."
    exit 1
}

# Ensure we have Python
Write-Host "Checking for Python 3.9+..." -ForegroundColor Cyan
try {
    $pyVersion = & py -3 --version 2>$null
} catch {
    $pyVersion = $null
}

if (-not $pyVersion) {
    Write-Warning "Python 3 is not available via the 'py' launcher."
    Write-Host "Install Python 3.9+ from https://www.python.org/downloads/ and re-run this script." -ForegroundColor Yellow
    exit 1
}

Write-Host "Detected $pyVersion" -ForegroundColor Green

$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot "openvino-env"

if (-not $NoVenv) {
    if (-not (Test-Path $envPath)) {
        Write-Host "Creating virtual environment at $envPath ..." -ForegroundColor Cyan
        & py -3 -m venv $envPath
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Failed to create virtual environment. You can try again with -NoVenv to install globally."
        }
    } else {
        Write-Host "Virtual environment already exists at $envPath" -ForegroundColor Green
    }
}

# Build Python command (inside venv if present)
if (-not $NoVenv -and (Test-Path (Join-Path $envPath "Scripts\python.exe"))) {
    $pythonExe = Join-Path $envPath "Scripts\python.exe"
    Write-Host "Using virtual environment Python: $pythonExe" -ForegroundColor Green
} else {
    $pythonExe = "py -3"
    Write-Host "Using system Python via 'py -3'" -ForegroundColor Yellow
}

Write-Host "Upgrading pip..." -ForegroundColor Cyan
& $pythonExe -m pip install --upgrade pip

Write-Host "Installing Intel OpenVINO Python package (this may take a while)..." -ForegroundColor Cyan
& $pythonExe -m pip install --upgrade openvino-dev

if ($LASTEXITCODE -ne 0) {
    Write-Warning "OpenVINO installation reported an error. Check the logs above."
    exit 1
}

Write-Host ""
Write-Host "OpenVINO Python components installed successfully." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. (Recommended) Install Intel GPU / NPU drivers from Intel's website." -ForegroundColor Gray
Write-Host "  2. Start the NPU server from DevForge or run:" -ForegroundColor Gray
if ($pythonExe -like "*python.exe") {
    Write-Host "       `"$pythonExe`" .\scripts\start-npu-server.py" -ForegroundColor Yellow
} else {
    Write-Host "       py -3 .\scripts\start-npu-server.py" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "DevForge will connect to this server via the NPU bridge when available." -ForegroundColor Cyan


