import { query, withTx } from './db.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';
import { canAccessSheet } from './auth.js';
import { audit } from './audit.js';

const MAX_ROWS = 60;

export async function activeEvent() {
  const slug = process.env.ACTIVE_EVENT_SLUG;
  const { rows } = slug
    ? await query('SELECT * FROM events WHERE slug=$1', [slug])
    : await query('SELECT * FROM events WHERE is_active ORDER BY is_demo, id LIMIT 1');
  if (!rows[0]) throw notFound('尚未建立活動，請先執行 npm run db:seed');
  return rows[0];
}

export async function loadSheet(client, divisionId, itemId) {
  const { rows } = await client.query(
    `SELECT s.*, u.name AS updated_by_name, su.name AS submitted_by_name
       FROM sheets s LEFT JOIN users u ON u.id=s.updated_by LEFT JOIN users su ON su.id=s.submitted_by
      WHERE s.division_id=$1 AND s.item_id=$2`,
    [divisionId, itemId],
  );
  const sheet = rows[0];
  if (!sheet) return null;
  const { rows: srows } = await client.query(
    `SELECT r.id, r.team_id, r.rank, r.tied, r.score, r.remark, t.label, sc.name AS school
       FROM sheet_rows r JOIN teams t ON t.id=r.team_id JOIN schools sc ON sc.id=t.school_id
      WHERE r.sheet_id=$1 ORDER BY r.rank, sc.sort_order, sc.name`,
    [sheet.id],
  );
  sheet.rows = srows;
  return sheet;
}

/** 驗證輸入格式與合理範圍。回傳整理後的列。 */
export async function validateRows(client, divisionId, item, rawRows) {
  if (!Array.isArray(rawRows)) throw badRequest('rows 必須是陣列');
  if (rawRows.length > MAX_ROWS) throw badRequest(`最多 ${MAX_ROWS} 筆`);
  const { rows: teams } = await client.query(
    'SELECT id FROM teams WHERE division_id=$1 AND is_active', [divisionId],
  );
  const teamIds = new Set(teams.map((t) => t.id));
  const seenTeam = new Set();
  const byRank = new Map();
  const out = [];
  const errors = [];
  rawRows.forEach((r, idx) => {
    const line = idx + 1;
    const teamId = Number(r.team_id);
    const rank = Number(r.rank);
    if (!teamIds.has(teamId)) { errors.push(`第 ${line} 列：學校／隊伍不在此組別名單中`); return; }
    if (seenTeam.has(teamId)) { errors.push(`第 ${line} 列：同一隊伍重複輸入`); return; }
    seenTeam.add(teamId);
    if (!Number.isInteger(rank) || rank < 1 || rank > 99) { errors.push(`第 ${line} 列：名次必須是 1–99 的整數`); return; }
    let score = r.score == null ? null : String(r.score).trim();
    if (score === '') score = null;
    if (score != null) {
      if (score.length > 40) errors.push(`第 ${line} 列：成績過長`);
      if (item.score_kind === 'number') {
        const n = Number(score);
        if (!Number.isFinite(n)) errors.push(`第 ${line} 列：成績必須是數字`);
        else {
          if (item.score_min != null && n < Number(item.score_min)) errors.push(`第 ${line} 列：成績低於下限 ${item.score_min}`);
          if (item.score_max != null && n > Number(item.score_max)) errors.push(`第 ${line} 列：成績高於上限 ${item.score_max}`);
        }
      }
    }
    const remark = r.remark == null ? null : String(r.remark).trim().slice(0, 100) || null;
    const tied = Boolean(r.tied);
    if (!byRank.has(rank)) byRank.set(rank, []);
    byRank.get(rank).push({ line, tied });
    out.push({ team_id: teamId, rank, tied, score, remark });
  });
  for (const [rank, list] of byRank) {
    if (list.length > 1 && list.some((x) => !x.tied)) {
      errors.push(`第 ${rank} 名有 ${list.length} 隊，若為並列請勾選每一列的「並列」；否則請修正名次`);
    }
  }
  if (errors.length) throw badRequest('資料檢查未通過', { errors });
  return out;
}

async function requireAccess(user, divisionId, itemId) {
  if (!(await canAccessSheet(user, divisionId, itemId))) throw forbidden('您未被指派此組別／項目');
}

async function withIdempotency(client, user, opId, fn) {
  if (opId) {
    if (typeof opId !== 'string' || opId.length > 80) throw badRequest('opId 格式錯誤');
    const { rows } = await client.query('SELECT result FROM client_ops WHERE op_id=$1 AND user_id=$2', [opId, user.id]);
    if (rows[0]) return { replay: true, ...rows[0].result };
  }
  const result = await fn();
  if (opId) {
    await client.query('INSERT INTO client_ops (op_id, user_id, result) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [opId, user.id, JSON.stringify(result)]);
  }
  return result;
}

function checkVersion(sheet, version) {
  if (version == null) throw badRequest('缺少 version');
  if (Number(version) !== sheet.version) {
    throw conflict('這份成績表已被其他人更新，請先檢視最新內容再儲存', { current: sheet });
  }
}

/** 儲存草稿（entry / admin）。 */
export async function saveDraft(user, divisionId, itemId, body) {
  if (!['entry', 'admin'].includes(user.role)) throw forbidden('只有成績輸入人員或管理者可以編輯草稿');
  await requireAccess(user, divisionId, itemId);
  return withTx(async (client) => withIdempotency(client, user, body.opId, async () => {
    const ev = await activeEvent();
    const { rows: items } = await client.query('SELECT * FROM items WHERE id=$1 AND event_id=$2', [itemId, ev.id]);
    const item = items[0];
    if (!item) throw notFound('項目不存在');
    const { rows: divs } = await client.query('SELECT id FROM divisions WHERE id=$1 AND event_id=$2', [divisionId, ev.id]);
    if (!divs[0]) throw notFound('組別不存在');
    const rows = await validateRows(client, divisionId, item, body.rows || []);
    const note = body.note == null ? null : String(body.note).trim().slice(0, 300) || null;

    await client.query('SELECT pg_advisory_xact_lock($1)', [divisionId * 100000 + itemId]);
    let sheet = await loadSheet(client, divisionId, itemId);
    if (!sheet) {
      if (body.version != null && Number(body.version) !== 0) throw conflict('這份成績表狀態已變更，請重新載入', { current: null });
      await client.query(
        'INSERT INTO sheets (event_id, division_id, item_id, status, version, updated_by) VALUES ($1,$2,$3,$4,0,$5)',
        [ev.id, divisionId, itemId, 'draft', user.id],
      );
      sheet = await loadSheet(client, divisionId, itemId);
    } else {
      checkVersion(sheet, body.version);
    }
    if (sheet.status === 'pending') throw conflict('此成績表已送複核，若需修改請由複核人員退回', { current: sheet });
    if (sheet.status === 'published') throw conflict('此成績表已公布，請先建立修訂草稿', { current: sheet });

    const before = { status: sheet.status, note: sheet.note, rows: sheet.rows.map(pickRow) };
    await client.query('DELETE FROM sheet_rows WHERE sheet_id=$1', [sheet.id]);
    for (const r of rows) {
      await client.query(
        'INSERT INTO sheet_rows (sheet_id, team_id, rank, tied, score, remark) VALUES ($1,$2,$3,$4,$5,$6)',
        [sheet.id, r.team_id, r.rank, r.tied, r.score, r.remark],
      );
    }
    await client.query(
      'UPDATE sheets SET version=version+1, note=$2, updated_by=$3, updated_at=now(), return_note=return_note WHERE id=$1',
      [sheet.id, note, user.id],
    );
    const after = await loadSheet(client, divisionId, itemId);
    await audit(client, user, 'sheet.save', 'sheet', sheet.id, before, { status: after.status, note: after.note, rows: after.rows.map(pickRow) });
    return { sheet: after };
  }));
}

function pickRow(r) {
  return { school: r.school, label: r.label, team_id: r.team_id, rank: r.rank, tied: r.tied, score: r.score, remark: r.remark };
}

async function transition(user, divisionId, itemId, body, { roles, from, to, action, extra }) {
  if (!roles.includes(user.role)) throw forbidden();
  await requireAccess(user, divisionId, itemId);
  return withTx(async (client) => withIdempotency(client, user, body.opId, async () => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [divisionId * 100000 + itemId]);
    const sheet = await loadSheet(client, divisionId, itemId);
    if (!sheet) throw notFound('尚未有草稿');
    checkVersion(sheet, body.version);
    if (!from.includes(sheet.status)) throw conflict(`目前狀態為「${statusLabel(sheet.status)}」，無法執行此操作`, { current: sheet });
    const before = { status: sheet.status, revision: sheet.revision, return_note: sheet.return_note };
    await extra?.(client, sheet);
    await client.query(
      `UPDATE sheets SET status=$2, version=version+1, updated_by=$3, updated_at=now(),
              submitted_by = CASE WHEN $2='pending' THEN $3 ELSE submitted_by END,
              submitted_at = CASE WHEN $2='pending' THEN now() ELSE submitted_at END
        WHERE id=$1`,
      [sheet.id, to, user.id],
    );
    const after = await loadSheet(client, divisionId, itemId);
    await audit(client, user, action, 'sheet', sheet.id, before, { status: after.status, revision: after.revision, return_note: after.return_note, rows: after.rows.map(pickRow) });
    return { sheet: after };
  }));
}

export function statusLabel(s) {
  return { draft: '草稿', pending: '待複核', published: '已公布' }[s] || s;
}

export const submitSheet = (user, d, i, body) =>
  transition(user, d, i, body, {
    roles: ['entry', 'admin'], from: ['draft'], to: 'pending', action: 'sheet.submit',
    extra: async (client, sheet) => {
      if (!sheet.rows.length) throw badRequest('尚未輸入任何成績，無法送複核');
      await client.query('UPDATE sheets SET return_note=NULL WHERE id=$1', [sheet.id]);
    },
  });

export const returnSheet = (user, d, i, body) =>
  transition(user, d, i, body, {
    roles: ['reviewer', 'admin'], from: ['pending'], to: 'draft', action: 'sheet.return',
    extra: async (client, sheet) => {
      const note = String(body.note || '').trim().slice(0, 300);
      if (!note) throw badRequest('請填寫退回原因');
      await client.query('UPDATE sheets SET return_note=$2 WHERE id=$1', [sheet.id, note]);
    },
  });

export const publishSheet = (user, d, i, body) =>
  transition(user, d, i, body, {
    roles: ['reviewer', 'admin'], from: ['pending'], to: 'published', action: 'sheet.publish',
    extra: async (client, sheet) => {
      const snapshot = sheet.rows.map((r) => ({ rank: r.rank, tied: r.tied, school: r.school, label: r.label, score: r.score, remark: r.remark }));
      await client.query('UPDATE publications SET is_current=FALSE WHERE division_id=$1 AND item_id=$2 AND is_current', [d, i]);
      await client.query(
        `INSERT INTO publications (sheet_id, event_id, division_id, item_id, revision, rows, published_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [sheet.id, sheet.event_id, d, i, sheet.revision, JSON.stringify(snapshot), user.id],
      );
    },
  });

export const reviseSheet = (user, d, i, body) =>
  transition(user, d, i, body, {
    roles: ['entry', 'reviewer', 'admin'], from: ['published'], to: 'draft', action: 'sheet.revise',
    extra: async (client, sheet) => {
      await client.query('UPDATE sheets SET revision=revision+1, return_note=NULL WHERE id=$1', [sheet.id]);
    },
  });
