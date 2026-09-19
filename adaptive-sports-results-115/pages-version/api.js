/* 後台存取層：Supabase（PostgREST）或 Google Apps Script，介面相同。
 * 本機測試可用 ?supabase=http://localhost:8092 或 ?api=http://localhost:8091/exec 覆寫。 */
import * as CFG from './config.js';

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
const q = new URLSearchParams(location.search);
const SUPABASE_URL = (isLocal && q.get('supabase')) || CFG.SUPABASE_URL;
const SUPABASE_KEY = (isLocal && q.get('supabase') ? 'local' : CFG.SUPABASE_ANON_KEY);
const API_URL = (isLocal && q.get('api')) || CFG.API_URL;

export const backend = SUPABASE_URL ? 'supabase' : API_URL ? 'appsscript' : 'none';

class ApiError extends Error {}
export { ApiError };

function netError(msg) { return new Error(msg || '無法連線到後台，請確認網路'); }

// ---------- Supabase ----------
const sbHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
async function sbGet(path) {
  let res;
  try { res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders, cache: 'no-store' }); } catch { throw netError(); }
  if (!res.ok) throw new ApiError(`後台回應 ${res.status}`);
  return res.json();
}
async function sbRpc(fn, args) {
  let res;
  try { res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: sbHeaders, body: JSON.stringify(args) }); } catch { throw netError('無法連線到後台，請確認網路後再按一次'); }
  let data;
  try { data = await res.json(); } catch { throw new ApiError('後台回應格式錯誤'); }
  if (!res.ok) throw new ApiError(data?.message || `後台回應 ${res.status}`);
  if (!data || data.ok !== true) throw new ApiError(data?.error || '後台錯誤');
  return data;
}

// ---------- Apps Script ----------
async function gsGet(params) {
  const u = new URL(API_URL);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  u.searchParams.set('_', Date.now());
  let res;
  try { res = await fetch(u, { redirect: 'follow' }); } catch { throw netError(); }
  const data = await res.json().catch(() => ({ ok: false, error: '後台回應格式錯誤' }));
  if (!data.ok) throw new ApiError(data.error || '後台錯誤');
  return data;
}
async function gsPost(body) {
  let res;
  try { res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' }); } catch { throw netError('無法連線到後台，請確認網路後再按一次'); }
  const data = await res.json().catch(() => ({ ok: false, error: '後台回應格式錯誤' }));
  if (!data.ok) throw new ApiError(data.error || '後台錯誤');
  return data;
}

// ---------- 共用介面 ----------
/** 公開資料：{ announcement, results:[{division,item,rank,school,score,published:true}], updated_at } */
export async function loadPublic() {
  if (backend === 'supabase') {
    const [results, settings] = await Promise.all([sbGet('asr_public_results?select=*&order=division,item,rank'), sbGet('asr_public_settings?select=*')]);
    const updated = results.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), '');
    return { ok: true, announcement: settings.find((s) => s.key === '公告')?.value || '', items: CFG.ITEMS, divisions: CFG.DIVISIONS,
      results: results.map((r) => ({ ...r, score: r.score || '', published: true })), updated_at: updated };
  }
  if (backend === 'appsscript') return gsGet({ action: 'public' });
  throw new ApiError('後台尚未設定');
}

/** 登打人員資料：{ user:{name,role}, announcement, schools, results（含草稿） } */
export async function loadStaff(code) {
  if (backend === 'supabase') { const d = await sbRpc('asr_staff_load', { p_code: code }); return { ...d, items: CFG.ITEMS, divisions: CFG.DIVISIONS }; }
  if (backend === 'appsscript') return gsGet({ action: 'staff', code });
  throw new ApiError('後台尚未設定');
}

export async function saveItem(code, division, item, publish, rows) {
  if (backend === 'supabase') return sbRpc('asr_save_item', { p_code: code, p_division: division, p_item: item, p_publish: publish, p_rows: rows });
  if (backend === 'appsscript') return gsPost({ code, action: 'save', division, item, publish, rows });
  throw new ApiError('後台尚未設定');
}

export async function setAnnouncement(code, text) {
  if (backend === 'supabase') return sbRpc('asr_set_announcement', { p_code: code, p_text: text });
  if (backend === 'appsscript') return gsPost({ code, action: 'announce', text });
  throw new ApiError('後台尚未設定');
}
