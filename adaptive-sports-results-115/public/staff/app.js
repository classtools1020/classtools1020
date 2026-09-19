/* 工作人員介面：登入、成績輸入、複核發布、管理。 */
import { renderResultsTable, renderSpiritList, esc, fmtTime } from '../assets/results-table.js';

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const STATUS = { draft: '草稿', pending: '待複核', published: '已公布' };
const ROLE = { admin: '管理者', entry: '成績輸入', reviewer: '複核人員' };

// ---------- API ----------
class ApiError extends Error {
  constructor(status, body) { super(body?.error || `HTTP ${status}`); this.status = status; this.body = body || {}; }
}
class NetworkError extends Error {}

async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'asr' },
      body: body == null ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new NetworkError('無法連線到伺服器');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text.slice(0, 200) }; }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// ---------- 狀態 ----------
const state = { user: null, boot: null };

function bootReload() {
  return api('GET', '/api/staff/bootstrap').then((b) => { state.boot = b; state.user = b.user; return b; });
}

const B = {
  division: (id) => state.boot.divisions.find((d) => d.id === Number(id)),
  item: (id) => state.boot.items.find((i) => i.id === Number(id)),
  school: (id) => state.boot.schools.find((s) => s.id === Number(id)),
  teamsOf: (divisionId) => state.boot.teams
    .filter((t) => t.division_id === Number(divisionId) && t.is_active)
    .map((t) => ({ ...t, school: B.school(t.school_id)?.name || '?' }))
    .sort((a, b) => (B.school(a.school_id)?.sort_order ?? 0) - (B.school(b.school_id)?.sort_order ?? 0) || a.school.localeCompare(b.school, 'zh-Hant')),
  teamName: (t) => `${t.school}${t.label ? `（${t.label}）` : ''}`,
  sheetOf: (d, i) => state.boot.sheets.find((s) => s.division_id === Number(d) && s.item_id === Number(i)),
  canAccess: (d, i) => state.user.role === 'admin' || state.boot.assignments.some((a) => a.division_id === Number(d) && a.item_id === Number(i)),
  mySheets: () => {
    const list = [];
    for (const d of state.boot.divisions) {
      for (const it of state.boot.items.filter((x) => x.is_active)) {
        if (B.canAccess(d.id, it.id)) list.push({ division: d, item: it, sheet: B.sheetOf(d.id, it.id) });
      }
    }
    return list;
  },
};

// ---------- 小工具 ----------
function tag(status) {
  const cls = { draft: 'status-draft', pending: 'status-pending', published: 'status-published' }[status] || 'status-none';
  return `<span class="tag ${cls}">${status ? STATUS[status] : '未輸入'}</span>`;
}
function toast(msg, kind = 'ok') {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.className = `banner banner-${kind}`;
  t.style.cssText = 'position:fixed;left:16px;right:16px;bottom:80px;z-index:20;max-width:520px;margin:0 auto;box-shadow:0 4px 16px rgba(0,0,0,.15)';
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
}
function dialog(html, wire) {
  const dlg = $('#dlg');
  $('#dlg-body').innerHTML = html;
  wire?.(dlg);
  dlg.showModal();
  return dlg;
}
function confirmDialog(title, text, okLabel = '確定', danger = false) {
  return new Promise((resolve) => {
    const dlg = dialog(`<h2>${esc(title)}</h2><p>${text}</p>
      <div class="dialog-actions"><button class="btn" data-x="cancel">取消</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-x="ok">${esc(okLabel)}</button></div>`,
    (d) => {
      d.querySelector('[data-x=cancel]').onclick = () => { d.close(); resolve(false); };
      d.querySelector('[data-x=ok]').onclick = () => { d.close(); resolve(true); };
    });
    dlg.addEventListener('close', () => resolve(false), { once: true });
  });
}
function errText(e) {
  if (e instanceof NetworkError) return '無法連線到伺服器，請確認網路';
  if (e instanceof ApiError) return [e.message, ...(e.body.errors || [])].join('；');
  return e?.message || String(e);
}
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const draftKey = (d, i) => `asr:draft:${state.user.id}:${d}:${i}`;
function readDraft(d, i) { try { return JSON.parse(localStorage.getItem(draftKey(d, i)) || 'null'); } catch { return null; } }
function writeDraft(d, i, v) { try { if (v) localStorage.setItem(draftKey(d, i), JSON.stringify(v)); else localStorage.removeItem(draftKey(d, i)); } catch { /* ignore */ } }

// ---------- 路由 ----------
function nav() {
  const n = $('#appnav');
  if (!state.user) { n.hidden = true; return; }
  const links = [['#/', '我的項目']];
  if (state.user.role !== 'entry') links.push(['#/review', '待複核']);
  if (state.user.role === 'admin') links.push(['#/admin/users', '人員'], ['#/admin/schools', '學校'], ['#/admin/items', '項目'], ['#/admin/event', '活動']);
  if (state.user.role !== 'entry') links.push(['#/audit', '紀錄']);
  links.push(['#/account', '帳號']);
  const cur = location.hash || '#/';
  n.querySelector('.wrap').innerHTML = links.map(([h, t]) =>
    `<a href="${h}" ${cur === h || (h !== '#/' && cur.startsWith(h)) ? 'aria-current="page"' : ''}>${t}</a>`).join('');
  n.hidden = false;
  $('#top-actions').innerHTML = `<span class="help" style="color:#b9c8e0;align-self:center">${esc(state.user.name)}・${ROLE[state.user.role]}</span>
    <a class="btn btn-sm" href="/" target="_blank" rel="noopener">公開頁</a><button class="btn btn-sm" id="btn-logout">登出</button>`;
  $('#btn-logout').onclick = async () => { await api('POST', '/api/auth/logout'); state.user = null; location.hash = '#/login'; route(); };
}

let currentTeardown = null;
async function route() {
  currentTeardown?.(); currentTeardown = null;
  $('#savebar').hidden = true;
  const path = location.pathname;
  const inviteMatch = path.match(/^\/staff\/invite\/([A-Za-z0-9_-]+)/);
  if (inviteMatch) return renderInvite(inviteMatch[1]);
  if (path !== '/staff' && path !== '/staff/') history.replaceState(null, '', '/staff' + location.hash);

  if (!state.user) {
    try { const me = await api('GET', '/api/auth/me'); state.user = me.user; } catch { /* offline */ }
  }
  if (!state.user) { nav(); return renderLogin(); }
  if (!state.boot) {
    try { await bootReload(); } catch (e) { view.innerHTML = `<div class="banner banner-err">${esc(errText(e))}</div>`; return; }
  }
  nav();
  $('#event-name').textContent = state.boot.event.name;
  const hash = location.hash || '#/';
  const m = (re) => hash.match(re);
  let r;
  if (hash === '#/' || hash === '#/login') return renderHome();
  if ((r = m(/^#\/sheet\/(\d+)\/(\d+)$/))) return renderSheet(Number(r[1]), Number(r[2]));
  if (hash === '#/review') return renderReview();
  if (hash === '#/admin/users') return renderUsers();
  if (hash === '#/admin/schools') return renderSchools();
  if (hash === '#/admin/items') return renderItems();
  if (hash === '#/admin/event') return renderEvent();
  if (hash === '#/audit') return renderAudit();
  if (hash === '#/account') return renderAccount();
  renderHome();
}
window.addEventListener('hashchange', route);

// ---------- 登入 / 邀請 ----------
function renderLogin() {
  view.innerHTML = `<div class="card login"><h2>工作人員登入</h2>
    <form class="form" id="login-form">
      <div class="field"><label for="email">電子郵件</label><input class="input" id="email" name="email" type="email" autocomplete="username" required inputmode="email"></div>
      <div class="field"><label for="password">密碼</label><input class="input" id="password" name="password" type="password" autocomplete="current-password" required></div>
      <div id="login-err" class="banner banner-err" hidden role="alert"></div>
      <button class="btn btn-primary btn-block" type="submit">登入</button>
      <p class="help">帳號由管理者以邀請連結建立。忘記密碼請請管理者重新產生邀請連結。</p>
    </form></div>`;
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await api('POST', '/api/auth/login', { email: $('#email').value, password: $('#password').value });
      state.boot = null; state.user = null;
      location.hash = '#/';
      await route();
    } catch (err) {
      $('#login-err').hidden = false; $('#login-err').textContent = errText(err);
    } finally { btn.disabled = false; }
  };
}

async function renderInvite(token) {
  view.innerHTML = '<div class="card login"><p>讀取邀請中…</p></div>';
  let inv;
  try { inv = (await api('GET', `/api/auth/invite/${token}`)).invitation; } catch (e) {
    view.innerHTML = `<div class="card login"><h2>邀請連結無法使用</h2><p>${esc(errText(e))}</p><p style="margin-top:12px"><a class="btn" href="/staff">前往登入</a></p></div>`;
    return;
  }
  view.innerHTML = `<div class="card login"><h2>建立您的帳號</h2>
    <p class="help">邀請對象：${esc(inv.name)}（${esc(inv.email)}）・角色：${ROLE[inv.role]}</p>
    <form class="form" id="inv-form" style="margin-top:12px">
      <div class="field"><label for="name">顯示名稱</label><input class="input" id="name" value="${esc(inv.name)}" maxlength="40" required></div>
      <div class="field"><label for="pw">設定密碼（至少 8 個字元）</label><input class="input" id="pw" type="password" autocomplete="new-password" minlength="8" required></div>
      <div class="field"><label for="pw2">再輸入一次密碼</label><input class="input" id="pw2" type="password" autocomplete="new-password" minlength="8" required></div>
      <div id="inv-err" class="banner banner-err" hidden role="alert"></div>
      <button class="btn btn-primary btn-block" type="submit">建立帳號並登入</button>
    </form></div>`;
  $('#inv-form').onsubmit = async (e) => {
    e.preventDefault();
    if ($('#pw').value !== $('#pw2').value) { $('#inv-err').hidden = false; $('#inv-err').textContent = '兩次密碼不一致'; return; }
    try {
      await api('POST', `/api/auth/invite/${token}/accept`, { name: $('#name').value, password: $('#pw').value });
      state.user = null; state.boot = null;
      history.replaceState(null, '', '/staff#/');
      await route();
    } catch (err) { $('#inv-err').hidden = false; $('#inv-err').textContent = errText(err); }
  };
}

// ---------- 首頁：我的項目 ----------
async function renderHome() {
  try { await bootReload(); } catch (e) { toast(errText(e), 'err'); }
  nav();
  const mine = B.mySheets();
  const pending = mine.filter((x) => x.sheet?.status === 'pending');
  const byDiv = state.boot.divisions.map((d) => ({ d, list: mine.filter((x) => x.division.id === d.id) })).filter((g) => g.list.length);
  const li = (x) => {
    const local = readDraft(x.division.id, x.item.id);
    return `<li>
      <a class="title" href="#/sheet/${x.division.id}/${x.item.id}">${esc(x.item.name)}${x.item.kind === 'knockout' ? ' <span class="tag">單淘汰</span>' : ''}
        <span class="sub">${x.sheet ? `${x.sheet.row_count} 筆・${esc(x.sheet.updated_by_name || '')} ${fmtTime(x.sheet.updated_at)}` : '尚未輸入'}${local?.pending ? '・<b style="color:var(--warn)">有未同步的本機草稿</b>' : ''}${x.sheet?.revision > 1 ? `・修訂第 ${x.sheet.revision} 版` : ''}</span></a>
      ${tag(x.sheet?.status)}
    </li>`;
  };
  view.innerHTML = `
    ${state.user.role !== 'entry' && pending.length ? `<div class="banner banner-warn">有 ${pending.length} 份成績表待複核。<a class="btn btn-sm" href="#/review">前往複核</a></div>` : ''}
    ${!mine.length ? '<div class="card"><h2>尚未指派項目</h2><p>請請管理者在「人員」頁面為您指派負責的組別與項目。</p></div>' : ''}
    ${byDiv.map((g) => `<div class="card"><h2>${esc(g.d.name)}</h2><ul class="sheet-list">${g.list.map(li).join('')}</ul></div>`).join('')}
    <div class="card"><h2>操作流程</h2><p class="help">選項目 → 選學校／隊伍、填名次與成績 → 儲存 → 送複核。複核人員確認後發布，公開頁即自動更新。名次以裁判核定為準；並列名次請勾選「並列」。</p></div>`;
}

// ---------- 成績表 ----------
async function renderSheet(d, i) {
  const division = B.division(d);
  const item = B.item(i);
  if (!division || !item || !B.canAccess(d, i)) { view.innerHTML = '<div class="banner banner-err">您未被指派此組別／項目。</div>'; return; }
  view.innerHTML = '<div class="card"><p>載入中…</p></div>';
  let sheet = null;
  let loadErr = null;
  try { sheet = (await api('GET', `/api/staff/sheets/${d}/${i}`)).sheet; } catch (e) { loadErr = e; }
  const local = readDraft(d, i);
  if (loadErr && !local) { view.innerHTML = `<div class="banner banner-err">${esc(errText(loadErr))} <a class="btn btn-sm" href="#/sheet/${d}/${i}">重試</a></div>`; return; }

  const canEdit = ['entry', 'admin'].includes(state.user.role);
  const canReview = ['reviewer', 'admin'].includes(state.user.role);
  const teams = B.teamsOf(d);
  const ed = {
    baseVersion: sheet ? sheet.version : 0,
    status: sheet ? sheet.status : null,
    rows: (sheet?.rows || []).map((r) => ({ team_id: r.team_id, rank: r.rank, tied: r.tied, score: r.score ?? '', remark: r.remark ?? '' })),
    note: sheet?.note ?? '',
    opId: null,
    dirty: false,
    saveState: sheet ? { kind: 'saved', at: sheet.updated_at, who: sheet.updated_by_name } : { kind: 'idle' },
  };
  // 有本機未同步草稿：優先載入本機內容
  if (local?.pending && canEdit && (!sheet || sheet.status === 'draft' || !sheet)) {
    ed.rows = local.rows; ed.note = local.note; ed.opId = local.opId; ed.dirty = true;
    ed.baseVersion = local.baseVersion;
    ed.saveState = { kind: 'offline' };
  }

  const editable = canEdit && (ed.status === null || ed.status === 'draft');

  function rowsHtml() {
    const used = ed.rows.map((r) => r.team_id);
    const rankCount = {};
    ed.rows.forEach((r) => { rankCount[r.rank] = (rankCount[r.rank] || 0) + 1; });
    return ed.rows.map((r, idx) => {
      const dup = rankCount[r.rank] > 1;
      return `<div class="row-edit ${dup && !r.tied ? 'dup' : ''}" data-idx="${idx}">
        <div class="field f-rank"><label>名次</label><input class="input rank-input" type="number" min="1" max="99" inputmode="numeric" value="${r.rank}" data-f="rank" ${editable ? '' : 'disabled'} aria-label="第 ${idx + 1} 列名次"></div>
        <div class="field f-team"><label>學校／隊伍</label><select class="input" data-f="team_id" ${editable ? '' : 'disabled'} aria-label="第 ${idx + 1} 列學校">
          <option value="">— 請選擇 —</option>
          ${teams.map((t) => `<option value="${t.id}" ${t.id === r.team_id ? 'selected' : ''} ${used.includes(t.id) && t.id !== r.team_id ? 'disabled' : ''}>${esc(B.teamName(t))}</option>`).join('')}
        </select></div>
        <div class="f-score">
          <div class="field"><label>成績${item.score_unit ? `（${esc(item.score_unit)}）` : ''}<span class="help">（可留空）</span></label><input class="input" data-f="score" value="${esc(r.score)}" maxlength="40" ${item.score_kind === 'number' ? 'inputmode="decimal"' : ''} ${editable ? '' : 'disabled'} placeholder="${item.kind === 'knockout' ? '例：冠軍戰勝' : ''}"></div>
          <div class="field"><label>備註</label><input class="input" data-f="remark" value="${esc(r.remark)}" maxlength="100" ${editable ? '' : 'disabled'}></div>
        </div>
        <label class="f-tie check" ${dup || r.tied ? '' : 'hidden'}><input type="checkbox" data-f="tied" ${r.tied ? 'checked' : ''} ${editable ? '' : 'disabled'}> 並列第 ${r.rank} 名</label>
        <div class="f-del"><button class="btn btn-danger btn-sm" type="button" data-del="${idx}" ${editable ? '' : 'disabled'} aria-label="刪除第 ${idx + 1} 列" style="min-height:44px">✕</button></div>
      </div>`;
    }).join('');
  }

  function previewHtml() {
    const rows = ed.rows.filter((r) => r.team_id).map((r) => {
      const t = teams.find((x) => x.id === r.team_id) || state.boot.teams.find((x) => x.id === r.team_id);
      return { rank: Number(r.rank), tied: r.tied, school: t ? (t.school || B.school(t.school_id)?.name) : '?', label: t?.label || '', score: r.score || null, remark: r.remark || null };
    }).sort((a, b) => a.rank - b.rank);
    const limit = item.kind === 'spirit' ? division.spirit_places : division.award_places;
    const shown = rows.filter((r) => r.rank <= limit);
    const hidden = rows.filter((r) => r.rank > limit);
    const table = item.kind === 'spirit'
      ? renderSpiritList({ rows: shown, division })
      : renderResultsTable({ rows: shown, division, item });
    return `${table}${hidden.length ? `<p class="help" style="padding:10px 16px">另有 ${hidden.length} 筆超過公布名額（第 ${limit} 名以後），不會出現在公開頁。</p>` : ''}`;
  }

  function statusBanner() {
    if (ed.status === 'pending') return `<div class="banner banner-warn">此成績表已送複核（${esc(sheet.submitted_by_name || '')} ${fmtTime(sheet.submitted_at)}）。${canReview ? '請於下方檢視即將公開的結果後發布或退回。' : '如需修改請請複核人員退回。'}</div>`;
    if (ed.status === 'published') return `<div class="banner banner-ok">此成績表已公布（第 ${sheet.revision} 版）。如需修正，請先建立修訂草稿，複核通過後公開頁才會更新。</div>`;
    if (sheet?.return_note) return `<div class="banner banner-err"><b>複核退回：</b>${esc(sheet.return_note)}</div>`;
    return '';
  }

  function render() {
    view.innerHTML = `
      <div class="card">
        <div class="editor-head"><h2>${esc(division.name)}・${esc(item.name)}</h2>${tag(ed.status)}${item.kind === 'knockout' ? '<span class="tag">單淘汰賽：請直接填裁判核定名次</span>' : ''}<span class="help">版本 ${ed.baseVersion}</span></div>
        ${statusBanner()}
        ${loadErr ? `<div class="banner banner-warn">目前離線，顯示的是本機草稿。</div>` : ''}
        ${ed.status === 'pending' || ed.status === 'published' ? `<h3>${ed.status === 'pending' ? '即將公開的結果' : '目前公開的結果'}</h3>${previewHtml()}` : ''}
        ${editable ? `
          <h3>成績輸入</h3>
          <p class="help">名次以裁判核定為準，不由系統自動排序。同名次請每列都勾「並列」。</p>
          <div class="rows" id="rows">${rowsHtml()}</div>
          <div class="actions"><button class="btn" type="button" id="btn-add">＋ 新增一列</button>
            <select class="input" id="quick-team" style="max-width:300px" aria-label="快速新增學校"><option value="">快速新增：選學校…</option>${teams.map((t) => `<option value="${t.id}">${esc(B.teamName(t))}</option>`).join('')}</select></div>
          <div class="field" style="margin-top:12px"><label for="note">給複核人員的備註（選填）</label><textarea class="input" id="note" maxlength="300">${esc(ed.note)}</textarea></div>
          <h3>預覽（公開頁呈現方式）</h3><div id="preview">${previewHtml()}</div>
        ` : (ed.status === null ? '<p class="empty">尚未有成績。</p>' : '')}
        ${!editable && ed.status === 'draft' && ed.rows.length ? `<h3>草稿內容</h3>${previewHtml()}` : ''}
      </div>
      <p style="margin-top:12px"><a href="#/audit-sheet" id="link-audit" class="help">查看此成績表的操作紀錄</a></p>`;
    $('#link-audit').onclick = (e) => { e.preventDefault(); showAudit(d, i); };
    wireEditor();
    renderSavebar();
  }

  function collect() {
    view.querySelectorAll('.row-edit').forEach((el) => {
      const r = ed.rows[Number(el.dataset.idx)];
      r.rank = Number(el.querySelector('[data-f=rank]').value) || 0;
      r.team_id = Number(el.querySelector('[data-f=team_id]').value) || 0;
      r.score = el.querySelector('[data-f=score]').value;
      r.remark = el.querySelector('[data-f=remark]').value;
      r.tied = el.querySelector('[data-f=tied]').checked;
    });
    ed.note = $('#note')?.value ?? ed.note;
  }

  function wireEditor() {
    if (!editable) return;
    const rowsEl = $('#rows');
    rowsEl.addEventListener('input', (e) => {
      collect(); ed.dirty = true; ed.saveState = { kind: 'dirty' };
      if (e.target.dataset.f === 'rank' || e.target.dataset.f === 'team_id' || e.target.dataset.f === 'tied') rowsEl.innerHTML = rowsHtml();
      $('#preview').innerHTML = previewHtml();
      renderSavebar();
      persistLocal(false);
    });
    rowsEl.addEventListener('change', () => { collect(); rowsEl.innerHTML = rowsHtml(); $('#preview').innerHTML = previewHtml(); });
    rowsEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      collect(); ed.rows.splice(Number(b.dataset.del), 1); ed.dirty = true; ed.saveState = { kind: 'dirty' };
      rowsEl.innerHTML = rowsHtml(); $('#preview').innerHTML = previewHtml(); renderSavebar(); persistLocal(false);
    });
    $('#note').addEventListener('input', () => { collect(); ed.dirty = true; ed.saveState = { kind: 'dirty' }; renderSavebar(); persistLocal(false); });
    const add = (teamId) => {
      collect();
      const next = ed.rows.length ? Math.max(...ed.rows.map((r) => r.rank)) + 1 : 1;
      ed.rows.push({ team_id: teamId || 0, rank: next, tied: false, score: '', remark: '' });
      ed.dirty = true; ed.saveState = { kind: 'dirty' };
      rowsEl.innerHTML = rowsHtml(); $('#preview').innerHTML = previewHtml(); renderSavebar(); persistLocal(false);
      const last = rowsEl.lastElementChild;
      last?.querySelector(teamId ? '[data-f=score]' : '[data-f=team_id]')?.focus();
    };
    $('#btn-add').onclick = () => add(0);
    $('#quick-team').onchange = (e) => { if (e.target.value) { add(Number(e.target.value)); e.target.value = ''; } };
  }

  function persistLocal(pending) {
    if (!editable) return;
    if (!ed.dirty) { writeDraft(d, i, null); return; }
    writeDraft(d, i, { rows: ed.rows, note: ed.note, baseVersion: ed.baseVersion, opId: ed.opId, pending, savedAt: Date.now() });
  }

  function renderSavebar() {
    const bar = $('#savebar');
    const s = ed.saveState;
    const label = {
      idle: '', dirty: '尚未儲存', saving: '儲存中…', offline: '離線：本機草稿尚未同步',
      saved: `已儲存${s.at ? ` ${fmtTime(s.at)}` : ''}`, failed: `儲存失敗：${s.msg || ''}`,
    }[s.kind];
    const cls = { saving: 'saving', saved: 'saved', failed: 'failed', offline: 'offline', dirty: 'offline' }[s.kind] || '';
    let buttons = '';
    if (editable) {
      buttons = `<button class="btn btn-primary" id="btn-save" ${s.kind === 'saving' ? 'disabled' : ''}>儲存草稿</button>
        <button class="btn btn-navy" id="btn-submit" ${s.kind === 'saving' ? 'disabled' : ''}>送複核</button>`;
    } else if (ed.status === 'pending' && canReview) {
      buttons = `<button class="btn btn-danger" id="btn-return">退回修正</button><button class="btn btn-primary" id="btn-publish">確認發布</button>`;
    } else if (ed.status === 'published' && (canEdit || canReview)) {
      buttons = `<button class="btn" id="btn-revise">建立修訂草稿</button>`;
    }
    if (!buttons && !label) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.querySelector('.wrap').innerHTML = `<span class="save-state ${cls}" role="status" aria-live="polite">${esc(label)}</span>${buttons}`;
    $('#btn-save') && ($('#btn-save').onclick = () => save());
    $('#btn-submit') && ($('#btn-submit').onclick = submit);
    $('#btn-return') && ($('#btn-return').onclick = doReturn);
    $('#btn-publish') && ($('#btn-publish').onclick = doPublish);
    $('#btn-revise') && ($('#btn-revise').onclick = doRevise);
  }

  function clientValidate() {
    const errs = [];
    ed.rows.forEach((r, idx) => {
      if (!r.team_id) errs.push(`第 ${idx + 1} 列：請選擇學校／隊伍`);
      if (!(r.rank >= 1 && r.rank <= 99)) errs.push(`第 ${idx + 1} 列：名次須為 1–99`);
      if (item.score_kind === 'number' && r.score !== '' && !Number.isFinite(Number(r.score))) errs.push(`第 ${idx + 1} 列：成績須為數字`);
    });
    return errs;
  }

  async function save({ force = false, silent = false } = {}) {
    collect();
    const errs = clientValidate();
    if (errs.length) { ed.saveState = { kind: 'failed', msg: errs[0] }; renderSavebar(); return false; }
    if (!ed.opId) ed.opId = uuid();
    ed.saveState = { kind: 'saving' }; renderSavebar();
    persistLocal(true);
    try {
      const res = await api('PUT', `/api/staff/sheets/${d}/${i}`, {
        version: ed.baseVersion, opId: ed.opId, note: ed.note,
        rows: ed.rows.map((r) => ({ team_id: r.team_id, rank: r.rank, tied: r.tied, score: r.score, remark: r.remark })),
      });
      sheet = res.sheet;
      ed.baseVersion = sheet.version; ed.status = sheet.status; ed.dirty = false; ed.opId = null;
      ed.saveState = { kind: 'saved', at: sheet.updated_at };
      writeDraft(d, i, null);
      renderSavebar();
      if (!silent) toast(res.replay ? '此筆先前已儲存成功（未重複建立）' : '已儲存');
      return true;
    } catch (e) {
      if (e instanceof NetworkError) {
        ed.saveState = { kind: 'offline' }; renderSavebar(); persistLocal(true);
        if (!silent) toast('目前離線，草稿已保留在此裝置，恢復連線後會自動重送', 'warn');
        return false;
      }
      if (e instanceof ApiError && e.status === 409) {
        ed.saveState = { kind: 'failed', msg: '有衝突' }; renderSavebar();
        return conflictDialog(e.body.current);
      }
      ed.saveState = { kind: 'failed', msg: errText(e) }; renderSavebar();
      return false;
    }
  }

  function conflictDialog(current) {
    return new Promise((resolve) => {
      const srv = current
        ? `<p class="help">伺服器版本 ${current.version}（${esc(current.updated_by_name || '')} ${fmtTime(current.updated_at)}，狀態：${STATUS[current.status]}，${current.rows.length} 筆）</p>
           <div style="max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:4px">${current.rows.map((r) => `<div style="padding:6px 10px;border-bottom:1px solid var(--line-2)">第 ${r.rank} 名　${esc(r.school)}${r.label ? `（${esc(r.label)}）` : ''}　${esc(r.score ?? '')}</div>`).join('') || '<p class="empty">（無資料）</p>'}</div>`
        : '<p>這份成績表已被刪除或重建。</p>';
      const canOverwrite = current && current.status === 'draft';
      dialog(`<h2>偵測到衝突</h2><p>這份成績表在您編輯期間已被其他人更新，系統沒有覆蓋任何資料。</p>${srv}
        <div class="dialog-actions">
          <button class="btn" data-x="load">載入伺服器版本（放棄我的修改）</button>
          ${canOverwrite ? '<button class="btn btn-danger" data-x="over">以我的內容覆蓋伺服器版本</button>' : ''}
        </div>`, (dlg) => {
        dlg.querySelector('[data-x=load]').onclick = () => { dlg.close(); writeDraft(d, i, null); renderSheet(d, i); resolve(false); };
        dlg.querySelector('[data-x=over]') && (dlg.querySelector('[data-x=over]').onclick = async () => {
          dlg.close(); ed.baseVersion = current.version; ed.opId = null; resolve(await save({ force: true }));
        });
      });
    });
  }

  async function submit() {
    collect();
    if (!ed.rows.length) { toast('尚未輸入任何成績', 'err'); return; }
    if (ed.dirty || ed.status === null) { const ok = await save({ silent: true }); if (!ok) return; }
    if (!(await confirmDialog('送複核', `確定將「${esc(division.name)}・${esc(item.name)}」${ed.rows.length} 筆成績送交複核？送出後需由複核人員退回才能再修改。`, '送複核'))) return;
    await transition('submit', {}, '已送複核');
  }
  async function doReturn() {
    dialog(`<h2>退回修正</h2><div class="field"><label for="ret-note">退回原因（會顯示給輸入人員）</label><textarea class="input" id="ret-note" maxlength="300"></textarea></div>
      <div class="dialog-actions"><button class="btn" data-x="c">取消</button><button class="btn btn-danger" data-x="ok">退回</button></div>`, (dlg) => {
      dlg.querySelector('[data-x=c]').onclick = () => dlg.close();
      dlg.querySelector('[data-x=ok]').onclick = async () => {
        const note = $('#ret-note').value.trim();
        if (!note) { toast('請填寫退回原因', 'err'); return; }
        dlg.close(); await transition('return', { note }, '已退回');
      };
    });
  }
  async function doPublish() {
    if (!(await confirmDialog('確認發布', `發布後，上方「即將公開的結果」會立即出現在公開成績頁。確定發布「${esc(division.name)}・${esc(item.name)}」？`, '確認發布'))) return;
    await transition('publish', {}, '已發布，公開頁將於 20 秒內更新');
  }
  async function doRevise() {
    if (!(await confirmDialog('建立修訂草稿', '公開頁會繼續顯示目前版本，直到修訂草稿複核通過後才更新。', '建立修訂草稿'))) return;
    await transition('revise', {}, '已建立修訂草稿');
  }
  async function transition(action, body, okMsg) {
    try {
      const res = await api('POST', `/api/staff/sheets/${d}/${i}/${action}`, { version: ed.baseVersion, opId: uuid(), ...body });
      sheet = res.sheet; toast(okMsg);
      state.boot = null; await bootReload();
      renderSheet(d, i);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast(`${e.message}（頁面將重新載入最新狀態）`, 'err');
        setTimeout(() => renderSheet(d, i), 800);
      } else toast(errText(e), 'err');
    }
  }

  const onOnline = () => { if (ed.saveState.kind === 'offline') save({ silent: true }).then((ok) => ok && toast('已恢復連線並同步草稿')); };
  window.addEventListener('online', onOnline);
  currentTeardown = () => window.removeEventListener('online', onOnline);

  render();
  if (ed.saveState.kind === 'offline' && navigator.onLine && !loadErr) save({ silent: true }).then((ok) => ok && toast('已同步先前離線時的草稿'));
}

// ---------- 複核清單 ----------
async function renderReview() {
  await bootReload(); nav();
  const all = B.mySheets();
  const groups = [
    ['待複核', all.filter((x) => x.sheet?.status === 'pending')],
    ['已公布', all.filter((x) => x.sheet?.status === 'published')],
    ['草稿／未輸入', all.filter((x) => !x.sheet || x.sheet.status === 'draft')],
  ];
  view.innerHTML = groups.map(([t, list]) => `<div class="card"><h2>${t}<span class="help">（${list.length}）</span></h2>
    ${list.length ? `<ul class="sheet-list">${list.map((x) => `<li><a class="title" href="#/sheet/${x.division.id}/${x.item.id}">${esc(x.division.name)}・${esc(x.item.name)}<span class="sub">${x.sheet ? `${x.sheet.row_count} 筆・${esc(x.sheet.updated_by_name || '')} ${fmtTime(x.sheet.updated_at)}` : '尚未輸入'}</span></a>${tag(x.sheet?.status)}</li>`).join('')}</ul>` : '<p class="help">無</p>'}
  </div>`).join('') + `<div class="card"><h2>匯出</h2><div class="actions"><a class="btn" href="/api/staff/export.csv?scope=published">下載已公布成績 CSV</a><a class="btn" href="/api/staff/export.csv?scope=all">下載全部（含草稿）CSV</a></div><p class="help">CSV 以 UTF-8（含 BOM）輸出，可直接用 Excel 開啟製作獎狀。</p></div>`;
}

// ---------- 紀錄 ----------
async function showAudit(d, i) {
  let log;
  try { log = (await api('GET', `/api/staff/audit?division_id=${d}&item_id=${i}`)).log; } catch (e) { toast(errText(e), 'err'); return; }
  dialog(`<h2>操作紀錄</h2><div style="max-height:60vh;overflow:auto">${auditHtml(log)}</div><div class="dialog-actions"><button class="btn" data-x="c">關閉</button></div>`,
    (dlg) => { dlg.querySelector('[data-x=c]').onclick = () => dlg.close(); });
}
function auditHtml(log) {
  const label = { 'sheet.save': '儲存草稿', 'sheet.submit': '送複核', 'sheet.return': '退回', 'sheet.publish': '發布', 'sheet.revise': '建立修訂草稿', 'invite.create': '建立邀請', 'invite.accept': '接受邀請', 'user.update': '更新人員', 'user.assign': '調整分工', 'school.upsert': '新增學校', 'school.bulk': '批次新增學校', 'school.update': '修改學校', 'school.delete': '刪除學校', 'item.update': '修改項目', 'event.update': '修改活動' };
  if (!log.length) return '<p class="help">尚無紀錄</p>';
  return log.map((a) => `<div class="audit-item"><b>${esc(label[a.action] || a.action)}</b>　${esc(a.user_name || '系統')}<span class="when">　${fmtTime(a.at)}</span>
    <details><summary class="help">修改前後內容</summary><pre>修改前：${esc(JSON.stringify(a.before, null, 1))}\n修改後：${esc(JSON.stringify(a.after, null, 1))}</pre></details></div>`).join('');
}
async function renderAudit() {
  view.innerHTML = '<div class="card"><h2>操作紀錄</h2><p>載入中…</p></div>';
  try {
    const { log } = await api('GET', '/api/staff/audit');
    view.innerHTML = `<div class="card"><h2>操作紀錄</h2><p class="help">最近 200 筆。每筆包含操作者、時間與修改前後內容。</p>${auditHtml(log)}</div>`;
  } catch (e) { view.innerHTML = `<div class="banner banner-err">${esc(errText(e))}</div>`; }
}

// ---------- 帳號 ----------
function renderAccount() {
  view.innerHTML = `<div class="card login" style="margin-top:16px"><h2>我的帳號</h2><p>${esc(state.user.name)}・${esc(state.user.email)}・${ROLE[state.user.role]}</p>
    <form class="form" id="pw-form" style="margin-top:14px">
      <div class="field"><label for="cur">目前密碼</label><input class="input" id="cur" type="password" autocomplete="current-password" required></div>
      <div class="field"><label for="new">新密碼（至少 8 個字元）</label><input class="input" id="new" type="password" autocomplete="new-password" minlength="8" required></div>
      <button class="btn btn-primary" type="submit">更改密碼</button></form></div>`;
  $('#pw-form').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('POST', '/api/auth/change-password', { current: $('#cur').value, password: $('#new').value }); toast('密碼已更改'); e.target.reset(); } catch (err) { toast(errText(err), 'err'); }
  };
}

// ---------- 管理：人員 ----------
async function renderUsers() {
  view.innerHTML = '<div class="card"><p>載入中…</p></div>';
  await bootReload();
  let data;
  try { data = await api('GET', '/api/admin/users'); } catch (e) { view.innerHTML = `<div class="banner banner-err">${esc(errText(e))}</div>`; return; }
  const items = state.boot.items.filter((i) => i.is_active);
  const matrix = (u) => state.boot.divisions.map((d) => `<h3>${esc(d.name)}</h3><div class="matrix">${items.map((i) => {
    const on = u.assignments.some((a) => a.division_id === d.id && a.item_id === i.id);
    return `<label class="check"><input type="checkbox" data-d="${d.id}" data-i="${i.id}" ${on ? 'checked' : ''}> ${esc(i.name)}</label>`;
  }).join('')}</div>`).join('');
  view.innerHTML = `
    <div class="card"><h2>邀請同事</h2>
      <form class="form" id="inv-form"><div class="form-row">
        <div class="field"><label for="inv-name">姓名</label><input class="input" id="inv-name" required maxlength="40"></div>
        <div class="field"><label for="inv-email">電子郵件（登入帳號）</label><input class="input" id="inv-email" type="email" required></div>
        <div class="field"><label for="inv-role">角色</label><select class="input" id="inv-role"><option value="entry">成績輸入人員</option><option value="reviewer">複核人員</option><option value="admin">管理者</option></select></div>
        <button class="btn btn-primary" type="submit">產生邀請連結</button></div>
      <p class="help">產生後把連結用 LINE 或 Email 傳給同事，對方自行設定密碼即可登入（7 天內有效）。同一個 Email 再邀請一次可用來重設密碼。</p>
      <div id="inv-result"></div></form>
      ${data.invitations.length ? `<h3>尚未使用的邀請</h3><div class="table-wrap"><table class="table"><tr><th>姓名</th><th>Email</th><th>角色</th><th>到期</th><th></th></tr>${data.invitations.map((v) => `<tr><td>${esc(v.name)}</td><td>${esc(v.email)}</td><td>${ROLE[v.role]}</td><td>${fmtTime(v.expires_at)}</td><td><button class="btn btn-sm btn-danger" data-del-inv="${v.id}">取消</button></td></tr>`).join('')}</table></div>` : ''}
    </div>
    <div class="card"><h2>人員與分工</h2><p class="help">管理者可處理全部項目；輸入與複核人員只能處理被勾選的組別／項目。</p>
      ${data.users.map((u) => `<details class="card" style="padding:12px" ${u.id === state.user.id ? '' : ''}><summary style="cursor:pointer;font-weight:600;font-size:17px;min-height:44px;display:flex;align-items:center;gap:10px">
          ${esc(u.name)} <span class="tag tag-blue">${ROLE[u.role]}</span>${u.is_active ? '' : '<span class="tag tag-err">已停用</span>'}${u.has_password ? '' : '<span class="tag tag-warn">尚未設定密碼</span>'}<span class="help" style="font-weight:400">${esc(u.email)}${u.role === 'admin' ? '' : `・${u.assignments.length} 個項目`}</span></summary>
        <div class="form" data-user="${u.id}" style="margin-top:10px">
          <div class="form-row">
            <div class="field"><label>姓名</label><input class="input" data-f="name" value="${esc(u.name)}" maxlength="40"></div>
            <div class="field"><label>角色</label><select class="input" data-f="role"><option value="entry" ${u.role === 'entry' ? 'selected' : ''}>成績輸入人員</option><option value="reviewer" ${u.role === 'reviewer' ? 'selected' : ''}>複核人員</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>管理者</option></select></div>
            <label class="check"><input type="checkbox" data-f="is_active" ${u.is_active ? 'checked' : ''}> 啟用</label>
            <button class="btn" type="button" data-save-user="${u.id}">儲存基本資料</button>
          </div>
          ${u.role === 'admin' ? '<p class="help">管理者不需指派，可處理全部項目。</p>' : `${matrix(u)}<div class="actions" style="margin-top:8px"><button class="btn btn-primary" type="button" data-save-assign="${u.id}">儲存分工</button><button class="btn btn-sm" type="button" data-all="${u.id}">全選</button><button class="btn btn-sm" type="button" data-none="${u.id}">全不選</button></div>`}
        </div></details>`).join('')}
    </div>`;
  $('#inv-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('POST', '/api/admin/invitations', { name: $('#inv-name').value, email: $('#inv-email').value, role: $('#inv-role').value });
      $('#inv-result').innerHTML = `<div class="banner banner-ok" style="display:block"><b>邀請連結已產生（${esc(r.invitation.name)}）：</b><div class="link-box" style="margin-top:6px"><code id="inv-link">${esc(r.invitation.link)}</code><button class="btn btn-sm" type="button" id="copy-inv">複製</button></div></div>`;
      $('#copy-inv').onclick = async () => { try { await navigator.clipboard.writeText(r.invitation.link); $('#copy-inv').textContent = '已複製'; } catch { /* ignore */ } };
    } catch (err) { toast(errText(err), 'err'); }
  };
  view.querySelectorAll('[data-del-inv]').forEach((b) => { b.onclick = async () => { await api('DELETE', `/api/admin/invitations/${b.dataset.delInv}`); renderUsers(); }; });
  view.querySelectorAll('[data-save-user]').forEach((b) => {
    b.onclick = async () => {
      const box = b.closest('[data-user]');
      try {
        await api('PATCH', `/api/admin/users/${box.dataset.user}`, { name: box.querySelector('[data-f=name]').value, role: box.querySelector('[data-f=role]').value, is_active: box.querySelector('[data-f=is_active]').checked });
        toast('已儲存'); renderUsers();
      } catch (err) { toast(errText(err), 'err'); }
    };
  });
  view.querySelectorAll('[data-save-assign]').forEach((b) => {
    b.onclick = async () => {
      const box = b.closest('[data-user]');
      const assignments = [...box.querySelectorAll('input[data-d]:checked')].map((c) => ({ division_id: Number(c.dataset.d), item_id: Number(c.dataset.i) }));
      try { await api('PUT', `/api/admin/users/${box.dataset.user}/assignments`, { assignments }); toast('分工已儲存'); } catch (err) { toast(errText(err), 'err'); }
    };
  });
  view.querySelectorAll('[data-all],[data-none]').forEach((b) => {
    b.onclick = () => b.closest('[data-user]').querySelectorAll('input[data-d]').forEach((c) => { c.checked = b.hasAttribute('data-all'); });
  });
}

// ---------- 管理：學校與隊伍 ----------
async function renderSchools() {
  await bootReload();
  const divs = state.boot.divisions;
  view.innerHTML = `
    <div class="card"><h2>批次新增學校</h2>
      <form class="form" id="bulk-form">
        <div class="field"><label for="bulk">每行一所學校（可加逗號與簡稱，例如「新竹縣立竹東國民中學,竹東國中」）</label><textarea class="input" id="bulk" rows="5" placeholder="竹東國中&#10;竹北國小"></textarea></div>
        <div class="actions">${divs.map((d) => `<label class="check"><input type="checkbox" name="bd" value="${d.id}"> 加入${esc(d.name)}</label>`).join('')}<button class="btn btn-primary" type="submit">新增</button></div>
        <p class="help">勾選組別後會同時為每所學校建立該組別的隊伍。同校第二隊可在下方新增「A隊／B隊」。</p>
      </form></div>
    <div class="card"><h2>學校與隊伍（${state.boot.schools.length} 所）</h2>
      <div class="table-wrap"><table class="table"><thead><tr><th>學校</th>${divs.map((d) => `<th>${esc(d.name)}</th>`).join('')}<th></th></tr></thead><tbody>
      ${state.boot.schools.map((s) => `<tr data-school="${s.id}"><td><input class="input" data-f="name" value="${esc(s.name)}" style="min-width:180px" aria-label="校名"></td>
        ${divs.map((d) => {
          const teams = state.boot.teams.filter((t) => t.school_id === s.id && t.division_id === d.id);
          return `<td>${teams.map((t) => `<label class="check" style="min-height:36px"><input type="checkbox" data-team="${t.id}" ${t.is_active ? 'checked' : ''}> ${t.label ? esc(t.label) : '參賽'}</label>`).join('<br>')}
            <button class="btn btn-sm btn-ghost" data-add-team="${s.id}" data-d="${d.id}">＋隊伍</button></td>`;
        }).join('')}
        <td><button class="btn btn-sm" data-save-school="${s.id}">儲存</button> <button class="btn btn-sm btn-danger" data-del-school="${s.id}">刪除</button></td></tr>`).join('')}
      </tbody></table></div>
      <p class="help">取消勾選＝停用該隊伍（不會出現在選單）。已有成績的學校無法刪除。</p>
    </div>`;
  $('#bulk-form').onsubmit = async (e) => {
    e.preventDefault();
    const division_ids = [...view.querySelectorAll('input[name=bd]:checked')].map((c) => Number(c.value));
    try { const r = await api('POST', '/api/admin/schools/bulk', { text: $('#bulk').value, division_ids }); toast(`已處理 ${r.count} 所學校`); renderSchools(); } catch (err) { toast(errText(err), 'err'); }
  };
  view.querySelectorAll('[data-team]').forEach((c) => { c.onchange = async () => { try { await api('PATCH', `/api/admin/teams/${c.dataset.team}`, { is_active: c.checked }); toast(c.checked ? '已啟用隊伍' : '已停用隊伍'); } catch (err) { toast(errText(err), 'err'); c.checked = !c.checked; } }; });
  view.querySelectorAll('[data-add-team]').forEach((b) => {
    b.onclick = () => dialog(`<h2>新增隊伍</h2><div class="field"><label for="tl">隊伍名稱（第一隊可留空；第二隊填 B隊）</label><input class="input" id="tl" maxlength="20"></div><div class="dialog-actions"><button class="btn" data-x="c">取消</button><button class="btn btn-primary" data-x="ok">新增</button></div>`, (dlg) => {
      dlg.querySelector('[data-x=c]').onclick = () => dlg.close();
      dlg.querySelector('[data-x=ok]').onclick = async () => { try { await api('POST', '/api/admin/teams', { school_id: Number(b.dataset.addTeam), division_id: Number(b.dataset.d), label: $('#tl').value }); dlg.close(); renderSchools(); } catch (err) { toast(errText(err), 'err'); } };
    });
  });
  view.querySelectorAll('[data-save-school]').forEach((b) => { b.onclick = async () => { const tr = b.closest('tr'); try { await api('PATCH', `/api/admin/schools/${b.dataset.saveSchool}`, { name: tr.querySelector('[data-f=name]').value }); toast('已儲存'); } catch (err) { toast(errText(err), 'err'); } }; });
  view.querySelectorAll('[data-del-school]').forEach((b) => { b.onclick = async () => { if (!(await confirmDialog('刪除學校', '確定刪除？已有成績的學校無法刪除。', '刪除', true))) return; try { await api('DELETE', `/api/admin/schools/${b.dataset.delSchool}`); renderSchools(); } catch (err) { toast(errText(err), 'err'); } }; });
}

// ---------- 管理：項目 ----------
async function renderItems() {
  await bootReload();
  view.innerHTML = `<div class="card"><h2>競賽項目</h2><p class="help">「成績格式」決定輸入欄位的檢查方式：不限（可空白或文字）、數字（可設上下限）。名次一律以裁判核定為準，系統不自動排序。</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>順序</th><th>名稱</th><th>類型</th><th>成績格式</th><th>單位</th><th>下限</th><th>上限</th><th>啟用</th><th></th></tr></thead><tbody>
    ${state.boot.items.map((i) => `<tr data-item="${i.id}">
      <td><input class="input" data-f="sort_order" type="number" value="${i.sort_order}" style="width:70px"></td>
      <td><input class="input" data-f="name" value="${esc(i.name)}" style="min-width:150px"></td>
      <td>${{ ranked: '排名', knockout: '單淘汰', spirit: '精神總錦標' }[i.kind]}</td>
      <td><select class="input" data-f="score_kind"><option value="none" ${i.score_kind === 'none' ? 'selected' : ''}>不限</option><option value="number" ${i.score_kind === 'number' ? 'selected' : ''}>數字</option><option value="text" ${i.score_kind === 'text' ? 'selected' : ''}>文字</option></select></td>
      <td><input class="input" data-f="score_unit" value="${esc(i.score_unit || '')}" style="width:80px" placeholder="分／秒"></td>
      <td><input class="input" data-f="score_min" type="number" step="any" value="${i.score_min ?? ''}" style="width:90px"></td>
      <td><input class="input" data-f="score_max" type="number" step="any" value="${i.score_max ?? ''}" style="width:90px"></td>
      <td><input type="checkbox" data-f="is_active" ${i.is_active ? 'checked' : ''} style="width:22px;height:22px"></td>
      <td><button class="btn btn-sm" data-save-item="${i.id}">儲存</button></td></tr>`).join('')}
    </tbody></table></div></div>
    <div class="card"><h2>新增項目</h2><form class="form-row" id="item-form"><div class="field"><label for="in">名稱</label><input class="input" id="in" required maxlength="40"></div><div class="field"><label for="ik">類型</label><select class="input" id="ik"><option value="ranked">排名</option><option value="knockout">單淘汰</option></select></div><button class="btn btn-primary" type="submit">新增</button></form></div>
    <div class="card"><h2>公布名額</h2>${state.boot.divisions.map((d) => `<div class="form-row" data-div="${d.id}"><b>${esc(d.name)}</b><div class="field"><label>公布名次上限</label><input class="input" data-f="award_places" type="number" min="1" max="30" value="${d.award_places}"></div><div class="field"><label>精神總錦標名額</label><input class="input" data-f="spirit_places" type="number" min="1" max="30" value="${d.spirit_places}"></div><button class="btn btn-sm" data-save-div="${d.id}">儲存</button></div>`).join('')}</div>`;
  view.querySelectorAll('[data-save-item]').forEach((b) => {
    b.onclick = async () => {
      const tr = b.closest('tr'); const g = (f) => tr.querySelector(`[data-f=${f}]`);
      try {
        await api('PATCH', `/api/admin/items/${b.dataset.saveItem}`, { name: g('name').value, score_kind: g('score_kind').value, score_unit: g('score_unit').value, score_min: g('score_min').value, score_max: g('score_max').value, sort_order: Number(g('sort_order').value), is_active: g('is_active').checked });
        toast('已儲存');
      } catch (err) { toast(errText(err), 'err'); }
    };
  });
  $('#item-form').onsubmit = async (e) => { e.preventDefault(); try { await api('POST', '/api/admin/items', { name: $('#in').value, kind: $('#ik').value }); renderItems(); } catch (err) { toast(errText(err), 'err'); } };
  view.querySelectorAll('[data-save-div]').forEach((b) => {
    b.onclick = async () => { const box = b.closest('[data-div]'); try { await api('PATCH', `/api/admin/divisions/${b.dataset.saveDiv}`, { award_places: Number(box.querySelector('[data-f=award_places]').value), spirit_places: Number(box.querySelector('[data-f=spirit_places]').value) }); toast('已儲存'); } catch (err) { toast(errText(err), 'err'); } };
  });
}

// ---------- 管理：活動 ----------
async function renderEvent() {
  await bootReload();
  const ev = state.boot.event;
  const counts = { published: 0, pending: 0, draft: 0 };
  state.boot.sheets.forEach((s) => { counts[s.status] += 1; });
  view.innerHTML = `<div class="card"><h2>活動資訊</h2><form class="form" id="ev-form">
      <div class="field"><label for="en">活動名稱</label><input class="input" id="en" value="${esc(ev.name)}" required maxlength="120"></div>
      <div class="form-row">
        <div class="field"><label for="ee">屆次</label><input class="input" id="ee" value="${esc(ev.edition || '')}"></div>
        <div class="field"><label for="ed">日期</label><input class="input" id="ed" type="date" value="${esc(ev.event_date || '')}"></div>
        <div class="field"><label for="ev">場地</label><input class="input" id="ev" value="${esc(ev.venue || '')}"></div>
        <div class="field"><label for="eo">承辦單位</label><input class="input" id="eo" value="${esc(ev.organizer || '')}"></div>
      </div><div><button class="btn btn-primary" type="submit">儲存</button></div></form>
      ${ev.is_demo ? '<div class="banner banner-warn" style="margin-top:12px">目前顯示的是示範活動資料。正式上線前請清除示範資料（見 README）。</div>' : ''}
    </div>
    <div class="card"><h2>進度總覽</h2><div class="kpi"><div><b>${counts.published}</b><span>已公布</span></div><div><b>${counts.pending}</b><span>待複核</span></div><div><b>${counts.draft}</b><span>草稿</span></div><div><b>${state.boot.schools.length}</b><span>學校</span></div></div></div>
    <div class="card"><h2>匯出</h2><div class="actions"><a class="btn" href="/api/staff/export.csv?scope=published">已公布成績 CSV</a><a class="btn" href="/api/staff/export.csv?scope=all">全部（含草稿）CSV</a></div></div>`;
  $('#ev-form').onsubmit = async (e) => { e.preventDefault(); try { await api('PATCH', '/api/admin/event', { name: $('#en').value, edition: $('#ee').value, event_date: $('#ed').value, venue: $('#ev').value, organizer: $('#eo').value }); toast('已儲存'); state.boot = null; route(); } catch (err) { toast(errText(err), 'err'); } };
}

route();
