/**
 * IEP 期末會議調查 — 後台
 * ----------------------------------
 * 部署步驟：
 * 1. 開新 Google Sheet（名稱建議：IEP會議調查_114下）
 * 2. 上方選單 → 擴充功能 → Apps Script
 * 3. 把此檔內容貼進去，存檔
 * 4. 點右上「部署」→「新增部署作業」→ 類型選「網頁應用程式」
 *    - 執行身分：我
 *    - 存取權：所有人
 * 5. 部署後會給你一個 URL，把它貼到 iep-meeting-2026spring.html 裡的
 *    CONFIG.APPS_SCRIPT_URL
 * 6. 之後每次修改後台程式碼要重新部署（或選「管理部署作業」更新版本）
 */

const SHEET_NAME = '預約';
const HEADERS = ['時間戳記', '學生', '家長姓名', '聯絡電話', '會議日期', '會議時段', '備註'];

/* ============ 進入點：GET（家長端載入時讀取已預約時段） ============ */
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'list';
  try {
    if (action === 'list') {
      return jsonResponse({ ok: true, bookings: getBookings() });
    }
    return jsonResponse({ ok: false, error: 'unknown action' });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

/* ============ 進入點:POST（家長送出回覆） ============ */
function doPost(e) {
  const lock = LockService.getScriptLock();
  const got = lock.tryLock(10000);
  if (!got) {
    return jsonResponse({ ok: false, error: '系統忙碌中,請稍後再試' });
  }

  try {
    const payload = JSON.parse(e.postData.contents);
    const { student, parent, phone, notes, isPhoneVisit, date, time } = payload;

    // 驗證
    if (!student || !parent || !phone) {
      return jsonResponse({ ok: false, error: '請填寫完整資訊' });
    }
    if (!isPhoneVisit && (!date || !time)) {
      return jsonResponse({ ok: false, error: '請選擇會議時段' });
    }

    // 衝突檢查（電訪不檢查）
    if (!isPhoneVisit) {
      const bookings = getBookings();
      const conflict = bookings.some(b => b.date === date && b.time === time);
      if (conflict) {
        return jsonResponse({ ok: false, error: 'CONFLICT' });
      }
    }

    // 寫入
    const sheet = getOrCreateSheet();
    sheet.appendRow([
      new Date(),
      student,
      parent,
      "'" + phone, // 前置單引號避免被 Sheet 自動格式化掉 0
      isPhoneVisit ? '電訪' : date,
      isPhoneVisit ? '不便到校' : time,
      notes || '',
    ]);

    return jsonResponse({ ok: true });

  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

/* ============ 工具:讀取目前已預約的時段 ============ */
function getBookings() {
  const sheet = getOrCreateSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  return data
    .filter(row => row[4] && row[4] !== '電訪') // 排除電訪
    .map(row => ({
      date: String(row[4]).trim(),
      time: String(row[5]).trim(),
      student: row[1],
    }));
}

/* ============ 工具：取得或建立工作表 ============ */
function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#fae5dc');
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(2, 90);
    sheet.setColumnWidth(3, 120);
    sheet.setColumnWidth(4, 130);
    sheet.setColumnWidth(5, 100);
    sheet.setColumnWidth(6, 120);
    sheet.setColumnWidth(7, 240);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/* ============ 工具：JSON 回應 ============ */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============ 開發測試用（在編輯器手動執行） ============ */
function testGet() {
  Logger.log(getBookings());
}

function clearAllBookings() {
  // ⚠️ 危險！會清掉所有預約資料。只在測試完想清空時手動執行。
  const sheet = getOrCreateSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, HEADERS.length).clearContent();
  }
}
