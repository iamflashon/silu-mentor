$ErrorActionPreference = "Stop"
$taskName = "iBrain Local Node"
$nodeRoot = $PSScriptRoot
$stateRoot = Join-Path $env:LOCALAPPDATA "iBrainLocalNode"
$configPath = Join-Path $stateRoot "secrets.clixml"

$required = @("LOCAL_NODE_HEARTBEAT_URL", "LOCAL_NODE_TOKEN", "CF_ACCESS_CLIENT_ID", "CF_ACCESS_CLIENT_SECRET")
foreach ($name in $required) {
  if (-not [Environment]::GetEnvironmentVariable($name, "Process")) { throw "目前 PowerShell 尚未設定 $name" }
}

$python = (Get-Command python -ErrorAction Stop).Source
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
$config = [pscustomobject]@{
  HeartbeatUrl = $env:LOCAL_NODE_HEARTBEAT_URL
  LocalNodeToken = ConvertTo-SecureString $env:LOCAL_NODE_TOKEN -AsPlainText -Force
  AccessClientId = $env:CF_ACCESS_CLIENT_ID
  AccessClientSecret = ConvertTo-SecureString $env:CF_ACCESS_CLIENT_SECRET -AsPlainText -Force
  NodeId = $(if ($env:LOCAL_NODE_ID) { $env:LOCAL_NODE_ID } else { "company-rtx4090" })
  NodeName = $(if ($env:LOCAL_NODE_NAME) { $env:LOCAL_NODE_NAME } else { "公司 RTX 4090" })
  NodeRoot = $nodeRoot
  PythonPath = $python
}
$config | Export-Clixml -Path $configPath -Force

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$acl = Get-Acl $stateRoot
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")
$acl.SetAccessRule($rule)
Set-Acl -Path $stateRoot -AclObject $acl

$runner = Join-Path $nodeRoot "run-node-auto.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "iBrain 公司本機教材節點；使用 DPAPI 加密金鑰，登入 Windows 後自動啟動。" -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3
$task = Get-ScheduledTask -TaskName $taskName
Write-Host "已安裝並啟動：$taskName（狀態：$($task.State)）"
Write-Host "日誌：$(Join-Path $stateRoot 'logs\node.log')"
