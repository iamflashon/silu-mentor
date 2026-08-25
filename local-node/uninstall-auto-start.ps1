param([switch]$RemoveSecrets)
$ErrorActionPreference = "Stop"
$taskName = "iBrain Local Node"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
if ($RemoveSecrets) {
  $stateRoot = Join-Path $env:LOCALAPPDATA "iBrainLocalNode"
  if (Test-Path $stateRoot) { Remove-Item -Recurse -Force $stateRoot }
}
Write-Host "已解除 iBrain 本機節點自動啟動。"
