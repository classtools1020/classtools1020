import { Router } from 'express';
import { query } from '../db.js';
import { badRequest, unauthorized } from '../errors.js';
import { createSession, destroySession, normalizeCode } from '../auth.js';

export const authRouter = Router();

// 登入嘗試限制：每個來源 IP 每 10 分鐘最多 20 次「失敗」（認證碼為 6 位數字，需防止暴力猜測）
const attempts = new Map();
function blocked(key, limit = 20) {
  const rec = attempts.get(key);
  return rec && Date.now() < rec.reset && rec.count >= limit;
}
function recordFailure(key) {
  const now = Date.now();
  const rec = attempts.get(key) || { count: 0, reset: now + 600e3 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 600e3; }
  rec.count += 1;
  attempts.set(key, rec);
  if (attempts.size > 5000) attempts.clear();
}

authRouter.post('/login', async (req, res, next) => {
  try {
    const code = normalizeCode(req.body?.code);
    if (!code) throw badRequest('請輸入認證碼');
    if (code.length < 6 || code.length > 20) throw unauthorized('認證碼不正確');
    if (blocked(req.ip)) throw unauthorized('嘗試次數過多，請 10 分鐘後再試');
    const { rows } = await query('SELECT id, name, role, is_active FROM users WHERE access_code=$1', [code]);
    const u = rows[0];
    if (!u || !u.is_active) { recordFailure(req.ip); throw unauthorized('認證碼不正確或已停用'); }
    attempts.delete(req.ip);
    await createSession(res, u.id);
    await query('UPDATE users SET last_login_at=now() WHERE id=$1', [u.id]);
    res.json({ user: { id: u.id, name: u.name, role: u.role } });
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
