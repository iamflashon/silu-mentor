$ErrorActionPreference = "Stop"
if (-not $env:LOCAL_NODE_HEARTBEAT_URL) { Write-Error "請先設定 LOCAL_NODE_HEARTBEAT_URL" }
if (-not $env:LOCAL_NODE_TOKEN) { Write-Error "請先設定 LOCAL_NODE_TOKEN" }
python (Join-Path $PSScriptRoot "agent.py")
