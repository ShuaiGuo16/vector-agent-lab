param([string]$RunId, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$gameRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $gameRoot
if (-not $RunId) { $RunId = Read-Host 'Recorded run ID' }
& .venv\Scripts\python.exe -X utf8 scripts/export-demo-trace.py $RunId
if ($LASTEXITCODE -ne 0) { throw 'Replay export failed.' }
& "$PSScriptRoot\launch-game.ps1" -ReplayData 'runs/demo/trace.json' -NoBrowser:$NoBrowser
