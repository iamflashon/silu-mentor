# iBrain 公司本機教材節點

第一階段建立安全心跳與硬體／模型狀態回報。第二階段加入受限工作佇列：節點只會讀取本程式旁的 `inbox` 資料夾，並只回傳擷取後的文字切片與統計；原始 PDF／Word 不會上傳。

## Windows 測試啟動

```powershell
$env:LOCAL_NODE_HEARTBEAT_URL="https://正式站網址/api/local-node/heartbeat"
$env:LOCAL_NODE_TOKEN="由 Cloudflare Secrets 設定的專用金鑰"
$env:LOCAL_NODE_ID="company-rtx4090"
$env:LOCAL_NODE_NAME="公司 RTX 4090"
.\start-node.ps1
```

看到「心跳成功」後，中央教材向量庫會自動顯示已連線。停止測試可按 `Ctrl+C`。

PDF 文字擷取需先安裝：

```powershell
python -m pip install pypdf
```

掃描型 PDF 的 OCR 另需 PyMuPDF、PaddlePaddle 與 PaddleOCR。節點會先使用 PDF 內建文字層，只有文字不足的頁面才啟動 OCR，避免浪費 GPU 時間。

將待處理檔案放入 `C:\iBrain-local-node\inbox`，再由總管理後台輸入相同檔名建立工作。掃描型 PDF 若沒有文字層，會標示需要 OCR，不會假裝成功。
