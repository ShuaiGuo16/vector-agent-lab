param([switch]$NoBrowser, [int]$Port = 5176, [string]$ReplayData)
$ErrorActionPreference = 'Stop'
$gameRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $gameRoot
if ($ReplayData -and -not $PSBoundParameters.ContainsKey('Port')) { $Port = 5178 }
if (-not (Test-Path -LiteralPath 'node_modules')) { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'Node dependency installation failed.' } }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Game build failed.' }
$expectedIdentity = & node.exe --import tsx -e "import('./server/identity.ts').then(m=>process.stdout.write(m.sourceIdentity))"
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify the game source.' }
$appName = if ($ReplayData) { 'VECTOR Replay' } else { 'VECTOR Game' }
$traceRunId = if ($ReplayData) { (Get-Content -LiteralPath $ReplayData -Raw | ConvertFrom-Json).runId } else { $null }
$url = "http://127.0.0.1:$Port/"
$health = $null
try { $health = Invoke-RestMethod -Uri "${url}api/health" -TimeoutSec 1 } catch { }
if ($health) {
  if ($health.app -ne $appName -or $health.sourceIdentity -ne $expectedIdentity -or $health.traceRunId -ne $traceRunId) {
    throw 'This port has an older/different service. Stop that service when idle and launch again.'
  }
} else {
  $entry = Join-Path $gameRoot 'server/game.ts'
  $arguments = @('--import','tsx',('"' + $entry + '"'),'--port',[string]$Port)
  if ($ReplayData) { $arguments += @('--replay-data',('"' + (Resolve-Path -LiteralPath $ReplayData).Path + '"'),'--replay') }
  $prefix = if ($ReplayData) { 'replay' } else { 'manual-game' }
  $service = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList $arguments -WorkingDirectory $gameRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $gameRoot "$prefix.log") -RedirectStandardError (Join-Path $gameRoot "$prefix-error.log")
  Set-Content -LiteralPath (Join-Path $gameRoot ".$prefix.pid") -Value $service.Id
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    if ($service.HasExited) { throw "Service exited. See $prefix-error.log." }
    try { $health = Invoke-RestMethod -Uri "${url}api/health" -TimeoutSec 1; if ($health.app -eq $appName) { $ready = $true; break } } catch { }
  }
  if (-not $ready) { throw 'Static game service did not become ready.' }
}
Write-Host "$appName : $url"
if (-not $NoBrowser) { Start-Process $url }
