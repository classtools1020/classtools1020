/* 成績登打頁：認證碼登入 → 選組別、項目 → 每個名次選學校、填成績 → 儲存／儲存並公布。
 * 後台是 Apps Script（config.js 的 API_URL）。 */
import { backend, ApiError, loadStaff, saveItem, setAnnouncement } from './api.js';
import { KNOCKOUT } from './config.js';
import { renderResultsTable, renderSpiritList, esc } from './results-table.js';

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const API_URL = backend !== 'none';

const state = { code: '', user: null, data: null, division: '國小組', item: '', rows: [], dirty: false, save: { kind: 'idle' } };
try { state.code = localStorage.getItem('asr115:code') || ''; } catch { /* ignore */ }
try { state.division = localStorage.getItem('asr115:division') || '國小組'; } catch { /* ignore */ }

// ---------- 小工具 ----------
function toast(msg, kind = 'ok') {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.className = `banner banner-${kind}`;
  t.style.cssText = 'position:fixed;left:16px;right:16px;bottom:84px;z-index:20;max-width:520px;margin:0 auto;box-shadow:0 4px 16px rgba(0,0,0,.15)';
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
}
function confirmDialog(title, text, okLabel = '確定') {
  return new Promise((resolve) => {
    const dlg = $('#dlg');
    $('#dlg-body').innerHTML = `<h2>${esc(title)}</h2><p>${text}</p><div class="dialog-actions"><button class="btn" data-x="c">取消</button><button class="btn btn-primary" data-x="ok">${esc(okLabel)}</button></div>`;
    dlg.querySelector('[data-x=c]').onclick = () => { dlg.close(); resolve(false); };
    dlg.querySelector('[data-x=ok]').onclick = () => { dlg.close(); resolve(true); };
    dlg.addEventListener('close', () => resolve(false), { once: true });
    dlg.showModal();
  });
}
const maxRank = () => state.data.divisions[state.division] || 3;
const schoolsOf = () => state.data.schools.filter((s) => (state.division === '國小組' ? s.elementary : s.junior)).map((s) => s.name);
const itemRows = (division, item) => state.data.results.filter((r) => r.division === division && r.item === item);
const itemStatus = (division, item) => { const r = itemRows(division, item); return !r.length ? 'none' : r.some((x) => x.published) ? 'published' : 'draft'; };
const STATUS = { none: ['未輸入', 'status-none'], draft: ['草稿', 'status-draft'], published: ['已公布', 'status-published'] };
const tag = (st) => `<span class="tag ${STATUS[st][1]}">${STATUS[st][0]}</span>`;

// ---------- 畫面 ----------
function renderLogin(err = '') {
  $('#savebar').hidden = true;
  if (!API_URL) {
    view.innerHTML = `<div class="card login"><h2>後台尚未啟用</h2><p>登打功能需要先接上資料庫（Supabase，約 3 分鐘）。做完後這裡就會出現登入畫面。</p>
      <ol style="margin:12px 0 0 18px;line-height:1.8"><li>到 supabase.com 建立一個專案（或用現有的）</li><li>左側 SQL Editor → 貼上 backend/supabase.sql 全部內容 → Run</li><li>Project Settings → API：複製 Project URL 與 anon public key 傳給 Claude</li><li>Claude 填入網站後即可用「Table Editor → asr → staff」裡的認證碼登入</li></ol></div>`;
    return;
  }
  view.innerHTML = `<div class="card login"><h2>工作人員登入</h2>${deep.item ? `<p><b>要登打：${esc(deep.division || '')}・${esc(deep.item)}</b></p>` : ''}<p class="help">輸入管理者給您的認證碼，不需要帳號或 Email。</p>
    <form class="form" id="login-form" style="margin-top:12px">
      <div class="field"><label for="code">認證碼</label><input class="input code-input" id="code" autocomplete="one-time-code" inputmode="numeric" autocapitalize="characters" spellcheck="false" maxlength="20" required placeholder="例如：123456"></div>
      <div id="login-err" class="banner banner-err" ${err ? '' : 'hidden'} role="alert">${esc(err)}</div>
      <button class="btn btn-primary btn-block" type="submit">登入</button></form></div>`;
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true;
    state.code = $('#code').value.trim();
    try { await load(); try { localStorage.setItem('asr115:code', state.code); } catch { /* ignore */ } afterLogin(); }
    catch (err) { $('#login-err').hidden = false; $('#login-err').textContent = err.message; btn.disabled = false; }
  };
  setTimeout(() => $('#code')?.focus(), 50);
}

async function load() {
  const d = await loadStaff(state.code);
  state.data = d; state.user = d.user;
  $('#top-actions').innerHTML = `<span class="help topbar-user">${esc(d.user.name)}・${d.user.role === 'admin' ? '管理者' : '登打人員'}</span><a class="btn btn-sm" href="./" target="_blank" rel="noopener">公開頁</a><button class="btn btn-sm" id="btn-logout">登出</button>`;
  $('#btn-logout').onclick = () => { state.code = ''; state.user = null; try { localStorage.removeItem('asr115:code'); } catch { /* ignore */ } renderLogin(); };
}

function renderHome() {
  $('#savebar').hidden = true;
  const items = state.data.items;
  const li = (it) => {
    const st = itemStatus(state.division, it);
    const r = itemRows(state.division, it);
    const meta = r.length ? `${r.length} 筆・${esc(r[0].updated_by)} ${esc(r[0].updated_at.slice(5, 16))}` : '尚未輸入';
    return `<li><a class="title" href="#" data-item="${esc(it)}">${esc(it)}${KNOCKOUT.includes(it) ? ' <span class="tag">單淘汰</span>' : ''}<span class="sub">${meta}</span></a>${tag(st)}</li>`;
  };
  view.innerHTML = `
    <div class="card"><div class="actions"><div class="seg" role="group" aria-label="組別" id="div-seg">${Object.keys(state.data.divisions).map((d) => `<button type="button" data-d="${esc(d)}" aria-pressed="${d === state.division}">${esc(d)}</button>`).join('')}</div><span class="spacer"></span><button class="btn btn-sm" id="btn-reload">重新整理</button></div>
      <p class="help" style="margin-top:8px">點項目 → 每個名次選學校、填成績 → 「儲存並公布」。公開頁 20 秒內更新。</p></div>
    <div class="card"><h2>${esc(state.division)}　項目</h2><ul class="sheet-list">${items.map(li).join('')}</ul></div>
    ${state.user.role === 'admin' ? `<div class="card"><h2>公開頁公告</h2><div class="form-row"><div class="field"><label for="ann">一行文字，留空則不顯示（例如：頒獎典禮 14:00 於司令台）</label><input class="input" id="ann" maxlength="200" value="${esc(state.data.announcement || '')}"></div><button class="btn btn-primary" id="btn-ann">儲存公告</button></div></div>` : ''}`;
  $('#div-seg').onclick = (e) => { const b = e.target.closest('button[data-d]'); if (!b) return; state.division = b.dataset.d; try { localStorage.setItem('asr115:division', state.division); } catch { /* ignore */ } renderHome(); };
  $('#btn-reload').onclick = async () => { try { await load(); renderHome(); toast('已更新'); } catch (err) { toast(err.message, 'err'); } };
  view.querySelectorAll('[data-item]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); openItem(a.dataset.item); }; });
  $('#btn-ann') && ($('#btn-ann').onclick = async () => { try { await setAnnouncement(state.code, $('#ann').value); toast('公告已儲存'); } catch (err) { toast(err.message, 'err'); } });
}

function openItem(item) {
  state.item = item;
  const existing = itemRows(state.division, item);
  const n = maxRank();
  // 每個名次一列；同名次多校（並列）以陣列保存
  state.rows = Array.from({ length: n }, (_, i) => {
    const hits = existing.filter((r) => r.rank === i + 1);
    return { rank: i + 1, schools: hits.length ? hits.map((h) => h.school) : [''], score: hits[0]?.score || '' };
  });
  state.dirty = false; state.save = { kind: 'idle' };
  renderEditor();
}

function renderEditor() {
  const item = state.item;
  const st = itemStatus(state.division, item);
  const schools = schoolsOf();
  const used = new Set(state.rows.flatMap((r) => r.schools).filter(Boolean));
  const opt = (sel) => `<option value="">— 選學校 —</option>${schools.map((s) => `<option value="${esc(s)}" ${s === sel ? 'selected' : ''} ${used.has(s) && s !== sel ? 'disabled' : ''}>${esc(s)}</option>`).join('')}`;
  const isSpirit = item === '精神總錦標';
  view.innerHTML = `
    <div class="card">
      <div class="editor-head"><a class="btn btn-sm" href="#" id="btn-back">← 項目列表</a><h2>${esc(state.division)}・${esc(item)}</h2>${tag(st)}</div>
      <p class="help" style="margin:8px 0 4px">名次以裁判核定為準。${isSpirit ? '精神總錦標依大會核定名次填入。' : '並列請按「＋並列」在同一名次加第二所學校。'}成績可留空${KNOCKOUT.includes(item) ? '（單淘汰賽只填名次）' : ''}。</p>
      <div class="rank-rows">${state.rows.map((r, i) => `
        <div class="rank-row r${r.rank <= 3 ? r.rank : 'n'}" data-i="${i}">
          <div class="rank-label"><span class="num">${r.rank}</span>${['', '金牌', '銀牌', '銅牌'][r.rank] ? `<span class="medal">${['', '金牌', '銀牌', '銅牌'][r.rank]}</span>` : ''}</div>
          <div class="rank-fields">
            ${r.schools.map((s, j) => `<div class="rank-school"><select class="input" data-f="school" data-j="${j}" aria-label="第 ${r.rank} 名學校${j ? '（並列）' : ''}">${opt(s)}</select>${j ? `<button class="btn btn-sm btn-danger" type="button" data-del="${j}" aria-label="移除並列">✕</button>` : ''}</div>`).join('')}
            <div class="rank-extra"><input class="input" data-f="score" value="${esc(r.score)}" maxlength="40" placeholder="成績（可留空）" aria-label="第 ${r.rank} 名成績"><button class="btn btn-sm btn-ghost" type="button" data-tie="1">＋並列</button></div>
          </div>
        </div>`).join('')}</div>
      <h3>預覽（公開頁呈現）</h3><div id="preview">${previewHtml()}</div>
    </div>`;
  $('#btn-back').onclick = async (e) => {
    e.preventDefault();
    if (state.dirty && !(await confirmDialog('尚未儲存', '有尚未儲存的修改，確定離開？', '離開'))) return;
    try { await load(); } catch { /* keep old data */ }
    renderHome();
  };
  const box = view.querySelector('.rank-rows');
  box.addEventListener('change', (e) => {
    const row = e.target.closest('.rank-row'); if (!row) return;
    const r = state.rows[Number(row.dataset.i)];
    if (e.target.dataset.f === 'school') { r.schools[Number(e.target.dataset.j)] = e.target.value; markDirty(); renderEditor(); }
  });
  box.addEventListener('input', (e) => {
    const row = e.target.closest('.rank-row'); if (!row) return;
    const r = state.rows[Number(row.dataset.i)];
    if (e.target.dataset.f === 'score') { r.score = e.target.value; markDirty(); $('#preview').innerHTML = previewHtml(); }
  });
  box.addEventListener('click', (e) => {
    const row = e.target.closest('.rank-row'); if (!row) return;
    const r = state.rows[Number(row.dataset.i)];
    if (e.target.closest('[data-tie]')) { r.schools.push(''); markDirty(); renderEditor(); }
    const del = e.target.closest('[data-del]');
    if (del) { r.schools.splice(Number(del.dataset.del), 1); markDirty(); renderEditor(); }
  });
  renderSavebar();
}
function markDirty() { state.dirty = true; state.save = { kind: 'dirty' }; renderSavebar(); }

function previewRows() {
  const out = [];
  state.rows.forEach((r) => {
    const names = r.schools.filter(Boolean);
    names.forEach((s) => out.push({ rank: r.rank, tied: names.length > 1, school: s, label: '', score: r.score || null, remark: null }));
  });
  return out;
}
function previewHtml() {
  const division = { name: state.division, award_places: maxRank(), spirit_places: maxRank() };
  const item = { name: state.item, kind: state.item === '精神總錦標' ? 'spirit' : KNOCKOUT.includes(state.item) ? 'knockout' : 'ranked', score_unit: null };
  const rows = previewRows();
  return item.kind === 'spirit' ? renderSpiritList({ rows, division }) : renderResultsTable({ rows, division, item });
}

function renderSavebar() {
  const bar = $('#savebar');
  const s = state.save;
  const label = { idle: '', dirty: '尚未儲存', saving: '儲存中…', saved: `已儲存 ${s.at || ''}`, failed: `儲存失敗：${s.msg || ''}` }[s.kind];
  const cls = { saving: 'saving', saved: 'saved', failed: 'failed', dirty: 'offline' }[s.kind] || '';
  bar.hidden = false;
  bar.querySelector('.wrap').innerHTML = `<span class="save-state ${cls}" role="status" aria-live="polite">${esc(label)}</span>
    <button class="btn" id="btn-save" ${s.kind === 'saving' ? 'disabled' : ''}>儲存（不公布）</button>
    <button class="btn btn-primary" id="btn-publish" ${s.kind === 'saving' ? 'disabled' : ''}>儲存並公布</button>`;
  $('#btn-save').onclick = () => save(false);
  $('#btn-publish').onclick = () => save(true);
}

async function save(publish) {
  const rows = previewRows().map((r) => ({ rank: r.rank, school: r.school, score: r.score || '' }));
  if (publish && !rows.length && !(await confirmDialog('沒有任何學校', '目前沒有填任何學校，「儲存並公布」會把這個項目從公開頁撤下。確定？', '確定撤下'))) return;
  if (publish && rows.length && !(await confirmDialog('儲存並公布', `確定公布「${esc(state.division)}・${esc(state.item)}」共 ${rows.length} 筆？公開頁會立即顯示。`, '確認公布'))) return;
  state.save = { kind: 'saving' }; renderSavebar();
  try {
    const r = await saveItem(state.code, state.division, state.item, publish, rows);
    state.dirty = false;
    state.save = { kind: 'saved', at: r.updated_at ? r.updated_at.slice(11, 16) : '' };
    renderSavebar();
    toast(publish ? '已公布，公開頁 20 秒內更新' : '草稿已儲存（尚未公布）');
    if (publish && deep.fromPublic) { $('#savebar .wrap').insertAdjacentHTML('beforeend', '<a class="btn" href="./">← 回公開頁</a>'); }
    try { await load(); } catch { /* ignore */ }
    view.querySelector('.editor-head .tag').outerHTML = tag(itemStatus(state.division, state.item));
  } catch (err) {
    state.save = { kind: 'failed', msg: err.message }; renderSavebar();
    toast(err.message, 'err');
  }
}

// ---------- 啟動 ----------
// 從公開頁的「登打」按鈕進來：?division=國小組&item=階梯球&from=public → 登入後直接開該項目
const params = new URLSearchParams(location.search);
const deep = { division: params.get('division'), item: params.get('item'), fromPublic: params.get('from') === 'public' };
if (deep.division) state.division = deep.division;
function afterLogin() {
  if (deep.item && state.data.items.includes(deep.item)) { const it = deep.item; deep.item = null; openItem(it); }
  else renderHome();
}
(async () => {
  const code = params.get('code');
  if (code) { state.code = code.trim(); history.replaceState(null, '', location.pathname); }
  if (!API_URL) return renderLogin();
  if (!state.code) return renderLogin();
  try { await load(); try { localStorage.setItem('asr115:code', state.code); } catch { /* ignore */ } afterLogin(); }
  catch (err) { renderLogin(err instanceof ApiError ? err.message : `${err.message}（可稍後再試）`); }
})();
