$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $projectRoot

Write-Host "1/5 更新 Cloudflare 發布分支"
git pull --ff-only origin cloudflare-setup
if ($LASTEXITCODE -ne 0) { throw "Git 更新失敗，停止部署" }

Write-Host "2/5 清除舊建置內容"
$distPath = Join-Path $projectRoot "dist"
if (Test-Path $distPath) {
    Remove-Item $distPath -Recurse -Force
}

Write-Host "3/5 建立新版 Cloudflare 產物"
npx vinext build
if ($LASTEXITCODE -ne 0) { throw "建置失敗，停止部署" }

$deployConfig = Join-Path $distPath "server\wrangler.json"
if (-not (Test-Path $deployConfig)) {
    throw "找不到 dist\server\wrangler.json，停止部署"
}

$config = Get-Content $deployConfig -Raw | ConvertFrom-Json
if ($config.main -ne "index.js") {
    throw "部署入口不是 dist\server\index.js，停止部署"
}
if ($config.assets.directory -ne "../client") {
    throw "前台資產目錄不是 dist\client，停止部署"
}

$db = @($config.d1_databases | Where-Object { $_.binding -eq "DB" }) | Select-Object -First 1
$bucket = @($config.r2_buckets | Where-Object { $_.binding -eq "BUCKET" }) | Select-Object -First 1
if ($null -eq $db -or $db.database_name -ne "silu-mentor-db") {
    throw "D1 綁定不是 silu-mentor-db，停止部署"
}
if ($null -eq $bucket -or $bucket.bucket_name -ne "silu-mentor-r2") {
    throw "R2 綁定不是 silu-mentor-r2，停止部署"
}

$buildFiles = Get-ChildItem $distPath -Recurse -File |
    Where-Object { $_.Extension -in ".js", ".html", ".json" }

$oldRule = $buildFiles |
    Select-String -SimpleMatch -Pattern "完成 5 輪才扣 1 次", "每 5 輪才扣 1 次" -Quiet
if ($oldRule) {
    throw "建置內容仍含舊規則，停止部署"
}

$newRule = $buildFiles |
    Select-String -SimpleMatch -Pattern "規則版本：2026-08-28" -Quiet
if (-not $newRule) {
    throw "建置內容找不到新版規則，停止部署"
}

Write-Host "4/5 部署設定與新版規則檢查通過"
Write-Host "部署入口：" $deployConfig
Write-Host "Worker：" $config.name
Write-Host "D1：" $db.database_name
Write-Host "R2：" $bucket.bucket_name

Write-Host "5/5 部署正式 Cloudflare Worker"
npx wrangler deploy --config $deployConfig --keep-vars
if ($LASTEXITCODE -ne 0) { throw "Cloudflare 部署失敗" }

Write-Host "Cloudflare 正式站部署完成"
