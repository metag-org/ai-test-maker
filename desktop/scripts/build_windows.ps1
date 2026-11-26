# ==============================================================================
# Build Windows Portable Folder & One-Click Inno Setup Installer (.exe)
# with Embedded PostgreSQL
# Usage (PowerShell):
#   .\desktop\scripts\build_windows.ps1 [-SkipFrontend] [-SkipPg] [-SkipInstaller]
# ==============================================================================
param(
    [switch]$SkipFrontend,
    [switch]$SkipPg,
    [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$DesktopDir = Join-Path $RepoRoot "desktop"
$BuildVenv = Join-Path $DesktopDir ".venv-build"
$DistDir = Join-Path $DesktopDir "dist"
$WorkDir = Join-Path $DesktopDir "build"
$AppVersion = if ($env:APP_VERSION) { $env:APP_VERSION.TrimStart('v') } else { "1.0.0" }

Write-Host "==> [1/6] Setting up Python build environment..."
$PythonExe = if ($env:PYTHON_BIN) { $env:PYTHON_BIN } else { "python" }
if (-not (Test-Path $BuildVenv)) {
    & $PythonExe -m venv $BuildVenv
}
$VenvPython = Join-Path $BuildVenv "Scripts\python.exe"
$VenvPip = Join-Path $BuildVenv "Scripts\pip.exe"
$VenvPyInstaller = Join-Path $BuildVenv "Scripts\pyinstaller.exe"

& $VenvPython -m pip install --upgrade pip
& $VenvPip install -r (Join-Path $RepoRoot "backend\requirements.txt") -r (Join-Path $DesktopDir "requirements-desktop.txt")

if (-not $SkipFrontend) {
    Write-Host "==> [2/6] Building React frontend..."
    Push-Location (Join-Path $RepoRoot "frontend")
    try {
        npm install --no-audit --no-fund
        npm run build
    } finally {
        Pop-Location
    }
} else {
    Write-Host "==> [2/6] Skipping frontend build (-SkipFrontend)"
}

Write-Host "==> [3/6] Generating application icons..."
& $VenvPython (Join-Path $DesktopDir "scripts\generate_icons.py")

if (-not $SkipPg) {
    Write-Host "==> [4/6] Fetching embedded PostgreSQL runtime (windows-x64)..."
    & $VenvPython (Join-Path $DesktopDir "scripts\fetch_postgres.py") --platform windows-x64
} else {
    Write-Host "==> [4/6] Skipping PostgreSQL fetch (-SkipPg)"
}

Write-Host "==> [5/6] Building Windows bundle with PyInstaller..."
$AppDistDir = Join-Path $DistDir "ReviewTestMaker"
if (Test-Path $AppDistDir) { Remove-Item -Recurse -Force $AppDistDir }
if (Test-Path $WorkDir) { Remove-Item -Recurse -Force $WorkDir }

$env:APP_VERSION = $AppVersion
& $VenvPyInstaller `
    --noconfirm `
    --clean `
    --distpath $DistDir `
    --workpath $WorkDir `
    (Join-Path $DesktopDir "review_test_maker.spec")

$PgSource = Join-Path $DesktopDir "runtime\postgres"
$PgTarget = Join-Path $AppDistDir "runtime\postgres"
Write-Host "==> Embedding PostgreSQL into $PgTarget ..."
New-Item -ItemType Directory -Force -Path (Split-Path $PgTarget) | Out-Null
Copy-Item -Recurse -Force $PgSource $PgTarget

if (-not $SkipInstaller) {
    Write-Host "==> [6/6] Compiling Inno Setup one-click installer (.exe)..."
    $IsccCandidates = @(
        (Get-Command iscc -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe",
        (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe")
    ) | Where-Object { $_ -and (Test-Path $_) }

    if ($IsccCandidates.Count -eq 0) {
        throw "Inno Setup 6 (ISCC.exe) not found. Install Inno Setup 6 or run with -SkipInstaller."
    }

    $Iscc = $IsccCandidates[0]
    & $Iscc "/DMyAppVersion=$AppVersion" (Join-Path $DesktopDir "windows\installer.iss")
} else {
    Write-Host "==> [6/6] Skipping Inno Setup installer (-SkipInstaller)"
}

Write-Host "Windows build complete! Output in: $DistDir"
