import { Router } from 'express';
import { query, withTx } from '../db.js';
import { badRequest, notFound, unauthorized } from '../errors.js';
import { createSession, destroySession, hashPassword, verifyPassword, sha256, requireUser } from '../auth.js';
import { audit } from '../audit.js';

export const authRouter = Router();

// 簡易登入嘗試限制（每個 email 每 10 分鐘 10 次）
const attempts = new Map();
function throttle(key) {
  const now = Date.now();
  const rec = attempts.get(key) || { count: 0, reset: now + 600e3 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 600e3; }
  rec.count += 1;
  attempts.set(key, rec);
  return rec.count > 10;
}

function normEmail(e) {
  return String(e || '').trim().toLowerCase();
}

authRouter.post('/login', async (req, res, next) => {
  try {
    const email = normEmail(req.body?.email);
    const password = String(req.body?.password || '');
    if (!email || !password) throw badRequest('請輸入電子郵件與密碼');
    if (throttle(email)) throw unauthorized('嘗試次數過多，請 10 分鐘後再試');
    const { rows } = await query('SELECT * FROM users WHERE email=$1', [email]);
    const u = rows[0];
    if (!u || !u.is_active || !verifyPassword(password, u.password_hash)) throw unauthorized('電子郵件或密碼不正確');
    await createSession(res, u.id);
    await query('UPDATE users SET last_login_at=now() WHERE id=$1', [u.id]);
    res.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role } });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    await destroySession(req, res);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

authRouter.get('/me', (req, res) => {
  res.json({ user: req.user });
});

authRouter.post('/change-password', requireUser, async (req, res, next) => {
  try {
    const current = String(req.body?.current || '');
    const password = String(req.body?.password || '');
    if (password.length < 8) throw badRequest('新密碼至少 8 個字元');
    const { rows } = await query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    if (!verifyPassword(current, rows[0].password_hash)) throw badRequest('目前密碼不正確');
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hashPassword(password), req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

authRouter.get('/invite/:token', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT email, name, role, expires_at, accepted_at FROM invitations WHERE token_hash=$1',
      [sha256(req.params.token)],
    );
    const inv = rows[0];
    if (!inv) throw notFound('邀請連結無效');
    if (inv.accepted_at) throw badRequest('此邀請已使用過，請直接登入');
    if (new Date(inv.expires_at) < new Date()) throw badRequest('邀請連結已過期，請請管理者重新產生');
    res.json({ invitation: { email: inv.email, name: inv.name, role: inv.role } });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/invite/:token/accept', async (req, res, next) => {
  try {
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim();
    if (password.length < 8) throw badRequest('密碼至少 8 個字元');
    const user = await withTx(async (client) => {
      const { rows } = await client.query(
        'SELECT * FROM invitations WHERE token_hash=$1 FOR UPDATE',
        [sha256(req.params.token)],
      );
      const inv = rows[0];
      if (!inv) throw notFound('邀請連結無效');
      if (inv.accepted_at) throw badRequest('此邀請已使用過，請直接登入');
      if (new Date(inv.expires_at) < new Date()) throw badRequest('邀請連結已過期');
      const finalName = name || inv.name;
      const { rows: ur } = await client.query(
        `INSERT INTO users (email, name, role, password_hash, is_active)
         VALUES ($1,$2,$3,$4,TRUE)
         ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, name=EXCLUDED.name, role=EXCLUDED.role, is_active=TRUE
         RETURNING id, email, name, role`,
        [inv.email, finalName, inv.role, hashPassword(password)],
      );
      await client.query('UPDATE invitations SET accepted_at=now() WHERE id=$1', [inv.id]);
      await audit(client, ur[0], 'invite.accept', 'user', ur[0].id, null, { email: inv.email, role: inv.role });
      return ur[0];
    });
    await createSession(res, user.id);
    res.json({ user });
  } catch (e) {
    next(e);
  }
});
