# iBrain 公司本機教材節點

第一階段建立安全心跳與硬體／模型狀態回報。第二、三階段加入受限工作佇列與 GPU OCR。v0.6.11 支援司法院 RAR 全量斷點拆解、既有測試結果補傳、分批入庫、後台進度回報，並相容舊版司法進度資料庫的必填欄位。原始 PDF、Word、影片與 RAR 都留在公司電腦，雲端只接收可搜尋的裁判全文、文字索引或播放所需檔案。

## 司法院RAR全量拆解與上傳

```powershell
$env:LOCAL_NODE_JUDICIAL_ENABLED="true"
$env:LOCAL_NODE_JUDICIAL_MODE="full"
$env:LOCAL_NODE_JUDICIAL_BATCH_SIZE="20"
python -u "C:\iBrain-local-node\agent.py"
```

節點會先補傳 `judicial-output` 裡過去已完成的測試結果，再依月份處理 `legal-inbox\judicial` 的RAR。進度保存在 `judicial-output\state\judicial-state.sqlite3`，重新啟動會從中斷位置繼續；正式站以JID更新或新增，不會建立重複裁判。

## Windows 測試啟動

```powershell
$env:LOCAL_NODE_HEARTBEAT_URL="https://正式站網址/api/local-node/heartbeat"
$env:LOCAL_NODE_TOKEN="由 Cloudflare Secrets 設定的專用金鑰"
$env:CF_ACCESS_CLIENT_ID="Cloudflare Access Service Token 的 Client ID"
$env:CF_ACCESS_CLIENT_SECRET="Cloudflare Access Service Token 的 Client Secret"
$env:LOCAL_NODE_ID="company-rtx4090"
$env:LOCAL_NODE_NAME="公司 RTX 4090"
.\start-node.ps1
```

看到「心跳成功」後，中央教材向量庫會自動顯示已連線。停止測試可按 `Ctrl+C`。

## Windows 安全自動啟動

先在目前 PowerShell 完成上述六個環境變數設定並確認心跳成功，停止前景節點後執行：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\install-auto-start.ps1
```

安裝程式會以目前 Windows 帳號的 DPAPI 加密兩組 Secret，建立 `iBrain Local Node` 登入排程並立即啟動。金鑰不會寫入啟動腳本或命令列。執行紀錄位於 `%LOCALAPPDATA%\iBrainLocalNode\logs\node.log`。

解除自動啟動：

```powershell
.\uninstall-auto-start.ps1
```

PDF 文字擷取需先安裝：

```powershell
python -m pip install pypdf
```

掃描型 PDF 的 OCR 另需 PyMuPDF、PaddlePaddle 與 PaddleOCR。節點會先使用 PDF 內建文字層，只有文字不足的頁面才啟動 OCR，避免浪費 GPU 時間。

將待處理檔案放入 `C:\iBrain-local-node\inbox`，再於總管理後台按「掃描本機 inbox」，每批最多勾選 10 份加入佇列。RTX 4090 會逐份處理，已完成或正在排隊的同名檔案會自動跳過。

## 本機影音轉檔

先安裝 NVIDIA 顯示卡驅動與 FFmpeg，並確認以下兩個命令都可執行：

```powershell
ffmpeg -version
ffmpeg -hide_banner -encoders | Select-String h264_nvenc
```

把 MP4、MOV、M4V 或 MKV 放入 `C:\iBrain-local-node\video-inbox`，再到總管理後台的「影音課程」建立任務。本機會以 RTX 4090 轉為單畫質 HLS；原始影片不會上傳或刪除。若希望同步產生 SRT／VTT 字幕，可選配安裝：

轉檔期間會每數秒回報處理階段、百分比、已用時間及預估剩餘時間，管理後台會自動更新進度條。

```powershell
python -m pip install faster-whisper
```

未安裝字幕套件時仍可正常完成 HLS，不會阻擋課程上架。畫面顯示「影片／資料工作完成」只代表 HLS 或資料工作完成；必須另看到「字幕背景工作：SRT 上傳完成」，才代表字幕完成。
