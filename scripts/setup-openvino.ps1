<#
    DevForge - OpenVINO Setup Helper (Windows)

    Prepares a Python environment with all dependencies required by
    scripts/start-npu-server.py.

    What it does:
      - Verifies Windows + Python 3.9+
      - Optionally creates a virtual environment under .\openvino-env
      - Upgrades pip/setuptools/wheel
      - Installs OpenVINO + NPU server dependencies
      - Verifies importability of required packages

    Safe to re-run.
#>

param(
    [switch]$NoVenv
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -ge 7) {
    $PSNativeCommandUseErrorActionPreference = $false
}

function Resolve-PythonLauncher {
    $candidates = @(
        @{ Exe = "py"; Prefix = @("-3") },
        @{ Exe = "python"; Prefix = @() },
        @{ Exe = "python3"; Prefix = @() }
    )

    foreach ($candidate in $candidates) {
        try {
            $version = & $candidate.Exe @($candidate.Prefix + @("--version")) 2>$null
            if ($LASTEXITCODE -eq 0 -and $version) {
                return @{
                    Exe = $candidate.Exe
                    Prefix = $candidate.Prefix
                    Version = ($version | Select-Object -First 1)
                }
            }
        } catch {
            continue
        }
    }

    return $null
}

function Invoke-Python {
    param(
        [Parameter(Mandatory = $true)][string]$Exe,
        [string[]]$Prefix = @(),
        [Parameter(Mandatory = $true)][string[]]$Args
    )

    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $Exe @Prefix @Args 2>&1 | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) {
                Write-Host $_.ToString()
            } else {
                Write-Host $_
            }
        }
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }

    $exitCode = $LASTEXITCODE
    if ($null -eq $exitCode) {
        $exitCode = if ($?) { 0 } else { 1 }
    }
    return [int]$exitCode
}

function Test-OpenVinoImports {
    param(
        [Parameter(Mandatory = $true)][string]$Exe,
        [string[]]$Prefix = @()
    )

    # Phase 1: require openvino_genai and huggingface_hub alongside the
    # legacy optimum path. GenAI is the preferred engine for chat; the
    # optimum path stays as fallback + embeddings. huggingface_hub is
    # needed to snapshot HF repos for GenAI which loads from a local dir.
    # Single-line -c script: embedded newlines in PowerShell strings are unreliable here.
    $verifyCommand = "import openvino,fastapi,uvicorn,transformers,torch,huggingface_hub,openvino_genai;from optimum.intel.openvino import OVModelForCausalLM;print('OK')"
    return Invoke-Python -Exe $Exe -Prefix $Prefix -Args @("-c", $verifyCommand)
}

Write-Host "=== DevForge OpenVINO Setup ===" -ForegroundColor Cyan

if ($env:OS -ne "Windows_NT") {
    Write-Warning "This helper script is intended for Windows. Exiting."
    exit 1
}

Write-Host "Checking for Python 3.9+..." -ForegroundColor Cyan
$bootstrap = Resolve-PythonLauncher
if (-not $bootstrap) {
    Write-Warning "Python 3.9+ was not found."
    Write-Host "Install Python from https://www.python.org/downloads/ and re-run this script." -ForegroundColor Yellow
    exit 1
}
Write-Host "Detected $($bootstrap.Version)" -ForegroundColor Green

$detectedVersionToken = ([string]$bootstrap.Version -replace '^Python\s+', '').Trim()
if (-not $detectedVersionToken) {
    Write-Warning "Unable to parse Python version."
    exit 1
}
$versionParts = $detectedVersionToken.Split('.')
$major = [int]$versionParts[0]
$minor = [int]$versionParts[1]
if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 9)) {
    Write-Warning "Python 3.9+ is required. Detected $detectedVersionToken."
    exit 1
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot "openvino-env"
$venvPython = Join-Path $envPath "Scripts\python.exe"

if (-not $NoVenv) {
    if (-not (Test-Path $venvPython)) {
        Write-Host "Creating virtual environment at $envPath ..." -ForegroundColor Cyan
        $venvExit = Invoke-Python -Exe $bootstrap.Exe -Prefix $bootstrap.Prefix -Args @("-m", "venv", $envPath)
        if ($venvExit -ne 0) {
            Write-Warning "Failed to create virtual environment. Re-run with -NoVenv for a global install."
            exit 1
        }
    } else {
        Write-Host "Virtual environment already exists at $envPath" -ForegroundColor Green
    }
}

$pythonExe = $bootstrap.Exe
$pythonPrefix = $bootstrap.Prefix

if (-not $NoVenv -and (Test-Path $venvPython)) {
    $pythonExe = $venvPython
    $pythonPrefix = @()
    Write-Host "Using virtual environment Python: $pythonExe" -ForegroundColor Green
} else {
    $prefixLabel = if ($pythonPrefix.Count -gt 0) { "$pythonExe $($pythonPrefix -join ' ')" } else { $pythonExe }
    Write-Host "Using system Python: $prefixLabel" -ForegroundColor Yellow
}

Write-Host "Upgrading pip/setuptools/wheel..." -ForegroundColor Cyan
$pipUpgradeExit = Invoke-Python -Exe $pythonExe -Prefix $pythonPrefix -Args @("-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel")
if ($pipUpgradeExit -ne 0) {
    Write-Warning "Failed to upgrade pip tooling."
    exit 1
}

$packages = @(
    "openvino>=2026.1",
    "openvino-genai>=2026.1",
    "openvino-tokenizers>=2026.1",
    "huggingface_hub[hf_xet]",
    "fastapi",
    "uvicorn[standard]",
    "transformers>=4.57",
    "optimum-intel>=1.27",
    "torch",
    "accelerate",
    "sentencepiece",
    "safetensors"
)

Write-Host "Checking existing OpenVINO server dependencies..." -ForegroundColor Cyan
$precheckExit = Test-OpenVinoImports -Exe $pythonExe -Prefix $pythonPrefix

if ($precheckExit -eq 0) {
    Write-Host "Dependencies already available. Skipping package install." -ForegroundColor Green
} else {
    Write-Host "Installing OpenVINO + NPU server dependencies (this may take a while)..." -ForegroundColor Cyan
    $installArgs = @("-m", "pip", "install", "--upgrade") + $packages
    $installExit = Invoke-Python -Exe $pythonExe -Prefix $pythonPrefix -Args $installArgs
    if ($installExit -ne 0) {
        Write-Warning "Dependency install reported errors. Verifying imports anyway..."
    }
}

Write-Host "Verifying dependency imports..." -ForegroundColor Cyan
$verifyExit = Test-OpenVinoImports -Exe $pythonExe -Prefix $pythonPrefix
if ($verifyExit -ne 0) {
    Write-Warning "Dependency verification failed. Packages were installed but imports did not pass."
    exit 1
}

Write-Host ""
Write-Host "OpenVINO environment ready." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Install the latest Intel NPU drivers if needed." -ForegroundColor Gray
Write-Host "  2. Start NPU from DevForge Hardware Settings, or run:" -ForegroundColor Gray
if ($pythonExe -like "*python.exe") {
    Write-Host "       `"$pythonExe`" .\scripts\start-npu-server.py" -ForegroundColor Yellow
} else {
    $prefixText = if ($pythonPrefix.Count -gt 0) { "$pythonExe $($pythonPrefix -join ' ')" } else { $pythonExe }
    Write-Host "       $prefixText .\scripts\start-npu-server.py" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "DevForge will connect to the local OpenVINO server when available." -ForegroundColor Cyan


