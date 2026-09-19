import { Router } from 'express';
import { query, withTx } from '../db.js';
import { requireUser, requireRole, sha256, randomToken } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { audit } from '../audit.js';
import { activeEvent } from '../sheets.js';

export const adminRouter = Router();
adminRouter.use(requireUser, requireRole('admin'));

const ROLES = ['admin', 'entry', 'reviewer'];
const num = (v, name) => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw badRequest(`${name} 格式錯誤`);
  return n;
};
const text = (v, name, max = 60, required = true) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw badRequest(`請填寫${name}`);
  if (s.length > max) throw badRequest(`${name} 過長`);
  return s;
};

// ---------- 使用者與邀請 ----------
adminRouter.get('/users', async (_req, res, next) => {
  try {
    const { rows: users } = await query(
      `SELECT u.id, u.email, u.name, u.role, u.is_active, u.last_login_at, (u.password_hash IS NOT NULL) AS has_password,
              COALESCE(json_agg(json_build_object('division_id', a.division_id, 'item_id', a.item_id)) FILTER (WHERE a.user_id IS NOT NULL), '[]') AS assignments
         FROM users u LEFT JOIN assignments a ON a.user_id=u.id
        GROUP BY u.id ORDER BY u.role, u.name`,
    );
    const { rows: invitations } = await query(
      `SELECT id, email, name, role, created_at, expires_at, accepted_at FROM invitations
        WHERE accepted_at IS NULL AND expires_at > now() ORDER BY id DESC`,
    );
    res.json({ users, invitations });
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/invitations', async (req, res, next) => {
  try {
    const email = text(req.body?.email, '電子郵件', 120).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('電子郵件格式不正確');
    const name = text(req.body?.name, '姓名', 40);
    const role = String(req.body?.role || 'entry');
    if (!ROLES.includes(role)) throw badRequest('角色不正確');
    const token = randomToken(24);
    const result = await withTx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO invitations (email, name, role, token_hash, created_by, expires_at)
         VALUES ($1,$2,$3,$4,$5, now() + interval '7 days') RETURNING id, expires_at`,
        [email, name, role, sha256(token), req.user.id],
      );
      // 已存在的使用者可用邀請重設密碼／角色；分工可先行指定
      const { rows: existing } = await client.query('SELECT id FROM users WHERE email=$1', [email]);
      if (!existing[0]) {
        await client.query(
          `INSERT INTO users (email, name, role, password_hash, is_active) VALUES ($1,$2,$3,NULL,TRUE)
           ON CONFLICT (email) DO NOTHING`,
          [email, name, role],
        );
      }
      await audit(client, req.user, 'invite.create', 'invitation', rows[0].id, null, { email, name, role });
      return rows[0];
    });
    const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    res.json({ invitation: { id: result.id, email, name, role, expires_at: result.expires_at, link: `${base}/staff/invite/${token}` } });
  } catch (e) {
    next(e);
  }
});

adminRouter.delete('/invitations/:id', async (req, res, next) => {
  try {
    await query('DELETE FROM invitations WHERE id=$1 AND accepted_at IS NULL', [num(req.params.id, 'id')]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

adminRouter.patch('/users/:id', async (req, res, next) => {
  try {
    const id = num(req.params.id, 'id');
    const patch = {};
    if (req.body?.role != null) {
      if (!ROLES.includes(req.body.role)) throw badRequest('角色不正確');
      patch.role = req.body.role;
    }
    if (req.body?.name != null) patch.name = text(req.body.name, '姓名', 40);
    if (req.body?.is_active != null) patch.is_active = Boolean(req.body.is_active);
    if (id === req.user.id && (patch.role && patch.role !== 'admin' || patch.is_active === false)) {
      throw badRequest('不能取消自己的管理者權限或停用自己');
    }
    await withTx(async (client) => {
      const { rows } = await client.query('SELECT id, name, role, is_active FROM users WHERE id=$1', [id]);
      if (!rows[0]) throw notFound();
      const keys = Object.keys(patch);
      if (keys.length) {
        await client.query(
          `UPDATE users SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')} WHERE id=$1`,
          [id, ...keys.map((k) => patch[k])],
        );
        if (patch.is_active === false) await client.query('DELETE FROM sessions WHERE user_id=$1', [id]);
      }
      await audit(client, req.user, 'user.update', 'user', id, rows[0], patch);
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

adminRouter.put('/users/:id/assignments', async (req, res, next) => {
  try {
    const id = num(req.params.id, 'id');
    const list = Array.isArray(req.body?.assignments) ? req.body.assignments : null;
    if (!list) throw badRequest('assignments 必須是陣列');
    await withTx(async (client) => {
      const { rows: before } = await client.query('SELECT division_id, item_id FROM assignments WHERE user_id=$1', [id]);
      await client.query('DELETE FROM assignments WHERE user_id=$1', [id]);
      for (const a of list) {
        await client.query(
          'INSERT INTO assignments (user_id, division_id, item_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [id, num(a.division_id, 'division_id'), num(a.item_id, 'item_id')],
        );
      }
      await audit(client, req.user, 'user.assign', 'user', id, before, list);
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- 學校與隊伍 ----------
adminRouter.post('/schools', async (req, res, next) => {
  try {
    const ev = await activeEvent();
    const name = text(req.body?.name, '學校名稱', 60);
    const divisionIds = Array.isArray(req.body?.division_ids) ? req.body.division_ids.map((x) => num(x, 'division_id')) : [];
    const school = await withTx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO schools (event_id, name, short_name, sort_order) VALUES ($1,$2,$3,$4)
         ON CONFLICT (event_id, name) DO UPDATE SET short_name=COALESCE(EXCLUDED.short_name, schools.short_name)
         RETURNING id, name`,
        [ev.id, name, text(req.body?.short_name, '簡稱', 20, false) || null, num(req.body?.sort_order ?? 0, 'sort_order')],
      );
      for (const d of divisionIds) {
        await client.query(
          `INSERT INTO teams (event_id, division_id, school_id, label) VALUES ($1,$2,$3,'') ON CONFLICT DO NOTHING`,
          [ev.id, d, rows[0].id],
        );
      }
      await audit(client, req.user, 'school.upsert', 'school', rows[0].id, null, { name, divisionIds });
      return rows[0];
    });
    res.json({ school });
  } catch (e) {
    next(e);
  }
});

/** 批次建立：每行一所學校，可用 Tab 或逗號分隔簡稱。 */
adminRouter.post('/schools/bulk', async (req, res, next) => {
  try {
    const ev = await activeEvent();
    const lines = String(req.body?.text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const divisionIds = Array.isArray(req.body?.division_ids) ? req.body.division_ids.map((x) => num(x, 'division_id')) : [];
    if (!lines.length) throw badRequest('請貼上學校名稱，每行一所');
    if (lines.length > 100) throw badRequest('一次最多 100 所');
    let created = 0;
    await withTx(async (client) => {
      for (const line of lines) {
        const [name, short] = line.split(/[\t,，]/).map((s) => s.trim());
        if (name.length > 60) throw badRequest(`學校名稱過長：${name}`);
        const { rows } = await client.query(
          `INSERT INTO schools (event_id, name, short_name) VALUES ($1,$2,$3)
           ON CONFLICT (event_id, name) DO UPDATE SET short_name=COALESCE(EXCLUDED.short_name, schools.short_name) RETURNING id`,
          [ev.id, name, short || null],
        );
        for (const d of divisionIds) {
          await client.query(
            `INSERT INTO teams (event_id, division_id, school_id, label) VALUES ($1,$2,$3,'') ON CONFLICT DO NOTHING`,
            [ev.id, d, rows[0].id],
          );
        }
        created += 1;
      }
      await audit(client, req.user, 'school.bulk', 'school', null, null, { count: created, divisionIds });
    });
    res.json({ ok: true, count: created });
  } catch (e) {
    next(e);
  }
});

adminRouter.patch('/schools/:id', async (req, res, next) => {
  try {
    const id = num(req.params.id, 'id');
    const name = text(req.body?.name, '學校名稱', 60);
    await withTx(async (client) => {
      const { rows } = await client.query('SELECT name, short_name FROM schools WHERE id=$1', [id]);
      if (!rows[0]) throw notFound();
      await client.query('UPDATE schools SET name=$2, short_name=$3, sort_order=$4 WHERE id=$1',
        [id, name, text(req.body?.short_name, '簡稱', 20, false) || null, num(req.body?.sort_order ?? 0, 'sort_order')]);
      await audit(client, req.user, 'school.update', 'school', id, rows[0], { name });
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

adminRouter.delete('/schools/:id', async (req, res, next) => {
  try {
    const id = num(req.params.id, 'id');
    await withTx(async (client) => {
      const { rows } = await client.query(
        'SELECT count(*)::int AS c FROM sheet_rows r JOIN teams t ON t.id=r.team_id WHERE t.school_id=$1', [id]);
      if (rows[0].c > 0) throw badRequest('此學校已有成績紀錄，無法刪除；可改為停用隊伍');
      const { rows: before } = await client.query('SELECT name FROM schools WHERE id=$1', [id]);
      await client.query('DELETE FROM schools WHERE id=$1', [id]);
      await audit(client, req.user, 'school.delete', 'school', id, before[0], null);
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/teams', async (req, res, next) => {
  try {
    const ev = await activeEvent();
    const schoolId = num(req.body?.school_id, 'school_id');
    const divisionId = num(req.body?.division_id, 'division_id');
    const label = text(req.body?.label, '隊伍名稱', 20, false);
    const { rows } = await query(
      `INSERT INTO teams (event_id, division_id, school_id, label) VALUES ($1,$2,$3,$4)
       ON CONFLICT (division_id, school_id, label) DO UPDATE SET is_active=TRUE RETURNING id`,
      [ev.id, divisionId, schoolId, label],
    );
    res.json({ team: rows[0] });
  } catch (e) {
    next(e);
  }
});

adminRouter.patch('/teams/:id', async (req, res, next) => {
  try {
    const id = num(req.params.id, 'id');
    const isActive = Boolean(req.body?.is_active);
    await query('UPDATE teams SET is_active=$2 WHERE id=$1', [id, isActive]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

adminRouter.delete('/teams/:id', async (req, res, next) => {
  try {
    const id = num(req.params.id, 'id');
    const { rows } = await query('SELECT count(*)::int AS c FROM sheet_rows WHERE team_id=$1', [id]);
    if (rows[0].c > 0) throw badRequest('此隊伍已有成績紀錄，無法刪除；可改為停用');
    await query('DELETE FROM teams WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- 項目 ----------
adminRouter.post('/items', async (req, res, next) => {
  try {
    const ev = await activeEvent();
    const name = text(req.body?.name, '項目名稱', 40);
    const kind = ['ranked', 'knockout', 'spirit'].includes(req.body?.kind) ? req.body.kind : 'ranked';
    const scoreKind = ['none', 'number', 'text'].includes(req.body?.score_kind) ? req.body.score_kind : 'none';
    const { rows } = await query(
      `INSERT INTO items (event_id, name, kind, score_kind, score_unit, score_min, score_max, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [ev.id, name, kind, scoreKind, text(req.body?.score_unit, '單位', 10, false) || null,
        req.body?.score_min ?? null, req.body?.score_max ?? null, num(req.body?.sort_order ?? 99, 'sort_order')],
    );
    res.json({ item: rows[0] });
  } catch (e) {
    next(e);
  }
});

adminRouter.patch('/items/:id', async (req, res, next) => {
  try {
    const id = num(req.params.id, 'id');
    const b = req.body || {};
    const scoreKind = ['none', 'number', 'text'].includes(b.score_kind) ? b.score_kind : 'none';
    await withTx(async (client) => {
      const { rows } = await client.query('SELECT name, kind, score_kind, score_unit, score_min, score_max, is_active FROM items WHERE id=$1', [id]);
      if (!rows[0]) throw notFound();
      await client.query(
        `UPDATE items SET name=$2, score_kind=$3, score_unit=$4, score_min=$5, score_max=$6, sort_order=$7, is_active=$8 WHERE id=$1`,
        [id, text(b.name, '項目名稱', 40), scoreKind, text(b.score_unit, '單位', 10, false) || null,
          b.score_min === '' || b.score_min == null ? null : Number(b.score_min),
          b.score_max === '' || b.score_max == null ? null : Number(b.score_max),
          num(b.sort_order ?? 99, 'sort_order'), b.is_active == null ? true : Boolean(b.is_active)],
      );
      await audit(client, req.user, 'item.update', 'item', id, rows[0], b);
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

adminRouter.patch('/event', async (req, res, next) => {
  try {
    const ev = await activeEvent();
    const b = req.body || {};
    await withTx(async (client) => {
      await client.query(
        'UPDATE events SET name=$2, edition=$3, event_date=$4, venue=$5, organizer=$6 WHERE id=$1',
        [ev.id, text(b.name, '活動名稱', 120), text(b.edition, '屆次', 40, false) || null, b.event_date || null,
          text(b.venue, '場地', 80, false) || null, text(b.organizer, '承辦單位', 80, false) || null],
      );
      await audit(client, req.user, 'event.update', 'event', ev.id, ev, b);
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

adminRouter.patch('/divisions/:id', async (req, res, next) => {
  try {
    const id = num(req.params.id, 'id');
    const award = num(req.body?.award_places, '名次上限');
    const spirit = num(req.body?.spirit_places, '精神總錦標名額');
    if (award < 1 || award > 30 || spirit < 1 || spirit > 30) throw badRequest('名額須介於 1–30');
    await query('UPDATE divisions SET award_places=$2, spirit_places=$3 WHERE id=$1', [id, award, spirit]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
