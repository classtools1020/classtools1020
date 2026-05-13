/**
 * IEP 期末會議調查 — 後台 (v2 複選版)
 * ----------------------------------
 * v2 變更：
 * - 改為多選（家長可勾 1–3 個方便時段）
 * - 移除衝突檢查（多人可選同時段）
 * - Sheet 欄位調整：增加「時段數」、用「勾選時段」一欄列出多個
 * - 老師依「時間戳記」先後排程
 */

const SHEET_NAME = '預約';
const HEADERS = ['時間戳記', '學生', '家長姓名', '聯絡電話', '形式', '勾選時段', '時段數', '備註'];

function doGet(e) {
  return jsonResponse({ ok: true, msg: 'IEP booking backend v2 alive' });
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const { student, parent, phone, notes, isPhoneVisit, slots } = payload;

    // 驗證
    if (!student || !parent || !phone) {
      return jsonResponse({ ok: false, error: '請填寫完整資訊' });
    }
    if (!isPhoneVisit && (!Array.isArray(slots) || slots.length === 0)) {
      return jsonResponse({ ok: false, error: '請勾選至少一個時段或選擇電訪' });
    }
    if (!isPhoneVisit && slots.length > 3) {
      return jsonResponse({ ok: false, error: '最多只能勾選 3 個時段' });
    }

    const slotsText = isPhoneVisit
      ? '電訪'
      : slots.map(s => `${s.date}（${s.time}）`).join('  /  ');

    const sheet = getOrCreateSheet();
    sheet.appendRow([
      new Date(),
      student,
      parent,
      "'" + phone,                            // 前置 ' 避免吃掉 0
      isPhoneVisit ? '電訪' : '到校',
      slotsText,
      isPhoneVisit ? 0 : slots.length,
      notes || '',
    ]);

    return jsonResponse({ ok: true });

  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  // 如果舊版的「預約」分頁存在但欄位不對，改名封存
  if (sheet) {
    const firstRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const headerMatch = HEADERS.every((h, i) => firstRow[i] === h);
    if (!headerMatch && sheet.getLastRow() > 1) {
      // 有舊資料但欄位不對 → 改名保留，建新表
      const ts = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd_HHmm');
      sheet.setName(`預約_舊版_${ts}`);
      sheet = null;
    } else if (!headerMatch) {
      // 沒資料但欄位不對 → 直接清掉重建
      ss.deleteSheet(sheet);
      sheet = null;
    }
  }

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#fae5dc');
    sheet.setColumnWidth(1, 160);  // 時間戳記
    sheet.setColumnWidth(2, 90);   // 學生
    sheet.setColumnWidth(3, 130);  // 家長姓名
    sheet.setColumnWidth(4, 130);  // 電話
    sheet.setColumnWidth(5, 70);   // 形式
    sheet.setColumnWidth(6, 360);  // 勾選時段
    sheet.setColumnWidth(7, 60);   // 時段數
    sheet.setColumnWidth(8, 240);  // 備註
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============ 測試用 ============ */
function testPost() {
  const result = doPost({
    postData: {
      contents: JSON.stringify({
        student: '翁o鈞',
        parent: '測試家長',
        phone: '0912345678',
        notes: '測試',
        isPhoneVisit: false,
        slots: [
          { date: '5/22', time: '15:00-15:30' },
          { date: '5/27', time: '15:30-16:00' },
        ],
      })
    }
  });
  Logger.log(result.getContent());
}
