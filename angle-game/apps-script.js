/**
 * 角度大冒險 — 雲端後台（Google Apps Script）
 *
 * 使用方式：
 * 1. 建立一個新的 Google 試算表
 * 2. 點選「擴充功能」→「Apps Script」
 * 3. 刪除預設的程式碼，貼上這整段
 * 4. 點選「部署」→「新增部署作業」
 * 5. 類型選「網頁應用程式」
 * 6. 執行身分：「我」
 * 7. 誰可以存取：「所有人」
 * 8. 點選「部署」→ 複製網址
 * 9. 把網址貼到遊戲設定（見下方說明）
 */

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('progress');

    if (!sh) {
      sh = ss.insertSheet('progress');
      sh.appendRow(['姓名', '角色', '戰鬥力', '關1', '關2', '關3', '關4', '關5', '關6', '最後更新']);
      sh.getRange(1, 1, 1, 10).setFontWeight('bold');
    }

    var rows = sh.getDataRange().getValues();
    var rowIdx = -1;
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0] === d.name) { rowIdx = i + 1; break; }
    }

    var row = [
      d.name,
      d.avatar || '👤',
      d.power || 0,
      d.l1 || 0, d.l2 || 0, d.l3 || 0,
      d.l4 || 0, d.l5 || 0, d.l6 || 0,
      new Date().toLocaleString('zh-TW')
    ];

    if (rowIdx > 0) {
      sh.getRange(rowIdx, 1, 1, row.length).setValues([row]);
    } else {
      sh.appendRow(row);
    }

    return send({ok: true});
  } catch (err) {
    return send({error: err.message});
  }
}

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('progress');

    if (!sh || sh.getLastRow() < 2) {
      return send({});
    }

    var data = sh.getDataRange().getValues();
    var result = {};

    for (var i = 1; i < data.length; i++) {
      var name = data[i][0];
      if (!name) continue;
      result[name] = {
        avatar: data[i][1],
        power: Number(data[i][2]) || 0,
        levels: {
          l1: Number(data[i][3]) || 0,
          l2: Number(data[i][4]) || 0,
          l3: Number(data[i][5]) || 0,
          l4: Number(data[i][6]) || 0,
          l5: Number(data[i][7]) || 0,
          l6: Number(data[i][8]) || 0
        }
      };
    }

    return send(result);
  } catch (err) {
    return send({error: err.message});
  }
}

function send(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
