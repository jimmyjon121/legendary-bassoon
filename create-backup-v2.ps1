# DevForge Project Backup Script V2
# Uses tar for better compression and no size limits

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$projectName = "devforge"
$backupName = "${projectName}_backup_${timestamp}.tar.gz"
$backupPath = Join-Path (Get-Location) $backupName

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " DevForge Project Backup V2" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Creating backup: $backupName" -ForegroundColor Yellow
Write-Host "Backup location: $backupPath" -ForegroundColor Yellow
Write-Host ""

# Items to exclude from backup
$excludePatterns = @(
    "node_modules",
    "openvino-env",
    "release/win-unpacked",
    "*.log",
    "*.tmp",
    ".git",
    "dist",
    "build",
    "*.zip",
    "*.tar",
    "*.tgz",
    "*.gz",
    "*.tar.gz",
    "__pycache__",
    "*.pyc"
)

Write-Host "Excluded from backup:" -ForegroundColor DarkGray
$excludePatterns | ForEach-Object { Write-Host "  - $_" -ForegroundColor DarkGray }
Write-Host ""

# Check if tar is available (should be on Windows 10+)
$tarAvailable = Get-Command tar -ErrorAction SilentlyContinue

if ($tarAvailable) {
    Write-Host "Using tar for compression..." -ForegroundColor Green
    Write-Host "This may take a few minutes depending on project size..." -ForegroundColor Yellow
    Write-Host ""
    
    # Build exclude parameters for tar
    $excludeArgs = @()
    foreach ($pattern in $excludePatterns) {
        # Convert Windows paths to Unix-style for tar
        $unixPattern = $pattern -replace '\\', '/'
        $excludeArgs += "--exclude=$unixPattern"
    }
    
    # Add progress indication
    Write-Host "Starting compression process..." -ForegroundColor Cyan
    
    # Create the backup with tar
    # -c = create, -z = gzip compression, -f = file output, -v = verbose
    $tarArgs = @("-czf", $backupName) + $excludeArgs + @(".")
    
    # Run tar and capture output
    $process = Start-Process -FilePath "tar" -ArgumentList $tarArgs -NoNewWindow -PassThru -Wait
    
    if ($process.ExitCode -eq 0) {
        Write-Host "Compression completed successfully!" -ForegroundColor Green
    } else {
        Write-Host "Warning: tar reported exit code $($process.ExitCode)" -ForegroundColor Yellow
    }
    
} else {
    Write-Host "ERROR: tar command not found!" -ForegroundColor Red
    Write-Host "tar should be available on Windows 10 version 1803 and later." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Alternative: Creating a file list backup instead..." -ForegroundColor Yellow
    
    # Create a lightweight backup - just copy essential files to a backup folder
    $backupFolder = "devforge_backup_${timestamp}"
    $backupFolderPath = Join-Path (Get-Location) $backupFolder
    
    Write-Host "Creating backup folder: $backupFolder" -ForegroundColor Cyan
    New-Item -ItemType Directory -Path $backupFolderPath -Force | Out-Null
    
    # Essential directories to backup
    $essentialDirs = @(
        "electron",
        "src", 
        "docs",
        "scripts",
        "assets",
        "npu-models",
        "public"
    )
    
    # Essential files to backup
    $essentialFiles = @(
        "*.json",
        "*.js",
        "*.jsx",
        "*.md",
        "*.bat",
        "*.ps1",
        "*.html",
        "*.css",
        "*.svg"
    )
    
    Write-Host "Copying essential project files..." -ForegroundColor Yellow
    
    # Copy directories
    foreach ($dir in $essentialDirs) {
        if (Test-Path $dir) {
            Write-Host "  Copying $dir..." -ForegroundColor DarkGray
            $destPath = Join-Path $backupFolderPath $dir
            robocopy $dir $destPath /E /XD node_modules .git __pycache__ /XF *.log *.tmp *.pyc /NFL /NDL /NJH /NJS | Out-Null
        }
    }
    
    # Copy root files
    foreach ($pattern in $essentialFiles) {
        $files = Get-ChildItem -Path . -Filter $pattern -File -ErrorAction SilentlyContinue
        foreach ($file in $files) {
            Write-Host "  Copying $($file.Name)..." -ForegroundColor DarkGray
            Copy-Item -Path $file.FullName -Destination $backupFolderPath -Force
        }
    }
    
    $backupPath = $backupFolderPath
    Write-Host ""
    Write-Host "Backup folder created: $backupFolder" -ForegroundColor Green
    Write-Host "You can manually compress this folder using any zip tool if needed." -ForegroundColor Yellow
}

# Verify backup was created
if (Test-Path $backupPath) {
    if ($backupPath -like "*.tar.gz") {
        $backupSize = (Get-Item $backupPath).Length / 1MB
        $backupSizeFormatted = "{0:N2}" -f $backupSize
        $backupType = "Compressed Archive"
    } else {
        # For folder backup, calculate total size
        $backupSize = (Get-ChildItem -Path $backupPath -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
        $backupSizeFormatted = "{0:N2}" -f $backupSize
        $backupType = "Folder Backup"
    }
    
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Green
    Write-Host " Backup Completed Successfully!" -ForegroundColor Green
    Write-Host "==================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Backup Type: $backupType" -ForegroundColor Cyan
    Write-Host "Backup Name: $(Split-Path $backupPath -Leaf)" -ForegroundColor Cyan
    Write-Host "Total Size: ${backupSizeFormatted} MB" -ForegroundColor Cyan
    Write-Host "Location: $backupPath" -ForegroundColor Cyan
    Write-Host ""
    
    # Create a backup info file
    $infoFile = "${projectName}_backup_${timestamp}_info.txt"
    $infoContent = @"
DevForge Project Backup Information
====================================
Backup Date: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Backup Type: $backupType
Backup Name: $(Split-Path $backupPath -Leaf)
Total Size: ${backupSizeFormatted} MB
Project Path: $(Get-Location)

Excluded from backup:
$(($excludePatterns | ForEach-Object { "  - $_" }) -join "`n")

Backup Contents:
- All source code (src/, electron/)
- Configuration files (package.json, vite.config.js, etc.)
- Documentation (docs/, *.md files)
- Scripts and utilities
- NPU models
- Assets and public files

To restore this backup:
1. Extract/copy the backup to a new directory
2. Run 'npm install' to restore node_modules
3. If using NPU features, run setup-openvino.ps1 script

Notes:
- All essential project files are included
- Dependencies can be restored with npm install
- Build outputs can be regenerated
"@
    
    $infoContent | Out-File -FilePath $infoFile -Encoding UTF8
    Write-Host "Backup information saved to: $infoFile" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "Backup completed at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor DarkGray
    
} else {
    Write-Host ""
    Write-Host "ERROR: Backup creation failed!" -ForegroundColor Red
    Write-Host "Please check for errors above and try again." -ForegroundColor Red
    exit 1
}


