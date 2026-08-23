# iBrain 公司本機教材節點

第一階段只建立安全心跳與硬體／模型狀態回報；不會上傳原始 PDF，也不會接受遠端命令。

## Windows 測試啟動

```powershell
$env:LOCAL_NODE_HEARTBEAT_URL="https://正式站網址/api/local-node/heartbeat"
$env:LOCAL_NODE_TOKEN="由 Cloudflare Secrets 設定的專用金鑰"
$env:LOCAL_NODE_ID="company-rtx4090"
$env:LOCAL_NODE_NAME="公司 RTX 4090"
.\start-node.ps1
```

看到「心跳成功」後，中央教材向量庫會自動顯示已連線。停止測試可按 `Ctrl+C`。

正式安裝為 Windows 背景服務、教材工作佇列、PDF 拆解與索引回傳會在後續階段加入。
