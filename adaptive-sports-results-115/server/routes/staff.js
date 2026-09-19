import { Router } from 'express';
import { query, pool } from '../db.js';
import { requireUser, requireRole, canAccessSheet } from '../auth.js';
import { forbidden, badRequest } from '../errors.js';
import { activeEvent, loadSheet, saveDraft, submitSheet, returnSheet, publishSheet, reviseSheet, statusLabel } from '../sheets.js';

export const staffRouter = Router();
staffRouter.use(requireUser);

function ids(req) {
  const d = Number(req.params.divisionId);
  const i = Number(req.params.itemId);
  if (!Number.isInteger(d) || !Number.isInteger(i)) throw badRequest('參數錯誤');
  return [d, i];
}

/** 登入後的初始資料：活動、組別、項目、學校、隊伍、我的分工、各成績表狀態。 */
staffRouter.get('/bootstrap', async (req, res, next) => {
  try {
    const ev = await activeEvent();
    const [divisions, items, schools, teams, assignments, sheets] = await Promise.all([
      query('SELECT id, code, name, award_places, spirit_places FROM divisions WHERE event_id=$1 ORDER BY sort_order, id', [ev.id]),
      query('SELECT id, name, kind, score_kind, score_unit, score_min, score_max, sort_order, is_active FROM items WHERE event_id=$1 ORDER BY sort_order, id', [ev.id]),
      query('SELECT id, name, short_name, sort_order FROM schools WHERE event_id=$1 ORDER BY sort_order, name', [ev.id]),
      query('SELECT id, division_id, school_id, label, is_active FROM teams WHERE event_id=$1', [ev.id]),
      req.user.role === 'admin'
        ? Promise.resolve({ rows: [] })
        : query('SELECT division_id, item_id FROM assignments WHERE user_id=$1', [req.user.id]),
      query(
        `SELECT s.division_id, s.item_id, s.status, s.version, s.revision, s.updated_at, u.name AS updated_by_name,
                (SELECT count(*) FROM sheet_rows r WHERE r.sheet_id=s.id)::int AS row_count
           FROM sheets s LEFT JOIN users u ON u.id=s.updated_by WHERE s.event_id=$1`,
        [ev.id],
      ),
    ]);
    res.json({
      user: req.user,
      event: ev,
      divisions: divisions.rows,
      items: items.rows,
      schools: schools.rows,
      teams: teams.rows,
      assignments: assignments.rows,
      sheets: sheets.rows,
    });
  } catch (e) {
    next(e);
  }
});

staffRouter.get('/sheets/:divisionId/:itemId', async (req, res, next) => {
  try {
    const [d, i] = ids(req);
    if (!(await canAccessSheet(req.user, d, i))) throw forbidden('您未被指派此組別／項目');
    const client = await pool.connect();
    try {
      const sheet = await loadSheet(client, d, i);
      res.json({ sheet });
    } finally {
      client.release();
    }
  } catch (e) {
    next(e);
  }
});

staffRouter.put('/sheets/:divisionId/:itemId', async (req, res, next) => {
  try { const [d, i] = ids(req); res.json(await saveDraft(req.user, d, i, req.body || {})); } catch (e) { next(e); }
});
staffRouter.post('/sheets/:divisionId/:itemId/submit', async (req, res, next) => {
  try { const [d, i] = ids(req); res.json(await submitSheet(req.user, d, i, req.body || {})); } catch (e) { next(e); }
});
staffRouter.post('/sheets/:divisionId/:itemId/return', async (req, res, next) => {
  try { const [d, i] = ids(req); res.json(await returnSheet(req.user, d, i, req.body || {})); } catch (e) { next(e); }
});
staffRouter.post('/sheets/:divisionId/:itemId/publish', async (req, res, next) => {
  try { const [d, i] = ids(req); res.json(await publishSheet(req.user, d, i, req.body || {})); } catch (e) { next(e); }
});
staffRouter.post('/sheets/:divisionId/:itemId/revise', async (req, res, next) => {
  try { const [d, i] = ids(req); res.json(await reviseSheet(req.user, d, i, req.body || {})); } catch (e) { next(e); }
});

/** 操作紀錄（管理者、複核人員可看全部；輸入人員只看自己負責的表）。 */
staffRouter.get('/audit', async (req, res, next) => {
  try {
    const d = Number(req.query.division_id);
    const i = Number(req.query.item_id);
    let sql = `SELECT a.id, a.at, a.user_name, a.action, a.entity, a.entity_id, a.before, a.after
                 FROM audit_log a`;
    const params = [];
    if (Number.isInteger(d) && Number.isInteger(i)) {
      if (!(await canAccessSheet(req.user, d, i))) throw forbidden();
      sql += ` JOIN sheets s ON s.id=a.entity_id AND a.entity='sheet' WHERE s.division_id=$1 AND s.item_id=$2`;
      params.push(d, i);
    } else if (req.user.role === 'entry') {
      throw forbidden('請指定組別與項目');
    }
    sql += ' ORDER BY a.id DESC LIMIT 200';
    const { rows } = await query(sql, params);
    res.json({ log: rows });
  } catch (e) {
    next(e);
  }
});

/** CSV 匯出：scope=published（預設，只含已公布）或 all（含草稿與待複核）。 */
staffRouter.get('/export.csv', requireRole('admin', 'reviewer'), async (req, res, next) => {
  try {
    const ev = await activeEvent();
    const scope = req.query.scope === 'all' ? 'all' : 'published';
    let rows;
    if (scope === 'published') {
      const r = await query(
        `SELECT d.name AS division, it.name AS item, it.score_unit, p.revision, p.published_at, p.rows
           FROM publications p JOIN divisions d ON d.id=p.division_id JOIN items it ON it.id=p.item_id
          WHERE p.event_id=$1 AND p.is_current ORDER BY d.sort_order, it.sort_order`,
        [ev.id],
      );
      rows = [];
      for (const p of r.rows) {
        for (const x of p.rows) {
          rows.push([p.division, p.item, x.rank, x.tied ? '並列' : '', x.school, x.label, x.score ?? '', p.score_unit ?? '', x.remark ?? '', '已公布', p.revision, fmt(p.published_at)]);
        }
      }
    } else {
      const r = await query(
        `SELECT d.name AS division, it.name AS item, it.score_unit, s.status, s.revision, s.updated_at,
                r.rank, r.tied, r.score, r.remark, sc.name AS school, t.label
           FROM sheets s JOIN divisions d ON d.id=s.division_id JOIN items it ON it.id=s.item_id
           JOIN sheet_rows r ON r.sheet_id=s.id JOIN teams t ON t.id=r.team_id JOIN schools sc ON sc.id=t.school_id
          WHERE s.event_id=$1 ORDER BY d.sort_order, it.sort_order, r.rank, sc.name`,
        [ev.id],
      );
      rows = r.rows.map((x) => [x.division, x.item, x.rank, x.tied ? '並列' : '', x.school, x.label, x.score ?? '', x.score_unit ?? '', x.remark ?? '', statusLabel(x.status), x.revision, fmt(x.updated_at)]);
    }
    const header = ['組別', '項目', '名次', '並列', '學校', '隊伍', '成績', '單位', '備註', '狀態', '版次', '時間'];
    const csv = '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    res.setHeader('Content-Disposition', `attachment; filename="results-${scope}.csv"`);
    res.type('text/csv; charset=utf-8').send(csv);
  } catch (e) {
    next(e);
  }
});

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function fmt(d) {
  return d ? new Date(d).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '';
}
