# Publishes the atelier sidecar as a self-contained single-file exe and copies
# it into atelier/src-tauri/binaries/ using the Tauri sidecar naming scheme
# (<name>-<target-triple>.exe).
#
# Usage:  powershell -ExecutionPolicy Bypass -File .\publish.ps1

$ErrorActionPreference = "Stop"

# dotnet resolution (in order): explicit override -> user-scoped ~/.dotnet8
# (this machine's setup; PATH dotnet is 3.1 here) -> dotnet on PATH (CI).
if ($env:ATELIER_DOTNET -and (Test-Path $env:ATELIER_DOTNET)) {
    $dotnet = $env:ATELIER_DOTNET
} else {
    $dotnetRoot = Join-Path $env:USERPROFILE ".dotnet8"
    $dotnet = Join-Path $dotnetRoot "dotnet.exe"
    if (Test-Path $dotnet) {
        $env:DOTNET_ROOT = $dotnetRoot
    } else {
        $cmd = Get-Command dotnet -ErrorAction SilentlyContinue
        if (-not $cmd) {
            throw ".NET SDK not found. Install .NET 8 or set ATELIER_DOTNET to a dotnet.exe."
        }
        $dotnet = $cmd.Source
    }
}

$sidecarDir = $PSScriptRoot
$csproj = Join-Path $sidecarDir "Feelgood.Atelier.Sidecar.csproj"

Write-Host "Publishing $csproj ..." -ForegroundColor Cyan
& $dotnet publish $csproj -c Release -r win-x64 --self-contained `
    -p:PublishSingleFile=true -p:PublishTrimmed=false
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE"
}

$publishedExe = Join-Path $sidecarDir "bin\Release\net8.0\win-x64\publish\Feelgood.Atelier.Sidecar.exe"
if (-not (Test-Path $publishedExe)) {
    throw "Published exe not found at '$publishedExe'"
}

$atelierDir = Split-Path $sidecarDir -Parent
$targetDir = Join-Path $atelierDir "src-tauri\binaries"
New-Item -ItemType Directory -Force $targetDir | Out-Null

$target = Join-Path $targetDir "fg-atelier-sidecar-x86_64-pc-windows-msvc.exe"
Copy-Item $publishedExe $target -Force

$size = (Get-Item $target).Length
Write-Host ("OK: {0} ({1:N1} MB)" -f $target, ($size / 1MB)) -ForegroundColor Green
