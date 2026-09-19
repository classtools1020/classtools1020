import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, ACCOUNTS, BASE } from './helpers.js';

let server;
let boot;              // 以 admin 取得的基本資料
let elem, junior;      // 組別
let items;             // 項目
const teamsOf = (d) => boot.teams.filter((t) => t.division_id === d.id);
const itemByName = (n) => items.find((i) => i.name === n);

before(async () => {
  server = await startServer();
  const admin = client();
  await admin.login(...ACCOUNTS.admin);
  boot = (await admin.call('GET', '/api/staff/bootstrap')).data;
  elem = boot.divisions.find((d) => d.code === 'elementary');
  junior = boot.divisions.find((d) => d.code === 'junior');
  items = boot.items;
});
after(() => server?.kill());

const rowsFor = (d, n, opts = {}) => teamsOf(d).slice(0, n).map((t, i) => ({ team_id: t.id, rank: i + 1, score: String(50 - i), ...opts }));

async function publicResults() {
  const res = await fetch(`${BASE}/api/public/results`);
  return { status: res.status, data: await res.json(), text: JSON.stringify(await Promise.resolve()) };
}

test('驗收 1：兩位同事分別登入，能同時輸入各自負責的項目', async () => {
  const a = client(); const b = client();
  assert.equal((await a.login(...ACCOUNTS.entry1)).status, 200);
  assert.equal((await b.login(...ACCOUNTS.entry2)).status, 200);
  const itemA = itemByName('速速配');       // 分配給輸入甲（前半）
  const itemB = itemByName('看你多搖擺');   // 分配給輸入乙（後半）
  const [ra, rb] = await Promise.all([
    a.call('PUT', `/api/staff/sheets/${elem.id}/${itemA.id}`, { version: 0, rows: rowsFor(elem, 3) }),
    b.call('PUT', `/api/staff/sheets/${elem.id}/${itemB.id}`, { version: 0, rows: rowsFor(elem, 3) }),
  ]);
  assert.equal(ra.status, 200, JSON.stringify(ra.data));
  assert.equal(rb.status, 200, JSON.stringify(rb.data));
  assert.equal(ra.data.sheet.status, 'draft');
  assert.equal(rb.data.sheet.rows.length, 3);
});

test('驗收 2：未授權者不能寫入；輸入人員不能越權發布或編輯未分配項目；複核人員不能編輯草稿', async () => {
  const anon = client();
  const item = itemByName('九宮格');
  const r0 = await anon.call('PUT', `/api/staff/sheets/${elem.id}/${item.id}`, { version: 0, rows: [] });
  assert.equal(r0.status, 401);
  assert.equal((await anon.call('POST', `/api/admin/invitations`, { email: 'x@example.com', name: 'x', role: 'admin' })).status, 401);

  const e1 = client(); await e1.login(...ACCOUNTS.entry1);
  // 輸入甲負責前半項目；「看你多搖擺」屬於輸入乙
  const other = itemByName('看你多搖擺');
  assert.equal((await e1.call('PUT', `/api/staff/sheets/${elem.id}/${other.id}`, { version: 0, rows: [] })).status, 403);
  assert.equal((await e1.call('GET', `/api/staff/sheets/${elem.id}/${other.id}`)).status, 403);
  // 輸入人員不能發布（就算是自己負責的項目）
  const mine = itemByName('速速配');
  const cur = (await e1.call('GET', `/api/staff/sheets/${elem.id}/${mine.id}`)).data.sheet;
  assert.equal((await e1.call('POST', `/api/staff/sheets/${elem.id}/${mine.id}/publish`, { version: cur.version })).status, 403);
  // 輸入人員不能進入管理 API、不能匯出
  assert.equal((await e1.call('GET', '/api/admin/users')).status, 403);
  assert.equal((await e1.call('GET', '/api/staff/export.csv')).status, 403);
  // 複核人員不能編輯草稿
  const rv = client(); await rv.login(...ACCOUNTS.reviewer);
  assert.equal((await rv.call('PUT', `/api/staff/sheets/${elem.id}/${mine.id}`, { version: cur.version, rows: [] })).status, 403);
  // 缺少 CSRF 標頭的寫入被拒
  const raw = await fetch(`${BASE}/api/staff/sheets/${elem.id}/${mine.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: e1.cookie }, body: '{"version":1,"rows":[]}' });
  assert.equal(raw.status, 403);
});

test('驗收 3：草稿與待複核資料不會出現在公開 API', async () => {
  const e1 = client(); await e1.login(...ACCOUNTS.entry1);
  const item = itemByName('顆星連珠');
  const marker = teamsOf(elem)[5]; // 用一所尚未在任何公布資料中的學校做記號
  const school = boot.schools.find((s) => s.id === marker.school_id);
  const r = await e1.call('PUT', `/api/staff/sheets/${elem.id}/${item.id}`, { version: 0, rows: [{ team_id: marker.id, rank: 1, score: '77.7', remark: 'SECRET-DRAFT' }] });
  assert.equal(r.status, 200);
  let pub = await (await fetch(`${BASE}/api/public/results`)).text();
  assert.ok(!pub.includes('SECRET-DRAFT'));
  assert.ok(!pub.includes('77.7'));
  const s = await e1.call('POST', `/api/staff/sheets/${elem.id}/${item.id}/submit`, { version: r.data.sheet.version });
  assert.equal(s.status, 200);
  assert.equal(s.data.sheet.status, 'pending');
  pub = await (await fetch(`${BASE}/api/public/results`)).text();
  assert.ok(!pub.includes('SECRET-DRAFT'), '待複核資料不得公開');
  const parsed = JSON.parse(pub);
  assert.ok(!parsed.results.some((x) => x.item_id === item.id), '待複核項目不應出現在公開結果');
  // 公開 API 沒有任何暴露草稿的路徑
  assert.equal((await fetch(`${BASE}/api/staff/sheets/${elem.id}/${item.id}`)).status, 401);
  assert.equal((await fetch(`${BASE}/api/staff/export.csv?scope=all`)).status, 401);
  void school;
});

test('驗收 4 & 5：複核發布後另一台裝置（無 cookie）看見新成績；國小 1–8 名、國中僅前 3、精神總錦標', async () => {
  const e1 = client(); await e1.login(...ACCOUNTS.entry1);
  const rv = client(); await rv.login(...ACCOUNTS.reviewer);
  const item = itemByName('階梯球');
  // 國小輸入 9 名（第 9 名不應公開）
  let r = await e1.call('PUT', `/api/staff/sheets/${elem.id}/${item.id}`, { version: 0, rows: rowsFor(elem, 9) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await e1.call('POST', `/api/staff/sheets/${elem.id}/${item.id}/submit`, { version: r.data.sheet.version });
  assert.equal(r.status, 200);
  const before = await (await fetch(`${BASE}/api/public/results`)).json();
  assert.ok(!before.results.some((x) => x.division_id === elem.id && x.item_id === item.id));
  r = await rv.call('POST', `/api/staff/sheets/${elem.id}/${item.id}/publish`, { version: r.data.sheet.version });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.sheet.status, 'published');
  // 另一台裝置：純公開 GET
  const after = await (await fetch(`${BASE}/api/public/results`)).json();
  const pubElem = after.results.find((x) => x.division_id === elem.id && x.item_id === item.id);
  assert.ok(pubElem, '發布後應可公開看到');
  assert.deepEqual(pubElem.rows.map((x) => x.rank), [1, 2, 3, 4, 5, 6, 7, 8], '國小顯示 1–8 名');
  assert.ok(after.updated_at && new Date(after.updated_at) >= new Date(before.updated_at || 0));

  // 國中輸入 5 名，只公開前 3 名
  const e2 = client(); await e2.login(...ACCOUNTS.entry1);
  r = await e2.call('PUT', `/api/staff/sheets/${junior.id}/${item.id}`, { version: 0, rows: rowsFor(junior, 5) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await e2.call('POST', `/api/staff/sheets/${junior.id}/${item.id}/submit`, { version: r.data.sheet.version });
  r = await rv.call('POST', `/api/staff/sheets/${junior.id}/${item.id}/publish`, { version: r.data.sheet.version });
  assert.equal(r.status, 200);
  const pub2 = await (await fetch(`${BASE}/api/public/results`)).json();
  const pubJr = pub2.results.find((x) => x.division_id === junior.id && x.item_id === item.id);
  assert.deepEqual(pubJr.rows.map((x) => x.rank), [1, 2, 3], '國中只顯示前 3 名');

  // 精神總錦標（示範資料已發布國小 8 名）
  const spirit = itemByName('精神總錦標');
  const sp = pub2.results.find((x) => x.division_id === elem.id && x.item_id === spirit.id);
  assert.equal(sp.rows.length, 8);
  assert.equal(spirit.kind, 'spirit');

  // ETag：內容未變回 304
  const first = await fetch(`${BASE}/api/public/results`);
  const etag = first.headers.get('etag');
  const second = await fetch(`${BASE}/api/public/results`, { headers: { 'If-None-Match': etag } });
  assert.equal(second.status, 304);

  // 修訂流程：已公布 → 修訂草稿 → 公開頁維持舊版 → 複核後更新
  const e3 = client(); await e3.login(...ACCOUNTS.entry2);
  const ko = itemByName('沙包投擲賽'); // 屬輸入乙
  r = await e3.call('PUT', `/api/staff/sheets/${junior.id}/${ko.id}`, { version: 0, rows: rowsFor(junior, 3) });
  r = await e3.call('POST', `/api/staff/sheets/${junior.id}/${ko.id}/submit`, { version: r.data.sheet.version });
  r = await rv.call('POST', `/api/staff/sheets/${junior.id}/${ko.id}/publish`, { version: r.data.sheet.version });
  assert.equal(r.status, 200);
  r = await e3.call('POST', `/api/staff/sheets/${junior.id}/${ko.id}/revise`, { version: r.data.sheet.version });
  assert.equal(r.data.sheet.status, 'draft'); assert.equal(r.data.sheet.revision, 2);
  const swapped = rowsFor(junior, 3).map((x) => ({ ...x, rank: 4 - x.rank }));
  r = await e3.call('PUT', `/api/staff/sheets/${junior.id}/${ko.id}`, { version: r.data.sheet.version, rows: swapped });
  assert.equal(r.status, 200);
  let pubKo = (await (await fetch(`${BASE}/api/public/results`)).json()).results.find((x) => x.division_id === junior.id && x.item_id === ko.id);
  assert.equal(pubKo.revision, 1, '修訂草稿期間公開頁仍為第 1 版');
  r = await e3.call('POST', `/api/staff/sheets/${junior.id}/${ko.id}/submit`, { version: r.data.sheet.version });
  r = await rv.call('POST', `/api/staff/sheets/${junior.id}/${ko.id}/publish`, { version: r.data.sheet.version });
  pubKo = (await (await fetch(`${BASE}/api/public/results`)).json()).results.find((x) => x.division_id === junior.id && x.item_id === ko.id);
  assert.equal(pubKo.revision, 2);
  assert.equal(pubKo.rows[0].school, boot.schools.find((s) => s.id === teamsOf(junior)[2].school_id).name);
});

test('驗收 6：同一筆資料的同時修改有衝突保護（不會默默覆蓋）', async () => {
  const a = client(); await a.login(...ACCOUNTS.entry1);
  const b = client(); await b.login(...ACCOUNTS.admin); // 管理者也可編輯同一張表
  const item = itemByName('弓箭標靶');
  const r0 = await a.call('PUT', `/api/staff/sheets/${elem.id}/${item.id}`, { version: 0, rows: rowsFor(elem, 2) });
  assert.equal(r0.status, 200);
  const v = r0.data.sheet.version;
  const [ra, rb] = await Promise.all([
    a.call('PUT', `/api/staff/sheets/${elem.id}/${item.id}`, { version: v, rows: rowsFor(elem, 3) }),
    b.call('PUT', `/api/staff/sheets/${elem.id}/${item.id}`, { version: v, rows: rowsFor(elem, 4) }),
  ]);
  const statuses = [ra.status, rb.status].sort();
  assert.deepEqual(statuses, [200, 409], '一個成功、一個衝突');
  const loser = ra.status === 409 ? ra : rb;
  assert.ok(loser.data.current, '衝突回應附帶伺服器目前版本');
  assert.equal(loser.data.current.version, v + 1);
  // 以舊版本號再送一次仍然被擋
  const again = await a.call('PUT', `/api/staff/sheets/${elem.id}/${item.id}`, { version: v, rows: rowsFor(elem, 1) });
  assert.equal(again.status, 409);
  // 送複核也檢查版本
  assert.equal((await a.call('POST', `/api/staff/sheets/${elem.id}/${item.id}/submit`, { version: v })).status, 409);
});

test('驗收 7：斷線不誤報成功；重連重送同一個 opId 不產生重複資料', async () => {
  const a = client(); await a.login(...ACCOUNTS.entry2);
  const item = itemByName('目標一致');
  const opId = 'op-' + Date.now();
  const body = { version: 0, opId, rows: rowsFor(elem, 2) };
  const r1 = await a.call('PUT', `/api/staff/sheets/${elem.id}/${item.id}`, body);
  assert.equal(r1.status, 200);
  assert.ok(!r1.data.replay);
  // 模擬用戶端沒收到回應而重送（相同 opId、相同舊版本號）
  const r2 = await a.call('PUT', `/api/staff/sheets/${elem.id}/${item.id}`, body);
  assert.equal(r2.status, 200, '重送不應因版本衝突失敗');
  assert.equal(r2.data.replay, true);
  assert.equal(r2.data.sheet.version, r1.data.sheet.version, '版本號不變（沒有第二次寫入）');
  const admin = client(); await admin.login(...ACCOUNTS.admin);
  const log = (await admin.call('GET', `/api/staff/audit?division_id=${elem.id}&item_id=${item.id}`)).data.log;
  assert.equal(log.filter((x) => x.action === 'sheet.save').length, 1, '操作紀錄只有一次儲存');
  const sheet = (await a.call('GET', `/api/staff/sheets/${elem.id}/${item.id}`)).data.sheet;
  assert.equal(sheet.rows.length, 2);
});

test('資料檢查：重複隊伍、名次範圍、未確認並列、數字成績上下限', async () => {
  const a = client(); await a.login(...ACCOUNTS.entry1);
  const admin = client(); await admin.login(...ACCOUNTS.admin);
  const item = itemByName('草地投籃');
  const t = teamsOf(elem);
  let r = await a.call('PUT', `/api/staff/sheets/${elem.id}/${item.id}`, { version: 0, rows: [{ team_id: t[0].id, rank: 1 }, { team_id: t[0].id, rank: 2 }] });
  assert.equal(r.status, 400); assert.match(r.data.errors.join(), /重複/);
  r = await a.call('PUT', `/api/staff/sheets/${elem.id}/${item.id}`, { version: 0, rows: [{ team_id: t[0].id, rank: 0 }] });
  assert.equal(r.status, 400);
  r = await a.call('PUT', `/api/staff/sheets/${elem.id}/${item.id}`, { version: 0, rows: [{ team_id: t[0].id, rank: 1 }, { team_id: t[1].id, rank: 1 }] });
  assert.equal(r.status, 400); assert.match(r.data.errors.join(), /並列/);
  // 確認並列後可儲存
  r = await a.call('PUT', `/api/staff/sheets/${elem.id}/${item.id}`, { version: 0, rows: [{ team_id: t[0].id, rank: 1, tied: true }, { team_id: t[1].id, rank: 1, tied: true }, { team_id: t[2].id, rank: 3 }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // 國中組的隊伍不能填進國小組
  const jr = teamsOf(junior)[0];
  r = await a.call('PUT', `/api/staff/sheets/${elem.id}/${item.id}`, { version: r.data.sheet.version, rows: [{ team_id: jr.id, rank: 1 }] });
  assert.equal(r.status, 400);
  // 管理者把項目設為數字 0–100，超出上限被擋
  assert.equal((await admin.call('PATCH', `/api/admin/items/${item.id}`, { name: item.name, score_kind: 'number', score_unit: '分', score_min: 0, score_max: 100, sort_order: item.sort_order, is_active: true })).status, 200);
  const cur = (await a.call('GET', `/api/staff/sheets/${elem.id}/${item.id}`)).data.sheet;
  r = await a.call('PUT', `/api/staff/sheets/${elem.id}/${item.id}`, { version: cur.version, rows: [{ team_id: t[0].id, rank: 1, score: '101' }] });
  assert.equal(r.status, 400); assert.match(r.data.errors.join(), /上限/);
  r = await a.call('PUT', `/api/staff/sheets/${elem.id}/${item.id}`, { version: cur.version, rows: [{ team_id: t[0].id, rank: 1, score: 'abc' }] });
  assert.equal(r.status, 400);
});

test('管理者邀請同事、指派分工，同事以邀請連結建立密碼後登入', async () => {
  const admin = client(); await admin.login(...ACCOUNTS.admin);
  const r = await admin.call('POST', '/api/admin/invitations', { email: 'new-teacher@example.com', name: '新同事', role: 'entry' });
  assert.equal(r.status, 200);
  const token = r.data.invitation.link.split('/staff/invite/')[1];
  const users = (await admin.call('GET', '/api/admin/users')).data.users;
  const nu = users.find((u) => u.email === 'new-teacher@example.com');
  assert.ok(nu && !nu.has_password);
  const item = itemByName('舀杯高手');
  assert.equal((await admin.call('PUT', `/api/admin/users/${nu.id}/assignments`, { assignments: [{ division_id: junior.id, item_id: item.id }] })).status, 200);
  const anon = client();
  assert.equal((await anon.call('GET', `/api/auth/invite/${token}`)).status, 200);
  assert.equal((await anon.call('POST', `/api/auth/invite/${token}/accept`, { password: 'short' })).status, 400);
  const acc = await anon.call('POST', `/api/auth/invite/${token}/accept`, { password: 'new-teacher-pw1' });
  assert.equal(acc.status, 200);
  assert.equal((await anon.call('GET', `/api/auth/invite/${token}`)).status, 400, '連結只能用一次');
  const c = client();
  assert.equal((await c.login('new-teacher@example.com', 'new-teacher-pw1')).status, 200);
  const b = (await c.call('GET', '/api/staff/bootstrap')).data;
  assert.deepEqual(b.assignments, [{ division_id: junior.id, item_id: item.id }]);
  assert.equal((await c.call('PUT', `/api/staff/sheets/${junior.id}/${item.id}`, { version: 0, rows: rowsFor(junior, 1) })).status, 200);
  assert.equal((await c.call('PUT', `/api/staff/sheets/${elem.id}/${item.id}`, { version: 0, rows: rowsFor(elem, 1) })).status, 403);
  // 停用後無法再操作
  assert.equal((await admin.call('PATCH', `/api/admin/users/${nu.id}`, { is_active: false })).status, 200);
  assert.equal((await c.call('GET', '/api/staff/bootstrap')).status, 401);
});

test('CSV 匯出（複核人員）含已公布資料，公開頁不含學生姓名欄位', async () => {
  const rv = client(); await rv.login(...ACCOUNTS.reviewer);
  const r = await fetch(`${BASE}/api/staff/export.csv?scope=published`, { headers: { Cookie: rv.cookie } });
  assert.equal(r.status, 200);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM 讓 Excel 正確顯示中文');
  const csv = buf.toString('utf8').slice(1);
  assert.ok(csv.startsWith('組別,項目,名次'));
  assert.ok(csv.includes('階梯球'));
  const pub = await (await fetch(`${BASE}/api/public/results`)).json();
  for (const res of pub.results) for (const row of res.rows) assert.deepEqual(Object.keys(row).sort(), ['label', 'rank', 'remark', 'school', 'score', 'tied']);
});
