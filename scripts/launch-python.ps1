param([int]$Port = 5180, [int]$AgentPort = 8176,
      [string]$PlannerModel, [ValidateSet('low','medium','high')][string]$ReasoningEffort)
$ErrorActionPreference = 'Stop'
$labRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $labRoot
$pythonExe = Join-Path $labRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
if (-not (Test-Path -LiteralPath $pythonExe)) { & python -m venv .venv; if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed.' } }
& $pythonExe -c 'import vector_agent, httpx, pydantic, websockets, dotenv' 2>$null
if ($LASTEXITCODE -ne 0) {
  & $pythonExe -m pip install -r python_agent/requirements.lock.txt
  if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
  & $pythonExe -m pip install --no-deps -e ./python_agent
  if ($LASTEXITCODE -ne 0) { throw 'Python agent installation failed.' }
}
if (-not (Test-Path -LiteralPath 'node_modules')) { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'Node dependency installation failed.' } }
& $pythonExe -m vector_agent.response_schema --check
if ($LASTEXITCODE -ne 0) { throw 'Responses schemas are stale.' }
& npm.cmd run python:contract:check
if ($LASTEXITCODE -ne 0) { throw 'Shared Python contract is stale.' }
$candidateSettings = Get-Content -LiteralPath (Join-Path $labRoot 'config/working-candidate.json') -Raw | ConvertFrom-Json
$settingNames = @($candidateSettings.PSObject.Properties.Name) + @('PORT','AGENT_BACKEND','PYTHON_AGENT_PORT','PLANNER_MODEL')
$savedSettings = @{}
foreach ($settingName in $settingNames) { $savedSettings[$settingName] = [Environment]::GetEnvironmentVariable($settingName, 'Process') }
try {
  foreach ($property in $candidateSettings.PSObject.Properties) { [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, 'Process') }
  $env:PORT = [string]$Port; $env:AGENT_BACKEND = 'python'; $env:PYTHON_AGENT_PORT = [string]$AgentPort
  if ($PlannerModel) {
    if ($env:MODEL_PROVIDER -eq 'azure') { $env:AZURE_LLM_DEPLOYMENT = $PlannerModel }
    else { $env:PLANNER_MODEL = $PlannerModel }
  }
  if ($ReasoningEffort) { $env:PLANNER_REASONING_EFFORT = $ReasoningEffort }
  $expectedConfig = (& $pythonExe -m vector_agent.config | ConvertFrom-Json)
  $agentHealthUrl = "http://127.0.0.1:$AgentPort/health"
  $agentHealth = $null
  try { $agentHealth = Invoke-RestMethod -Uri $agentHealthUrl -TimeoutSec 1 } catch { }
  if ($agentHealth) {
    if ($agentHealth.app -ne 'VECTOR Python Agent' -or $agentHealth.gamePort -ne $Port) { throw 'Agent port belongs to another service/configuration.' }
    foreach ($settingName in $expectedConfig.PSObject.Properties.Name) {
      if (-not $agentHealth.config -or $agentHealth.config.$settingName -ne $expectedConfig.$settingName) {
        throw 'Running worker has older code or different settings. Stop the idle lab with scripts/stop-python.ps1, then start it again.'
      }
    }
  } else {
    $worker = Start-Process -FilePath $pythonExe -ArgumentList @('-m','vector_agent.server') -WorkingDirectory $labRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $labRoot 'python-agent.log') -RedirectStandardError (Join-Path $labRoot 'python-agent-error.log')
    Set-Content -LiteralPath (Join-Path $labRoot '.python-server.pid') -Value $worker.Id
    $agentReady = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
      Start-Sleep -Milliseconds 250
      if ($worker.HasExited) { throw 'Python agent exited. See python-agent-error.log.' }
      try { $agentHealth = Invoke-RestMethod -Uri $agentHealthUrl -TimeoutSec 1; if ($agentHealth.app -eq 'VECTOR Python Agent') { $agentReady = $true; break } } catch { }
    }
    if (-not $agentReady) { throw 'Python agent did not become ready.' }
  }
  $labUrl = "http://127.0.0.1:$Port/"
  $gameHealth = $null
  try { $gameHealth = Invoke-RestMethod -Uri "${labUrl}api/health" -TimeoutSec 1 } catch { }
  if ($gameHealth) {
    if ($gameHealth.app -ne 'VECTOR Agent Lab' -or $gameHealth.agentBackend -ne 'python' -or $gameHealth.sourceIdentity -ne $expectedConfig.sourceIdentity) { throw 'Game port belongs to another service/backend.' }
  } else {
    $entryPath = Join-Path $labRoot 'server/index.ts'
    $game = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @('--import','tsx',('"' + $entryPath + '"')) -WorkingDirectory $labRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $labRoot 'python-game.log') -RedirectStandardError (Join-Path $labRoot 'python-game-error.log')
    Set-Content -LiteralPath (Join-Path $labRoot '.python-game.pid') -Value $game.Id
    $gameReady = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
      Start-Sleep -Milliseconds 250
      if ($game.HasExited) { throw 'Game server exited. See python-game-error.log.' }
      try { $gameHealth = Invoke-RestMethod -Uri "${labUrl}api/health" -TimeoutSec 1; if ($gameHealth.app -eq 'VECTOR Agent Lab') { $gameReady = $true; break } } catch { }
    }
    if (-not $gameReady) { throw 'Game server did not become ready.' }
  }
  Write-Host "Python agent transport: $labUrl (no browser UI)"
} finally {
  foreach ($settingName in $settingNames) { [Environment]::SetEnvironmentVariable($settingName, $savedSettings[$settingName], 'Process') }
}
