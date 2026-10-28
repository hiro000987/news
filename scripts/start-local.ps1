$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $taskRoot
$taskNode = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
if (-not $taskNode) { $taskNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $taskNode)) { throw 'Node.js 22以降が必要。READMEを確認してほしい。' }
$taskWrangler = Join-Path $taskRoot 'node_modules\wrangler\bin\wrangler.js'
if (-not (Test-Path -LiteralPath $taskWrangler)) { throw '依存パッケージが未導入。READMEのセットアップを先に実行してほしい。' }
$taskReady = $false
try {
  $taskHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2
  $taskReady = ($taskHealth.app -eq 'Hiro Knowledge')
} catch { }
if (-not $taskReady) {
  $taskVars = Join-Path $taskRoot '.dev.vars'
  if (-not (Test-Path -LiteralPath $taskVars)) { [System.IO.File]::WriteAllText($taskVars, "LOCAL_DEV=true`n") }
  & $taskNode $taskWrangler d1 migrations apply hiro-knowledge --local --persist-to .wrangler/state
  if ($LASTEXITCODE -ne 0) { throw 'ローカルDBの準備に失敗した。上の内容を確認してほしい。' }
  $taskState = Join-Path $taskRoot '.wrangler'
  New-Item -ItemType Directory -Path $taskState -Force | Out-Null
  $taskProcess = Start-Process -FilePath $taskNode -ArgumentList @(('"' + $taskWrangler + '"'), 'dev', '--ip', '127.0.0.1', '--port', '8787', '--persist-to', '.wrangler/state') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskState 'local-output.log') -RedirectStandardError (Join-Path $taskState 'local-error.log') -PassThru
  Set-Content -LiteralPath (Join-Path $taskState 'local.pid') -Value $taskProcess.Id
  for ($taskTry = 0; $taskTry -lt 45; $taskTry++) {
    Start-Sleep -Milliseconds 500
    try { $taskHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 1; if ($taskHealth.app -eq 'Hiro Knowledge') { $taskReady = $true; break } } catch { }
  }
  if (-not $taskReady) { throw '起動を確認できなかった。.wrangler/local-error.log を確認してほしい。' }
}
if ($env:HIRO_NO_BROWSER -ne '1') { Start-Process 'http://127.0.0.1:8787/' }
Write-Host 'Hiro Knowledge: http://127.0.0.1:8787/ （このPC内に保存）'
