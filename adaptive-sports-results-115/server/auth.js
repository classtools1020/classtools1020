import crypto from 'node:crypto';
import { query } from './db.js';
import { unauthorized, forbidden } from './errors.js';

const SESSION_COOKIE = 'asr_session';
const SESSION_DAYS = 14;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const test = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return test.length === expected.length && crypto.timingSafeEqual(test, expected);
}

export function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

export async function createSession(res, userId) {
  const id = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400e3);
  await query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1,$2,$3)', [id, userId, expires]);
  setSessionCookie(res, id, expires);
  return id;
}

function setSessionCookie(res, id, expires) {
  const secure = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(id)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expires.toUTCString()}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export async function destroySession(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const id = cookies[SESSION_COOKIE];
  if (id) await query('DELETE FROM sessions WHERE id=$1', [id]);
  setSessionCookie(res, '', new Date(0));
}

/** 讀取目前使用者（無登入時 req.user = null）。 */
export async function loadUser(req, _res, next) {
  try {
    req.user = null;
    const cookies = parseCookies(req.headers.cookie);
    const id = cookies[SESSION_COOKIE];
    if (id) {
      const { rows } = await query(
        `SELECT u.id, u.email, u.name, u.role, u.is_active
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id = $1 AND s.expires_at > now()`,
        [id],
      );
      if (rows[0] && rows[0].is_active) req.user = rows[0];
    }
    next();
  } catch (e) {
    next(e);
  }
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(unauthorized());
  // 簡易 CSRF 防護：寫入請求必須帶自訂標頭（瀏覽器跨站表單無法附加）
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'asr') {
    return next(forbidden('缺少必要標頭'));
  }
  next();
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

/** 檢查使用者是否可處理某（組別、項目）。管理者不受限。 */
export async function canAccessSheet(user, divisionId, itemId) {
  if (user.role === 'admin') return true;
  const { rows } = await query(
    'SELECT 1 FROM assignments WHERE user_id=$1 AND division_id=$2 AND item_id=$3',
    [user.id, divisionId, itemId],
  );
  return rows.length > 0;
}
