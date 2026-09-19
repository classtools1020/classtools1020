# 115年度新竹縣第23屆特殊教育學生適應體育趣味運動競賽 成績公告系統

活動日期：民國115年11月6日（星期五）｜場地：國立新竹特殊教育學校｜承辦：新竹縣立竹東國民中學

現場使用的成績登錄、複核與公告系統。三個畫面共用同一個雲端資料庫：

| 畫面 | 網址 | 誰使用 | 做什麼 |
|---|---|---|---|
| 公開成績頁 | `/` | 所有人，免登入 | 查國小組／國中組各項目已公布名次、精神總錦標；每 20 秒自動更新；QR Code；列印 |
| 工作人員 | `/staff` | 輸入人員、複核人員、管理者 | 輸入 6 位數認證碼（或點登入連結）→ 選項目 → 選學校 → 填名次成績 → 儲存 → 送複核 → 發布 |
| 管理 | `/staff` 的「人員／學校／項目／活動」 | 管理者 | 邀請同事、指派分工、維護學校隊伍與項目、匯出 CSV |

成績流程只有三個狀態：**草稿 → 待複核 → 已公布**。公開頁只讀「已公布」快照；沒有結果時顯示「成績尚未公告」。

## 技術架構

- Node.js 20+ / Express，純 HTML + CSS + ES Module 前端（不依賴任何 CDN，現場網路不穩也能載入）。
- PostgreSQL（Supabase、Neon、Railway、Render、Fly 皆可）。正式成績全部存在資料庫；瀏覽器 `localStorage` 只做離線草稿暫存。
- 登入採「認證碼」：管理者新增同事時系統產生 6 位數字碼（管理者為 8 位英數），同事不需要 Email、密碼或任何帳號；也可用 `…/staff?code=123456` 登入連結或 QR Code 一鍵登入。每個人仍是獨立身分，操作紀錄可追溯。
- 權限由伺服器執行：所有寫入 API 都檢查登入、角色與（組別、項目）指派；公開 API 只讀 `publications` 資料表。
- 樂觀鎖（`version`）偵測同時修改；`opId` 冪等鍵避免斷線重送造成重複；`audit_log` 保留操作者、時間、修改前後內容。

資料表：`events` 活動、`divisions` 組別、`items` 項目（含精神總錦標）、`schools` 學校、`teams` 隊伍、`users` / `sessions` / `assignments` 人員與分工、`sheets` + `sheet_rows` 工作中的成績表、`publications` 已發布版本、`client_ops` 冪等紀錄、`audit_log` 操作紀錄。完整結構見 [`db/schema.sql`](db/schema.sql)。

## 本機執行

需要 Node.js 20+ 與一個 PostgreSQL。

```bash
npm install
cp .env.example .env          # 填 DATABASE_URL
export $(grep -v '^#' .env | xargs)
npm run db:migrate            # 建立資料表（可重複執行）
npm run db:seed               # 建立正式活動：兩個組別、11 個項目、精神總錦標（不含成績、學校）
ADMIN_CODE=請換成至少8字元 ADMIN_NAME=曾老師 npm start   # http://localhost:3000 ；/staff 用 ADMIN_CODE 登入
```

想先用假資料玩一遍：

```bash
npm run db:seed:demo                                  # 建立「示範活動」與示範帳號（與正式活動分離）
ACTIVE_EVENT_SLUG=demo-adaptive-sports npm start      # 只有加這個環境變數時才會顯示示範活動
npm run db:demo:remove                                # 正式上線前清除示範資料
```

示範認證碼：管理者 `DEMOADMIN`、輸入甲 `111111`、輸入乙 `222222`、複核 `333333`。

## 環境變數

見 [`.env.example`](.env.example)。`.env` 已在 `.gitignore`，請勿提交。

| 變數 | 說明 |
|---|---|
| `DATABASE_URL` | PostgreSQL 連線字串。雲端資料庫通常要加 `?sslmode=require` |
| `PORT` | 埠號，多數平台自動注入 |
| `PUBLIC_URL` | 正式公告網址，用於 QR Code 與邀請連結，例如 `https://xxx.onrender.com` |
| `NODE_ENV` | 正式環境設 `production`（Cookie 加 Secure，需 HTTPS） |
| `ACTIVE_EVENT_SLUG` | 只在想瀏覽示範活動時設 `demo-adaptive-sports`，正式環境不要設 |
| `ADMIN_CODE` / `ADMIN_NAME` | 管理者認證碼（至少 8 字元）與顯示名稱。伺服器每次啟動都會確保這位管理者存在，部署後不必跑任何指令 |

## 部署

程式碼放在 GitHub 不等於網站上線；需要一個能跑 Node.js 的主機加一個 PostgreSQL。以下任一方式皆可：

### 方式 A：Render（最少步驟）
1. 到 <https://render.com> 用 GitHub 登入 → New → Blueprint → 選這個儲存庫（會讀取 `render.yaml`，同時建立 Web Service 與 PostgreSQL）。
2. 建立時會要求填 `ADMIN_CODE`（自己想一組至少 8 字元的碼）。
3. 部署完成後複製網址（例如 `https://adaptive-sports-results-115.onrender.com`），到 Environment 填入 `PUBLIC_URL`（讓 QR Code 與登入連結正確）。
4. 打開 `網址/staff`，輸入 `ADMIN_CODE` 登入，開始新增學校與同事。
5. 注意：Render 免費方案閒置會休眠、首次開啟要等 30–60 秒；比賽當天請用付費方案（`render.yaml` 已設 starter）。

### 方式 B：Railway / Zeabur / Fly.io
- Railway、Zeabur：新增專案 → 從 GitHub 匯入 → 加一個 PostgreSQL 服務 → 把它的連線字串設成 `DATABASE_URL` → Start Command 設為 `node scripts/migrate.js && node scripts/seed.js && node server/index.js`。
- Fly.io：`fly launch`（讀取 `fly.toml`）→ `fly postgres create` → `fly postgres attach` → `fly deploy`。

### 方式 C：任何支援 Docker 的主機
`Dockerfile` 已備妥；啟動時會自動建表與建立正式活動。

### 資料庫可用 Supabase / Neon
只要拿到 Postgres 連線字串就能用（Supabase 專案設定 → Database → Connection string，選 Session mode，並加 `?sslmode=require`）。

## 新增同事與設定權限（認證碼制）

1. 管理者登入 `/staff` → 「人員與認證碼」→ 填姓名（也可以填站別，例如「九宮格站」）、選角色 → 「新增並產生認證碼」。
2. 系統顯示 6 位數認證碼與登入連結。用 LINE 傳連結（點開即登入）或直接告訴對方認證碼；也可按「列印代碼表」印出每人一張含 QR Code 的卡片，當天發下去掃描即可。
3. 展開該同事 → 勾選負責的組別／項目 → 「儲存分工」。輸入與複核人員只能看到、操作被勾選的項目；管理者可處理全部。
4. 認證碼外流或忘記：按「重新產生」，舊碼立即失效並登出該裝置。賽後把人員取消「啟用」即可全部停權。

安全設計：同一來源 10 分鐘內猜錯 20 次會被暫時封鎖；認證碼不會出現在公開頁；登入連結打開後認證碼會立刻從網址列移除。認證碼以明文保存在資料庫，方便管理者隨時查看與列印，因此只建議用於活動期間。

三種角色：

| 角色 | 可以 | 不可以 |
|---|---|---|
| 管理者 | 全部：人員、學校、項目、活動、輸入、複核、發布、匯出 | 停用自己 |
| 成績輸入人員 | 編輯被指派項目的草稿、送複核、對已公布的表建立修訂草稿 | 發布、退回、看管理頁、匯出 |
| 複核人員 | 檢視被指派項目即將公開的結果、退回修正、發布、匯出 CSV、看紀錄 | 編輯草稿內容 |

這些限制都在伺服器端執行（見 `server/routes/*.js` 與 `server/sheets.js`），不是只有隱藏按鈕。

## 學校與隊伍

「學校」頁可一次貼上多所學校（每行一所），勾選要加入的組別會自動建立該組隊伍。同校第二隊用「＋隊伍」加上「B隊」等標籤。已有成績的學校不能刪除，只能停用隊伍。

## 匯出資料

「待複核」或「活動」頁的按鈕，或直接開：
- `/api/staff/export.csv?scope=published` 已公布成績
- `/api/staff/export.csv?scope=all` 全部含草稿與待複核

CSV 為 UTF-8 含 BOM，Excel 直接開啟不會亂碼，欄位：組別、項目、名次、並列、學校、隊伍、成績、單位、備註、狀態、版次、時間。需管理者或複核人員登入。

## 測試

```bash
npm test          # API 驗收測試（需 TEST_DATABASE_URL，預設 postgres://app:app@127.0.0.1:5432/adaptive_sports_test）
npm run test:e2e  # Playwright 瀏覽器驗收（手機／平板／桌機），截圖在 test/e2e/screenshots/
```

已覆蓋：認證碼登入、登入連結、重新產生與停用、暴力猜測封鎖；兩位同事同時輸入不同項目；未登入／越權寫入被拒；草稿與待複核不出現在公開 API；發布後另一裝置自動更新；國小 1–8 名、國中前 3 名、精神總錦標；同筆資料同時修改的衝突對話框；離線儲存不誤報成功、重連自動同步不重複；手機尺寸按鈕 ≥ 44px、文字 ≥ 16px、無橫向溢出。

## 讓當天不用管電腦的建議

- **多給幾位複核人員**：發布權交給 2–3 位信任的同事（或直接給管理者角色），您不在也能發布。
- **代碼表**：賽前印好「列印代碼表」，每站一張卡，掃 QR 就登入，不用教任何人設密碼。
- **公告列**：「活動」頁有一行公告，可隨時改成「頒獎典禮 14:00 司令台」之類的現場訊息，公開頁 20 秒內更新。
- **主機別休眠**：用付費方案或設一個免費的 UptimeRobot 每 5 分鐘 ping `/api/health`。
- **備份**：任何時候按「下載已公布成績 CSV」就是完整備份；資料庫本身在雲端供應商那裡。
- **主視覺**：`public/assets/kv.svg` 是可替換的主視覺（原創剪影版）。想換成動漫插畫，把圖存成 `public/assets/kv.jpg` 並把 `styles.css` 中 `.hero-art` 的 `kv.svg` 改成 `kv.jpg` 即可。

## 安全與資料

- Session 為 HttpOnly Cookie；寫入需自訂標頭（CSRF）；登入有嘗試次數限制；CSP 限制只載入同源資源。
- 公開頁只呈現學校／隊伍，不含學生姓名。
- 請勿把 `.env`、學生名冊或正式成績匯出檔提交到 Git。
