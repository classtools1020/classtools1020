# Supabase 設定（一次，約 3 分鐘）

1. 到 https://supabase.com 登入 → New project（名稱隨意，例如 adaptive-sports-115；Region 選 Northeast Asia (Tokyo)；資料庫密碼自己設、記下）。等 1 分鐘建立完成。
2. 左側選單 **SQL Editor** → New query → 把 `backend/supabase.sql` 全部內容貼上 → **Run**。看到 Success 即可（重複執行也沒關係）。
3. 左側 **Project Settings → API**：複製 **Project URL**（https://xxxx.supabase.co）和 **anon public** key，傳給 Claude 填進網站 `config.js`。
4. 認證碼在 **Table Editor → schema 選 asr → staff**，可直接改名稱、改碼、新增列（role 填 admin 或 entry）。
5. 學校名單在 **asr → schools**；成績在 **asr → results**（published 打勾才公開）；每次儲存都在 **asr → log** 留紀錄。

安全：anon key 放在網頁是正常用法。它只能讀「已公布」成績、學校與公告，寫入一定要附認證碼並由資料庫端函式檢查。
