# Stop the Steel developer connector started by start.ps1.
# Usage: powershell -File scripts\stop.ps1 [-HomeDir DIR]
# Preserves config/credentials/data; removes only the pidfile.
param([string]$HomeDir = "")
$ErrorActionPreference = 'Stop'
$homeDir = if ($HomeDir -ne "") { $HomeDir } else { if ($env:STEEL_CONNECTOR_HOME) { $env:STEEL_CONNECTOR_HOME } else { Join-Path $HOME '.steel-connector' } }
$pidFile = Join-Path $homeDir 'connector.pid'
if (-not (Test-Path $pidFile)) { Write-Output 'not running (no pidfile)'; exit 0 }
$pidVal = Get-Content $pidFile
$p = Get-Process -Id $pidVal -ErrorAction SilentlyContinue
if ($p) { Stop-Process -Id $pidVal -Force; Write-Output "stopped pid $pidVal" } else { Write-Output "pid $pidVal already gone" }
Remove-Item $pidFile -Force
