/* 成績公告頁。資料來源：Google 試算表「競賽紀錄總表（成績登打）」，格式與紙本紀錄總表相同：
 * 每個組別一個區塊，列＝項目，欄＝第一名（學校、成績）… 最右欄「公布」打 V 才顯示。 */
import { renderResultsTable, renderSpiritList, esc, fmtTime, FLAG_SVG } from './results-table.js';
import { API_URL as CONFIG_API } from './config.js';

const SHEET_ID = '1fmH2pcOlCmnwuMq2v0_FGvCwq513Dyk3hflEJ8oixMY';
const SHEET_CSV = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;
const POLL_MS = 20000;
const DIVISIONS = [
  { id: 1, code: 'elementary', name: '國小組', award_places: 8, spirit_places: 8 },
  { id: 2, code: 'junior', name: '國中組', award_places: 3, spirit_places: 3 },
];
const KNOCKOUT = ['沙包投擲賽'];
const $ = (s) => document.querySelector(s);

const state = { data: null, lastText: null, changedAt: null, divisionId: 1, itemId: '', query: '', view: 'list', lastOk: null, failing: false };
try { state.view = localStorage.getItem('asr115:view') || 'list'; } catch { /* ignore */ }
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
const srcOverride = isLocal ? new URLSearchParams(location.search).get('src') : null;
const API_URL = (isLocal && new URLSearchParams(location.search).get('api')) || CONFIG_API;

// ---------- CSV ----------
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((c) => String(c ?? '').trim()));
}

const truthy = (v) => /^(v|✓|✔|true|是|1|o|公布|已公布|y|ok)$/i.test(String(v || '').trim());
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function rankOf(label) {
  const m = String(label).match(/第\s*([一二三四五六七八九十\d]+)\s*名/);
  if (!m) return null;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : (CN[m[1]] ?? null);
}
const splitSchools = (s) => String(s).split(/[、，,／/;；]+/).map((x) => x.trim()).filter(Boolean);

/** 解析紀錄總表格式。 */
function buildData(text) {
  const rows = parseCsv(text);
  const items = [];
  const itemByName = new Map();
  const results = [];
  let announcement = '';
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    const head = r[0] || '';
    if (head === '公告') {
      const pubIdx = r.length - 1;
      if (r[1] && truthy(r[pubIdx]) && pubIdx > 1) announcement = r[1];
      i++; continue;
    }
    const d = DIVISIONS.find((x) => x.name === head);
    if (!d) { i++; continue; }
    // 名次欄位置
    const rankCols = [];
    let pubCol = -1;
    r.forEach((cell, idx) => { const k = rankOf(cell); if (k) rankCols.push({ rank: k, col: idx }); if (cell === '公布') pubCol = idx; });
    i++;
    if (rows[i] && rows[i][0] === '項目') i++; // 子標題列
    for (; i < rows.length; i++) {
      const row = rows[i];
      const name = row[0] || '';
      if (!name || name === '說明' || DIVISIONS.some((x) => x.name === name) || name === '公告') break;
      if (!itemByName.has(name)) {
        const it = { id: items.length + 1, name, kind: name === '精神總錦標' ? 'spirit' : KNOCKOUT.includes(name) ? 'knockout' : 'ranked', score_unit: null };
        items.push(it); itemByName.set(name, it);
      }
      const it = itemByName.get(name);
      const pub = pubCol >= 0 ? truthy(row[pubCol]) : false;
      const list = [];
      for (const { rank, col } of rankCols) {
        const schools = splitSchools(row[col] || '');
        const score = (row[col + 1] || '').trim() || null;
        for (const school of schools) list.push({ rank, tied: schools.length > 1, school, label: '', score, remark: null });
      }
      if (pub && list.length) results.push({ division_id: d.id, item_id: it.id, revision: 1, published_at: null, rows: list.sort((a, b) => a.rank - b.rank) });
    }
  }
  items.sort((a, b) => (a.kind === 'spirit') - (b.kind === 'spirit'));
  return { announcement, divisions: DIVISIONS, items, results };
}

/** 後台（Apps Script）回傳的 JSON 整理成頁面結構。 */
function buildFromApi(api) {
  const items = api.items.map((name, i) => ({ id: i + 1, name, kind: name === '精神總錦標' ? 'spirit' : KNOCKOUT.includes(name) ? 'knockout' : 'ranked', score_unit: null }));
  const results = [];
  for (const d of DIVISIONS) {
    for (const it of items) {
      const rows = api.results.filter((r) => r.division === d.name && r.item === it.name && r.published);
      if (!rows.length) continue;
      const count = {};
      rows.forEach((r) => { count[r.rank] = (count[r.rank] || 0) + 1; });
      results.push({ division_id: d.id, item_id: it.id, revision: 1, published_at: null,
        rows: rows.map((r) => ({ rank: Number(r.rank), tied: count[r.rank] > 1, school: r.school, label: '', score: r.score || null, remark: null })).sort((a, b) => a.rank - b.rank) });
    }
  }
  return { announcement: api.announcement || '', divisions: DIVISIONS, items, results, updated_at: api.updated_at || '' };
}

// ---------- 讀取 ----------
async function fetchResults() {
  if (API_URL && !srcOverride) return fetchFromApi();
  let res;
  try { res = await fetch(srcOverride || `${SHEET_CSV}&_=${Date.now()}`, { cache: 'no-store' }); }
  catch { return setFailure('無法連線'); }
  if (!res.ok) return setFailure(`回應 ${res.status}`);
  const text = await res.text();
  if (text.trim().startsWith('<')) return setFailure('試算表尚未開放「知道連結的任何人可檢視」');
  if (text !== state.lastText) {
    state.lastText = text;
    state.changedAt = new Date();
    state.data = buildData(text);
    renderAll();
  }
  setOk();
}
async function fetchFromApi() {
  let res;
  try { res = await fetch(`${API_URL}${API_URL.includes('?') ? '&' : '?'}action=public&_=${Date.now()}`, { redirect: 'follow' }); }
  catch { return setFailure('無法連線'); }
  if (!res.ok) return setFailure(`回應 ${res.status}`);
  const text = await res.text();
  let api;
  try { api = JSON.parse(text); } catch { return setFailure('後台回應格式錯誤'); }
  if (!api.ok) return setFailure(api.error || '後台錯誤');
  const key = JSON.stringify([api.results, api.announcement]);
  if (key !== state.lastText) {
    state.lastText = key;
    state.changedAt = api.updated_at ? new Date(api.updated_at.replace(' ', 'T') + '+08:00') : new Date();
    if (Number.isNaN(state.changedAt.getTime())) state.changedAt = new Date();
    state.data = buildFromApi(api);
    renderAll();
  }
  setOk();
}
function setOk() { state.lastOk = new Date(); state.failing = false; $('#error-banner').hidden = true; renderStatus(); }
function setFailure(msg) {
  state.failing = true;
  const b = $('#error-banner');
  b.hidden = false;
  b.textContent = `更新失敗（${msg}）。${state.lastOk ? `目前顯示的是 ${fmtTime(state.lastOk)} 取得的資料，` : ''}系統將自動重試，或請重新整理頁面。`;
  renderStatus();
}
function renderStatus() {
  const el = $('#update-status');
  if (state.failing) el.innerHTML = '<span class="dot err"></span>更新失敗';
  else if (state.data?.results.length) el.innerHTML = `<span class="dot"></span>最後更新：${fmtTime(state.changedAt)}　<span class="help">每 20 秒自動檢查</span>`;
  else el.innerHTML = '<span class="dot"></span>目前尚無已公布成績　<span class="help">每 20 秒自動檢查</span>';
}

// ---------- 渲染 ----------
const currentDivision = () => DIVISIONS.find((d) => d.id === state.divisionId) || DIVISIONS[0];

function renderAll() {
  const { announcement, items, results } = state.data;
  $('#division-seg').innerHTML = DIVISIONS.map((d) => `<button type="button" data-id="${d.id}" aria-pressed="${d.id === state.divisionId}">${esc(d.name)}</button>`).join('');
  const sel = $('#item-select');
  const opts = ['<option value="">全部項目</option>', ...items.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`)].join('');
  if (sel.innerHTML !== opts) sel.innerHTML = opts;
  sel.value = state.itemId;
  $('#school-search').value = state.query;
  $('#hero-stats').innerHTML = `<span><b>${results.length}</b> / ${items.length * DIVISIONS.length} 項已公布</span>${state.changedAt ? `<span>最後更新 <b>${fmtTime(state.changedAt)}</b></span>` : ''}`;
  const an = $('#announce');
  if (announcement) { an.hidden = false; $('#announce-text').textContent = announcement; } else an.hidden = true;
  renderResults();
}

function visibleItems() {
  return state.data.items.filter((i) => !state.itemId || String(i.id) === String(state.itemId));
}

function renderResults() {
  if (!state.data) return;
  const d = currentDivision();
  const q = state.query.trim();
  $('#award-rule').textContent = `${d.name}：核定前 ${d.award_places} 名（前三名頒獎牌、獎狀及獎品${d.award_places > 3 ? `，第 4–${d.award_places} 名頒獎狀` : ''}），精神總錦標前 ${d.spirit_places} 名頒錦旗`;
  $('#print-note').textContent = `115年度新竹縣第二十三屆特殊教育學生適應體育趣味運動競賽｜${d.name}｜列印時間 ${fmtTime(new Date())}`;
  $('#view-seg').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
  $('#results').innerHTML = state.view === 'grid' ? renderGrid(d, q) : renderList(d, q);
}

function rowsFor(d, item, q) {
  const r = state.data.results.find((x) => x.division_id === d.id && x.item_id === item.id);
  let rows = r?.rows || [];
  if (q) rows = rows.filter((x) => x.school.includes(q));
  return { rows, published: Boolean(r) };
}

function renderList(d, q) {
  const blocks = [];
  let any = false;
  for (const item of visibleItems()) {
    const { rows } = rowsFor(d, item, q);
    if (q && !rows.length) continue;
    any = true;
    if (item.kind === 'spirit') {
      blocks.push(`<section class="section spirit" aria-labelledby="item-${item.id}">
        <div class="section-head"><h2 id="item-${item.id}">${FLAG_SVG}${esc(item.name)}<span class="visually-hidden">（${esc(d.name)}）</span></h2><span class="tag tag-navy">前 ${d.spirit_places} 名頒錦旗</span></div>
        ${renderSpiritList({ rows, division: d, query: q })}</section>`);
    } else {
      blocks.push(`<section class="section" aria-labelledby="item-${item.id}">
        <div class="section-head"><h2 id="item-${item.id}">${esc(item.name)}</h2>${item.kind === 'knockout' ? '<span class="tag">單淘汰賽</span>' : ''}</div>
        ${renderResultsTable({ rows, division: d, item, query: q })}</section>`);
    }
  }
  if (!any) blocks.push(`<div class="section"><p class="empty">${q ? `找不到包含「${esc(q)}」的已公布成績。` : '<strong>成績尚未公告</strong>'}</p></div>`);
  return blocks.join('');
}

/** 總表：與紙本「競賽紀錄總表」相同的矩陣（列＝項目，欄＝名次）。 */
function renderGrid(d, q) {
  const n = d.award_places;
  const items = visibleItems();
  const head = Array.from({ length: n }, (_, i) => `<th scope="col" class="g-rank r${i + 1 <= 3 ? i + 1 : 'n'}">第${['一', '二', '三', '四', '五', '六', '七', '八'][i]}名</th>`).join('');
  const body = items.map((item) => {
    const { rows, published } = rowsFor(d, item, q);
    const limit = item.kind === 'spirit' ? d.spirit_places : d.award_places;
    const cells = Array.from({ length: n }, (_, i) => {
      const rank = i + 1;
      if (rank > limit) return '<td class="g-na">—</td>';
      const hits = rows.filter((x) => x.rank === rank);
      if (!hits.length) return `<td class="g-cell">${published ? '' : '<span class="g-pending">未公告</span>'}</td>`;
      return `<td class="g-cell">${hits.map((x) => `<div class="g-school">${q && x.school.includes(q) ? `<mark>${esc(x.school)}</mark>` : esc(x.school)}${x.tied ? '<span class="tag">並列</span>' : ''}</div>${x.score ? `<div class="g-score">${esc(x.score)}</div>` : ''}`).join('')}</td>`;
    }).join('');
    return `<tr class="${item.kind === 'spirit' ? 'g-spirit' : ''}"><th scope="row">${item.kind === 'spirit' ? FLAG_SVG : ''}${esc(item.name)}</th>${cells}</tr>`;
  }).join('');
  return `<section class="section" aria-label="${esc(d.name)}競賽紀錄總表">
    <div class="section-head"><h2>${esc(d.name)}　競賽紀錄總表</h2><span class="meta">只顯示已公布項目；前三名以金、銀、銅標示</span></div>
    <div class="table-wrap"><table class="grid"><thead><tr><th scope="col" class="g-item">項目</th>${head}</tr></thead><tbody>${body}</tbody></table></div>
  </section>`;
}

// ---------- 事件 ----------
$('#division-seg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-id]');
  if (!b) return;
  state.divisionId = Number(b.dataset.id);
  $('#division-seg').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  renderResults();
});
$('#view-seg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  state.view = b.dataset.view;
  try { localStorage.setItem('asr115:view', state.view); } catch { /* ignore */ }
  renderResults();
});
$('#item-select').addEventListener('change', (e) => { state.itemId = e.target.value; renderResults(); });
$('#school-search').addEventListener('input', (e) => { state.query = e.target.value; renderResults(); });
$('#btn-print').addEventListener('click', () => window.print());
$('#btn-qr').addEventListener('click', () => $('#qr-dialog').showModal());
$('#btn-qr-close').addEventListener('click', () => $('#qr-dialog').close());
$('#btn-copy-url').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#qr-url').textContent); $('#btn-copy-url').textContent = '已複製'; } catch { /* ignore */ }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchResults(); });
window.addEventListener('online', fetchResults);

fetchResults();
setInterval(fetchResults, POLL_MS);
