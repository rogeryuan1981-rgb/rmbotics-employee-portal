# 員工共用入口與教育訓練平台

本次開發基準：`docs/employee-training-spec.md`。以原有 Snack Vote 的 Vite／React／Supabase 程式延伸，未改用 `app/` 的未使用範本。

原始基準：`e7bb32183991c33424a34994684a06e7d0e9b661`；開發分支：`feature/employee-portal-training`。

本次僅開發與本機測試，沒有部署、操作正式資料庫或向真實員工寄信。

## 立即在本機執行（不需要憑證）

需 Node.js 22.13 以上版本與 npm。解壓縮程式後，在專案根目錄執行：

```powershell
npm ci
npm run dev:local
```

開啟 `http://127.0.0.1:5173/`。服務只綁定本機回送位址。

| 測試身分 | Email | 初始權限 |
| --- | --- | --- |
| 管理員 | admin@example.test | 訓練管理員、原有零食管理員 |
| 學員 | learner@example.test | 個人學習、零食投票 |
| 主管 | manager@example.test | 行政部訓練管理 |
| HR | hr@example.test | 行政部人員與訓練管理；不能維護題庫 |
| 其他部門學員 | other@example.test | 服務部員工 |

依畫面要求寄送驗證碼，再開啟 `http://127.0.0.1:4174/local/inbox` 取得本機驗證碼。亦可查看 `work/mail/otp-<Email>.json`。驗證碼以亂數產生、五分鐘有效、最多五次嘗試；未發送至外部郵件服務。

本機資料存於 `work/local-pgdata/`，重新啟動仍會保留。本機郵件存於 `work/mail/`。若需重新建立測試資料，停止服務後將這兩個目錄改名備份，再重新啟動；不要對正式資料庫使用本機初始化程式。

本機採 PGlite 執行原有零食 SQL 與本次相同的 PostgreSQL 遷移及 RPC。Auth／REST 由開發用介面替代，**不等於已驗證遠端 Supabase Auth、SMTP、Realtime 或正式設定**。本機驗證碼只接受 `@example.test`。

## 使用路徑

| 位置 | 路徑 |
| --- | --- |
| 共用入口 | `#/portal`；無 hash 也會進入入口 |
| 我的學習 | `#/training` |
| 單一課程 | `#/training/<訓練要求識別碼>` |
| 訓練後台 | `#/training/admin` |
| 既有零食活動 | `#/`；原有連結保留 |
| 既有零食後台 | `#/admin` |

建議本機操作順序：管理員登入 → 訓練後台 → 新增課程及教材、題目 → 發布 → 個別指派給學員；或先建立、發布職務說明書，再替員工設定職務與接任日。草稿不會自動指派。

課程正常完成需達課程總時數及測驗及格；更新重訓可另設本次時數、是否重考、範圍、期限及批次代碼。同批次重送不重複建立。PDF、文字及影片時間合計，不強制每份分別達標。

PDF 教材以允許本站跨來源讀取的 HTTPS 網址設定，使用 PDF.js 實際載入並繪製成功後才認列。YouTube 可貼影片網址；由內嵌播放器狀態計時，外部網站觀看不認列。職務說明書由系統直接編輯，沒有 PDF 匯入入口。

## 連接測試用 Supabase

以下是供未來具權限人員設定的步驟，本次未連接或執行正式環境。

1. 複製 `.env.example` 為 `.env.local`，填入 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_PUBLISHABLE_KEY`。服務管理金鑰不得放在任何 `VITE_*` 變數。
2. 備份並核對現有零食資料庫。既有專案僅依檔名順序執行 `supabase/migrations/202611150001_portal.sql` 至 `202611150005_hardening.sql`。**不要重新執行舊的 `supabase/final.sql`**：原檔含歷史資料校正，不是此次增量遷移。
   遷移需具備建立 `auth.sessions` 觸發器的管理權限，用於保存最新裝置；此項仍須在實際測試用 Supabase 確認，不可略過該觸發器後宣稱完成裝置排他控制。
3. 全新、拋棄式測試專案，才先執行原有 `supabase/final.sql` 建立零食基礎，再執行本次五個遷移。
4. 在 SQL 管理介面明確初始化第一位訓練管理員：

   ```sql
   select training.bootstrap_admin('管理員已列入名冊的 Email');
   ```

   此函式未授權給瀏覽器使用者。原有零食 admin 不會自動取得訓練管理員資格。
5. 原有員工僅保留零食資格；訓練資格須由管理員透過共用員工名冊、Excel 匯入或明確 SQL 設定。工作地點不會自動當作部門。先建立部門並補齊到職日，不能以假日期補值。
6. 依 Supabase 官方設定 Email OTP 範本，使用 `{{ .Token }}`，並設定測試用寄信服務、Site URL 及允許重新導向網址。既有登入介面也保留 magic link 相容性。
7. 執行 `npm run dev`；正式建置用 `npm run build`，靜態成品在 `dist/`。既有 GitHub Pages workflow 未觸發；本次未推送 main 或部署。

如果缺少既有基礎資料表、Auth 權限或工作階段結構，遷移會回報錯誤；不會以忽略安全檢查方式繼續。每個遷移以交易包裝，可重跑，並記錄於 `training.migrations`。

## 通知工作程序

排程、年度生成及測驗逾時交卷，需持續執行受信任工作程序，或由外部排程每分鐘執行一次。瀏覽器不持有服務管理金鑰。

另建立 `.env.worker`，填入 `.env.example` 中的後端變數；在已完成遷移的測試用 Supabase 上：

```powershell
node --env-file=.env.worker scripts/mail-worker.mjs
# 單次排程
node --env-file=.env.worker scripts/mail-worker.mjs --once
```

預設 `MAIL_MODE=sink`，通知只寫入本機。需設定：`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`MAIL_SINK_DIR`、`PORTAL_URL`。預設每天臺灣時間 09:00 產生 Email 彙整，提醒前 7／3／1 天，逾期每 7 天；HR 彙整預設關閉。

未來如獲另行授權實際寄信，才設定 `MAIL_MODE=resend`、`RESEND_API_KEY`、`MAIL_FROM`、`PORTAL_URL`，並明確設 `ALLOW_REAL_MAIL=true`。驗證碼郵件由 Supabase Auth 的郵件設定處理；此工作程序處理訓練通知，兩者設定分開。

同一收件人、同一天只有一個 outbox，主管按部門分組。寄出前重新檢查員工、範圍、完成狀態及開課狀態。已寄送當天不會再寄第二封；當日稍後新增要求仍即時顯示站內通知。

失敗由工作程序自動重試，使用固定 outbox 識別碼作為 Resend 去重鍵。重試內容固定；收件者或提醒資格改變時取消舊彙整。超過首次嘗試 23 小時會改為 `needs_review`，停止自動重寄，避免超過供應商 24 小時去重期限後重複寄信。管理者須先至供應商核對投遞結果，再處理該筆資料；不可直接清除已寄紀錄重跑。

## 驗證命令

```powershell
npm test
npm run test:db
npm run test:migrations
npm run build
npm audit
npm run test:e2e
```

端對端測試使用本機 Edge 無介面模式；如其他作業系統沒有 Edge，調整 `playwright.config.mjs` 的 `channel` 並安裝對應 Playwright Chromium。測試只使用虛構員工。報告在 `work/e2e-results.json`；失敗擷圖在 `test-results/`。

實測結果與尚未驗證項目請見 `docs/TEST-RESULTS.md`；後端安全、版本與擴充設計請見 `docs/ARCHITECTURE.md`。
