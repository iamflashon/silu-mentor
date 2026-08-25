$ErrorActionPreference = "Stop"
if (-not $env:LOCAL_NODE_HEARTBEAT_URL) { Write-Error "請先設定 LOCAL_NODE_HEARTBEAT_URL" }
if (-not $env:LOCAL_NODE_TOKEN) { Write-Error "請先設定 LOCAL_NODE_TOKEN" }
if (-not $env:CF_ACCESS_CLIENT_ID) { Write-Error "請先設定 CF_ACCESS_CLIENT_ID（Cloudflare Access Service Token）" }
if (-not $env:CF_ACCESS_CLIENT_SECRET) { Write-Error "請先設定 CF_ACCESS_CLIENT_SECRET（Cloudflare Access Service Token）" }
python (Join-Path $PSScriptRoot "agent.py")
