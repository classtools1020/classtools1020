/**
 * 115年度新竹縣第二十三屆特殊教育學生適應體育趣味運動競賽
 * 成績公告系統 後台（Google Apps Script，綁定在「成績資料庫」試算表）
 *
 * 部署方式：試算表 → 擴充功能 → Apps Script → 貼上本檔 → 部署 → 新增部署作業 →
 *   類型「網頁應用程式」、執行身分「我」、誰可以存取「任何人」→ 部署 → 複製網址。
 *
 * 分頁（第一次執行會自動建立）：
 *   成績：組別｜項目｜名次｜學校｜成績｜公布｜更新時間｜更新者
 *   學校：學校｜國小組｜國中組（打 V 表示該組別有參賽）
 *   人員：名稱｜認證碼｜角色（admin 或 entry）
 *   設定：鍵｜值（公告）
 *   紀錄：時間｜人員｜動作｜內容
 */

var DIVISIONS = { '國小組': 8, '國中組': 3 };
var ITEMS = ['探囊取物大奔走(男)', '探囊取物大奔走(女)', '階梯球', '速速配', '顆星連珠', '弓箭標靶', '草地投籃', '九宮格', '舀杯高手', '看你多搖擺', '目標一致', '沙包投擲賽', '精神總錦標'];
var SCHOOLS = [
  ['大同國小', 'V', ''], ['山崎國小', 'V', ''], ['嘉豐國小', 'V', ''], ['中山國小', 'V', ''], ['竹仁國小', 'V', ''],
  ['竹北國小', 'V', ''], ['竹東國小', 'V', ''], ['芎林國小', 'V', ''], ['博愛國小', 'V', ''], ['湖口國小', 'V', ''],
  ['新社國小', 'V', ''], ['新埔國小', 'V', ''], ['新湖國小', 'V', ''], ['新豐國小', 'V', ''], ['橫山國小', 'V', ''], ['關西國小', 'V', ''],
  ['竹北國中', '', 'V'], ['竹東國中', '', 'V'], ['芎林國中', '', 'V'], ['富光國中', '', 'V'], ['湖口國中', '', 'V'], ['新豐國中', '', 'V'],
  ['新竹特教學校', 'V', 'V'],
];

// ---------- 工具 ----------
function ss() { return SpreadsheetApp.getActive(); }
function sheet(name, header) {
  var s = ss().getSheetByName(name);
  if (!s) {
    s = ss().insertSheet(name);
    s.appendRow(header);
    s.setFrozenRows(1);
    s.getRange(1, 1, 1, header.length).setFontWeight('bold');
  }
  return s;
}
function randomCode(len) {
  var digits = '0123456789', out = '';
  for (var i = 0; i < len; i++) out += digits.charAt(Math.floor(Math.random() * 10));
  return out;
}
function randomAdminCode() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = '';
  for (var i = 0; i < 8; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}
function now() { return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss'); }
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function rows(s) {
  var last = s.getLastRow();
  if (last < 2) return [];
  return s.getRange(2, 1, last - 1, s.getLastColumn()).getValues();
}
function truthy(v) { return /^(v|V|✓|true|TRUE|是|1|y|Y)$/.test(String(v).trim()); }

/** 第一次執行：建立分頁、學校名單、預設人員（管理者 1 位、登打 3 位）。可重複執行，不會覆蓋已填資料。 */
function setup() {
  sheet('成績', ['組別', '項目', '名次', '學校', '成績', '公布', '更新時間', '更新者']);
  var sc = sheet('學校', ['學校', '國小組', '國中組']);
  if (sc.getLastRow() < 2) sc.getRange(2, 1, SCHOOLS.length, 3).setValues(SCHOOLS);
  var us = sheet('人員', ['名稱', '認證碼', '角色']);
  if (us.getLastRow() < 2) {
    us.getRange(2, 1, 4, 3).setValues([
      ['管理者', randomAdminCode(), 'admin'],
      ['登打甲', randomCode(6), 'entry'],
      ['登打乙', randomCode(6), 'entry'],
      ['登打丙', randomCode(6), 'entry'],
    ]);
  }
  var st = sheet('設定', ['鍵', '值']);
  if (st.getLastRow() < 2) st.getRange(2, 1, 1, 2).setValues([['公告', '']]);
  sheet('紀錄', ['時間', '人員', '動作', '內容']);
  return '完成。請到「人員」分頁查看認證碼。';
}

function findUser(code) {
  code = String(code || '').replace(/[\s-]/g, '').toUpperCase();
  if (!code) return null;
  var list = rows(sheet('人員', ['名稱', '認證碼', '角色']));
  for (var i = 0; i < list.length; i++) {
    if (String(list[i][1]).replace(/[\s-]/g, '').toUpperCase() === code && list[i][0]) {
      return { name: String(list[i][0]), role: String(list[i][2] || 'entry').trim() === 'admin' ? 'admin' : 'entry' };
    }
  }
  return null;
}
function log(user, action, detail) {
  sheet('紀錄', ['時間', '人員', '動作', '內容']).appendRow([now(), user ? user.name : '', action, typeof detail === 'string' ? detail : JSON.stringify(detail)]);
}
function getSetting(key) {
  var list = rows(sheet('設定', ['鍵', '值']));
  for (var i = 0; i < list.length; i++) if (list[i][0] === key) return String(list[i][1] || '');
  return '';
}
function setSetting(key, value) {
  var s = sheet('設定', ['鍵', '值']);
  var list = rows(s);
  for (var i = 0; i < list.length; i++) if (list[i][0] === key) { s.getRange(i + 2, 2).setValue(value); return; }
  s.appendRow([key, value]);
}
function schools() {
  return rows(sheet('學校', ['學校', '國小組', '國中組'])).filter(function (r) { return r[0]; }).map(function (r) {
    return { name: String(r[0]).trim(), elementary: truthy(r[1]), junior: truthy(r[2]) };
  });
}
function allResults() {
  return rows(sheet('成績', [])).filter(function (r) { return r[0] && r[1]; }).map(function (r) {
    return { division: String(r[0]), item: String(r[1]), rank: Number(r[2]), school: String(r[3] || '').trim(), score: String(r[4] || '').trim(), published: truthy(r[5]), updated_at: String(r[6] || ''), updated_by: String(r[7] || '') };
  });
}
function lastUpdate(list) {
  var m = '';
  list.forEach(function (r) { if (r.updated_at > m) m = r.updated_at; });
  return m;
}

// ---------- 讀取 ----------
function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || 'public';
  if (action === 'public') {
    var pub = allResults().filter(function (r) { return r.published && r.school; });
    return json({ ok: true, announcement: getSetting('公告'), items: ITEMS, divisions: DIVISIONS, results: pub, updated_at: lastUpdate(pub), server_time: now() });
  }
  if (action === 'staff') {
    var user = findUser(p.code);
    if (!user) return json({ ok: false, error: '認證碼不正確' });
    return json({ ok: true, user: user, announcement: getSetting('公告'), items: ITEMS, divisions: DIVISIONS, schools: schools(), results: allResults(), server_time: now() });
  }
  return json({ ok: false, error: '未知的 action' });
}

// ---------- 寫入（POST，body 為 JSON 文字） ----------
function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: 'JSON 格式錯誤' }); }
  var user = findUser(body.code);
  if (!user) return json({ ok: false, error: '認證碼不正確或已停用' });
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { return json({ ok: false, error: '系統忙碌中，請再按一次儲存' }); }
  try {
    if (body.action === 'save') return saveItem(user, body);
    if (body.action === 'announce') {
      if (user.role !== 'admin') return json({ ok: false, error: '只有管理者可以修改公告' });
      setSetting('公告', String(body.text || '').slice(0, 200));
      log(user, '公告', body.text);
      return json({ ok: true });
    }
    return json({ ok: false, error: '未知的 action' });
  } finally {
    lock.releaseLock();
  }
}

/**
 * 儲存一個（組別、項目）的全部名次。
 * body: { division, item, publish: true/false, rows: [{rank, school, score}] }
 * 整個項目的舊列會被新列取代，並保留舊內容到「紀錄」分頁。
 */
function saveItem(user, body) {
  var division = String(body.division || '');
  var item = String(body.item || '');
  if (!DIVISIONS[division]) return json({ ok: false, error: '組別不正確' });
  if (ITEMS.indexOf(item) < 0) return json({ ok: false, error: '項目不正確' });
  var maxRank = DIVISIONS[division];
  var valid = schools().filter(function (s) { return division === '國小組' ? s.elementary : s.junior; }).map(function (s) { return s.name; });
  var input = Array.isArray(body.rows) ? body.rows : [];
  var clean = [], seen = {}, errors = [];
  input.forEach(function (r, i) {
    var rank = Number(r.rank), school = String(r.school || '').trim(), score = String(r.score || '').trim().slice(0, 40);
    if (!school) return;
    if (!(rank >= 1 && rank <= maxRank && rank === Math.floor(rank))) { errors.push('第 ' + (i + 1) + ' 列名次須為 1–' + maxRank); return; }
    if (valid.indexOf(school) < 0) { errors.push(school + ' 不在' + division + '的學校名單中'); return; }
    if (seen[school]) { errors.push(school + ' 重複出現'); return; }
    seen[school] = true;
    clean.push({ rank: rank, school: school, score: score });
  });
  if (errors.length) return json({ ok: false, error: errors.join('；') });
  var publish = Boolean(body.publish);

  var s = sheet('成績', ['組別', '項目', '名次', '學校', '成績', '公布', '更新時間', '更新者']);
  var data = rows(s);
  var before = [];
  for (var i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]) === division && String(data[i][1]) === item) {
      before.push({ rank: data[i][2], school: data[i][3], score: data[i][4], published: data[i][5] });
      s.deleteRow(i + 2);
    }
  }
  var t = now();
  clean.sort(function (a, b) { return a.rank - b.rank; });
  if (clean.length) {
    s.getRange(s.getLastRow() + 1, 1, clean.length, 8).setValues(clean.map(function (r) {
      return [division, item, r.rank, r.school, r.score, publish ? 'V' : '', t, user.name];
    }));
  }
  log(user, publish ? '儲存並公布' : '儲存草稿', { division: division, item: item, before: before.reverse(), after: clean });
  return json({ ok: true, saved: clean.length, published: publish, updated_at: t });
}
