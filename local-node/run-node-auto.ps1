$ErrorActionPreference = "Stop"
$stateRoot = Join-Path $env:LOCALAPPDATA "iBrainLocalNode"
$configPath = Join-Path $stateRoot "secrets.clixml"
$logRoot = Join-Path $stateRoot "logs"
$logPath = Join-Path $logRoot "node.log"

if (-not (Test-Path $configPath)) { throw "找不到已加密的節點設定，請重新執行 install-auto-start.ps1" }
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

function Reveal-SecureString([Security.SecureString]$value) {
  return [System.Net.NetworkCredential]::new("", $value).Password
}

$config = Import-Clixml -Path $configPath
$env:LOCAL_NODE_HEARTBEAT_URL = $config.HeartbeatUrl
$env:LOCAL_NODE_TOKEN = Reveal-SecureString $config.LocalNodeToken
$env:CF_ACCESS_CLIENT_ID = $config.AccessClientId
$env:CF_ACCESS_CLIENT_SECRET = Reveal-SecureString $config.AccessClientSecret
$env:LOCAL_NODE_ID = $config.NodeId
$env:LOCAL_NODE_NAME = $config.NodeName

if ((Test-Path $logPath) -and (Get-Item $logPath).Length -gt 5MB) {
  Move-Item -Force $logPath (Join-Path $logRoot "node.previous.log")
}

Set-Location $config.NodeRoot
while ($true) {
  try {
    & $config.PythonPath (Join-Path $config.NodeRoot "agent.py") 2>&1 | Out-File -FilePath $logPath -Append -Encoding utf8
  } catch {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 節點程序異常：$($_.Exception.Message)" | Out-File -FilePath $logPath -Append -Encoding utf8
  }
  Start-Sleep -Seconds 15
}
