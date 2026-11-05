param([switch]$Replay)
$ErrorActionPreference = 'Stop'
$gameRoot = Split-Path -Parent $PSScriptRoot
$prefix = if ($Replay) { 'replay' } else { 'manual-game' }
$pidPath = Join-Path $gameRoot ".$prefix.pid"
if (-not (Test-Path -LiteralPath $pidPath)) { return }
$gameProcessId = [int](Get-Content -LiteralPath $pidPath)
$gameProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $gameProcessId" -ErrorAction SilentlyContinue
if ($gameProcess) {
  if ($gameProcess.Name -ne 'node.exe' -or -not $gameProcess.CommandLine.Contains((Join-Path $gameRoot 'server/game.ts'))) { throw 'PID belongs to another application.' }
  Stop-Process -Id $gameProcessId
}
Remove-Item -LiteralPath $pidPath
Write-Host "$prefix stopped."
