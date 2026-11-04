# Start the Steel developer connector in the background (Windows).
# Usage: powershell -File scripts\start.ps1 [-HomeDir DIR] [-MaxIterations N]
# Writes a pidfile under the connector home; stop with scripts\stop.ps1.
param([string]$HomeDir = "", [int]$MaxIterations = 0)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$homeDir = if ($HomeDir -ne "") { $HomeDir } else { if ($env:STEEL_CONNECTOR_HOME) { $env:STEEL_CONNECTOR_HOME } else { Join-Path $HOME '.steel-connector' } }
$pidFile = Join-Path $homeDir 'connector.pid'
$logFile = Join-Path $homeDir 'connector.log'
if (Test-Path $pidFile) {
  $old = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) { Write-Error "already running (pid $old); stop it first"; exit 1 }
}
$cliArgs = @("$root\src\cli.js", 'run')
if ($HomeDir -ne "") { $cliArgs += @('--home', $HomeDir) }
if ($MaxIterations -gt 0) { $cliArgs += @('--max-iterations', "$MaxIterations") }
$env:STEEL_CONNECTOR_HOME = $homeDir
$p = Start-Process -FilePath 'node' -ArgumentList $cliArgs -RedirectStandardOutput $logFile -RedirectStandardError 'STDOUT' -PassThru -WindowStyle Hidden
Set-Content -Path $pidFile -Value $p.Id
Write-Output "started pid $($p.Id); log $logFile"
