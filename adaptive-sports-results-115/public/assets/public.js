import { renderResultsTable, renderSpiritList, esc, fmtTime, rocDate, FLAG_SVG } from './results-table.js';

const POLL_MS = 20000;
const $ = (s) => document.querySelector(s);

const state = {
  data: null,
  etag: null,
  divisionId: null,
  itemId: '',
  query: '',
  lastOk: null,
  failing: false,
};

function saveQuery() {
  try {
    const p = new URLSearchParams();
    if (state.divisionId) p.set('d', state.divisionId);
    if (state.itemId) p.set('i', state.itemId);
    if (state.query) p.set('q', state.query);
    history.replaceState(null, '', p.toString() ? `?${p}` : location.pathname);
  } catch { /* ignore */ }
}

function restoreQuery() {
  const p = new URLSearchParams(location.search);
  if (p.get('d')) state.divisionId = Number(p.get('d'));
  if (p.get('i')) state.itemId = p.get('i');
  if (p.get('q')) state.query = p.get('q');
}

async function fetchResults() {
  const headers = {};
  if (state.etag) headers['If-None-Match'] = state.etag;
  let res;
  try {
    res = await fetch('/api/public/results', { headers, cache: 'no-store' });
  } catch {
    return setFailure('無法連線到伺服器');
  }
  if (res.status === 304) return setOk();
  if (!res.ok) return setFailure(`伺服器回應 ${res.status}`);
  state.etag = res.headers.get('ETag');
  state.data = await res.json();
  setOk();
  renderAll();
}

function setOk() {
  state.lastOk = new Date();
  state.failing = false;
  $('#error-banner').hidden = true;
  renderStatus();
}

function setFailure(msg) {
  state.failing = true;
  const b = $('#error-banner');
  b.hidden = false;
  b.textContent = `更新失敗（${msg}）。${state.lastOk ? `目前顯示的是 ${fmtTime(state.lastOk)} 取得的資料，` : ''}系統將自動重試，或請重新整理頁面。`;
  renderStatus();
}

function renderStatus() {
  const el = $('#update-status');
  const updated = state.data?.updated_at;
  if (state.failing) {
    el.innerHTML = `<span class="dot err"></span>更新失敗`;
  } else if (updated) {
    el.innerHTML = `<span class="dot"></span>最後公布：${fmtTime(updated)}　<span class="help">每 20 秒自動更新</span>`;
  } else {
    el.innerHTML = `<span class="dot"></span>目前尚無已公布成績　<span class="help">每 20 秒自動更新</span>`;
  }
}

function currentDivision() {
  return state.data?.divisions.find((d) => d.id === state.divisionId) || state.data?.divisions[0];
}

function renderAll() {
  const { event, divisions } = state.data;
  if (!event) {
    $('#results').innerHTML = '<div class="section"><p class="empty"><strong>成績尚未公告</strong></p></div>';
    return;
  }
  document.title = `成績公告｜${event.name}`;
  $('#event-name').textContent = event.name;
  $('#event-meta').innerHTML = [
    event.event_date ? `<span><b>日期</b>${rocDate(event.event_date)}</span>` : '',
    event.venue ? `<span><b>場地</b>${esc(event.venue)}</span>` : '',
    event.organizer ? `<span><b>承辦</b>${esc(event.organizer)}</span>` : '',
  ].join('');
  if (event.organizer) $('#footer-org').textContent = `承辦單位：${event.organizer}`;

  if (!divisions.find((d) => d.id === state.divisionId)) state.divisionId = divisions[0]?.id ?? null;
  $('#division-seg').innerHTML = divisions.map((d) =>
    `<button type="button" data-id="${d.id}" aria-pressed="${d.id === state.divisionId}">${esc(d.name)}</button>`).join('');

  const sel = $('#item-select');
  const items = state.data.items;
  const opts = ['<option value="">全部項目</option>', ...items.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`)];
  if (sel.innerHTML !== opts.join('')) sel.innerHTML = opts.join('');
  sel.value = state.itemId;
  $('#school-search').value = state.query;

  renderResults();
}

function renderResults() {
  const d = currentDivision();
  if (!d) return;
  const { items, results } = state.data;
  const q = state.query.trim();
  $('#award-rule').textContent = `${d.name}：核定前 ${d.award_places} 名（前三名頒獎牌、獎狀及獎品${d.award_places > 3 ? `，第 4–${d.award_places} 名頒獎狀` : ''}），精神總錦標前 ${d.spirit_places} 名頒錦旗`;
  $('#print-note').textContent = `${state.data.event.name}｜${d.name}｜列印時間 ${fmtTime(new Date())}`;

  const blocks = [];
  const visibleItems = items.filter((i) => !state.itemId || String(i.id) === String(state.itemId));
  let anyMatch = false;
  for (const item of visibleItems) {
    const r = results.find((x) => x.division_id === d.id && x.item_id === item.id);
    let rows = r?.rows || [];
    if (q) rows = rows.filter((x) => x.school.includes(q) || (x.label || '').includes(q));
    if (q && !rows.length) continue;
    anyMatch = true;
    const meta = r ? `<span class="meta">公布於 ${fmtTime(r.published_at)}${r.revision > 1 ? `・修訂第 ${r.revision} 版` : ''}</span>` : '';
    if (item.kind === 'spirit') {
      blocks.push(`<section class="section spirit" aria-labelledby="item-${item.id}">
        <div class="section-head"><h2 id="item-${item.id}">${FLAG_SVG}${esc(item.name)}<span class="visually-hidden">（${esc(d.name)}）</span></h2><span class="tag tag-navy">前 ${d.spirit_places} 名頒錦旗</span>${meta}</div>
        ${renderSpiritList({ rows, division: d, query: q })}
      </section>`);
    } else {
      const kind = item.kind === 'knockout' ? '<span class="tag">單淘汰賽</span>' : '';
      blocks.push(`<section class="section" aria-labelledby="item-${item.id}">
        <div class="section-head"><h2 id="item-${item.id}">${esc(item.name)}</h2>${kind}${meta}</div>
        ${renderResultsTable({ rows, division: d, item, query: q })}
      </section>`);
    }
  }
  if (!anyMatch) {
    blocks.push(`<div class="section"><p class="empty">${q ? `找不到包含「${esc(q)}」的已公布成績。` : '<strong>成績尚未公告</strong>'}</p></div>`);
  }
  $('#results').innerHTML = blocks.join('');
}

// ---------- 事件 ----------
$('#division-seg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-id]');
  if (!b) return;
  state.divisionId = Number(b.dataset.id);
  $('#division-seg').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  saveQuery();
  renderResults();
});
$('#item-select').addEventListener('change', (e) => { state.itemId = e.target.value; saveQuery(); renderResults(); });
$('#school-search').addEventListener('input', (e) => { state.query = e.target.value; saveQuery(); renderResults(); });
$('#btn-print').addEventListener('click', () => window.print());
$('#btn-qr').addEventListener('click', async () => {
  try {
    const r = await fetch('/api/public/url').then((x) => x.json());
    $('#qr-url').textContent = r.url;
  } catch { $('#qr-url').textContent = location.origin; }
  $('#qr-dialog').showModal();
});
$('#btn-qr-close').addEventListener('click', () => $('#qr-dialog').close());
$('#btn-copy-url').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#qr-url').textContent); $('#btn-copy-url').textContent = '已複製'; } catch { /* ignore */ }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchResults(); });
window.addEventListener('online', fetchResults);

restoreQuery();
fetchResults();
setInterval(fetchResults, POLL_MS);
