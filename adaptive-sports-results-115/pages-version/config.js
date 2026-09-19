/* 後台設定。二選一填寫（都空白時，網頁只顯示項目清單，無法登打）。
 *
 * 方式 A：Supabase（建議）— 在 Supabase 專案的 SQL Editor 執行 backend/supabase.sql，
 *   然後把 Project Settings → API 裡的 Project URL 與 anon public key 填在下面。
 * 方式 B：Google Apps Script — 依 backend/部署說明.md 部署後把網頁應用程式網址填入 API_URL。 */
export const SUPABASE_URL = 'https://nirqcndjbrfqxcpioqec.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pcnFjbmRqYnJmcXhjcGlvcWVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4MTc0NzAsImV4cCI6MjEwNTM5MzQ3MH0.zSNX6YGzK1LtZviykJ8u25Rly8k4gcblDd99c5RuOX8';
export const API_URL = '';

export const SITE_URL = 'https://hccadaptive.com/';
export const EVENT_NAME = '115年度新竹縣第二十三屆特殊教育學生適應體育趣味運動競賽';
export const DIVISIONS = { '國小組': 8, '國中組': 3 };
export const ITEMS = ['探囊取物大奔走(男)', '探囊取物大奔走(女)', '階梯球', '速速配', '顆星連珠', '弓箭標靶', '草地投籃', '九宮格', '舀杯高手', '看你多搖擺', '目標一致', '沙包投擲賽', '精神總錦標'];
export const KNOCKOUT = ['沙包投擲賽'];
