$ErrorActionPreference = 'Stop'
$labRoot = Split-Path -Parent $PSScriptRoot
foreach ($item in @(@{PidFile='.python-game.pid'; Name='node.exe'; Marker=(Join-Path $labRoot 'server/index.ts')}, @{PidFile='.python-server.pid'; Name='python.exe'; Marker='vector_agent.server'})) {
  $record = Join-Path $labRoot $item.PidFile
  if (-not (Test-Path -LiteralPath $record)) { continue }
  $labProcessId = [int](Get-Content -LiteralPath $record)
  $labProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $labProcessId" -ErrorAction SilentlyContinue
  if ($labProcess) {
    if ($labProcess.Name -ne $item.Name -or -not $labProcess.CommandLine.Contains($item.Marker)) { throw "Recorded process belongs to another application: $labProcessId" }
    # The Windows venv redirector owns the PID file but runs a base-Python child.
    # Stop descendants of the verified lab process before stopping the redirector.
    $labProcesses = @(Get-CimInstance Win32_Process)
    $pendingIds = @($labProcessId)
    $descendantIds = @()
    while ($pendingIds.Count -gt 0) {
      $childIds = @($labProcesses | Where-Object { $_.ParentProcessId -in $pendingIds } | ForEach-Object { [int]$_.ProcessId })
      $descendantIds += $childIds
      $pendingIds = $childIds
    }
    [array]::Reverse($descendantIds)
    foreach ($childId in $descendantIds) { Stop-Process -Id $childId -ErrorAction SilentlyContinue }
    Stop-Process -Id $labProcessId -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $record
}
Write-Host 'VECTOR Agent Lab processes stopped.'
