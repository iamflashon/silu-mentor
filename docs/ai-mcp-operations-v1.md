# 考試顧問與陪考教練第一版

## 學生端

- `/law?mode=advisor`：考試顧問。先確認考試目標、程度、剩餘時間與弱點，再搜尋平台已授權或已匯入的高點教材、題庫、課程與師資資料。只有實際找到資料時才推薦，並說明名稱、適用程度、使用順序與理由。
- `/law?mode=coach`：陪考教練。承接目前進度，每次提供一個可完成的行動，完成後再練習、檢查與調整。
- 網站具備 PWA 安裝資訊，可以從手機瀏覽器加入主畫面。Service Worker 不快取私人對話、會員或付款資料。
- `/mcp/connect`：第一階段連接說明。學生可把 `/mcp` 加入自己的 ChatGPT，使用原本的 ChatGPT 模型額度。

## 學生自有 ChatGPT MCP

遠端 MCP 使用 Streamable HTTP 與 OAuth 2.1／PKCE。ChatGPT 可動態註冊 OAuth Client；學生以同一個 ChatGPT 帳號登入平台、查看授權內容並同意後，才會取得短效 Access Token。伺服器只保存 Token 雜湊，Access Token 一小時到期，Refresh Token 會輪替。

第一版提供三個工具：

- `search_gaodian_resources`：搜尋管理後台已審核、已發布的高點資源，只回傳真實命中和來源網址。
- `get_exam_progress`：讀取該會員最近的學習紀錄與陪考打卡。
- `save_coaching_checkin`：在學生明確同意後保存完成內容、弱點與下一步。

每位學生每日預設最多呼叫 100 次，可透過 `MCP_DAILY_CALL_LIMIT` 調整。每次成功或失敗都記入 AI／MCP 營運中心。

## 管理端

管理員由 `/admin/ai-operations` 統一管理：

- 每月 AI 預算上限與目前消耗。
- 模型與 MCP 的呼叫數、估算成本、成功或失敗狀態。
- MCP Server 名稱、HTTPS 位址、可用角色、每次點數與預算。
- MCP 連線健康檢查與工具清單同步。
- 每個工具是否開放、是否需要核准及單次點數。

MCP Bearer Token 不寫入資料庫。資料庫只保存執行環境密鑰名稱；真正的 Token 應由正式環境的秘密設定提供。

## 上線前設定

1. 套用 `0088_mcp_operations` 與 `0089_student_mcp_oauth` 資料庫 migration。
2. 在正式環境設定需要的 MCP Token，名稱須與管理頁填寫的密鑰名稱一致。
3. 由管理頁新增 MCP Server，執行「測試並同步工具」。
4. 逐一設定學生可用工具、核准規則及點數。
5. 用真實學生帳號驗證考試顧問、陪考教練、用量扣抵與來源顯示。

## 第一版界線

既有平台教材庫與搜尋功能已可供網站內的考試顧問與學生自有 ChatGPT 使用；任意外部 MCP 的註冊、連線測試、工具同步與政策管理也已完成。學生 MCP 目前只開放上述三個窄範圍工具，其餘功能不會自動暴露。
