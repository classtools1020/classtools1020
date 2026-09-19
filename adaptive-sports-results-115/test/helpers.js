import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://app:app@127.0.0.1:5432/adaptive_sports_test';
export const PORT = Number(process.env.TEST_PORT || 3100);
export const BASE = `http://127.0.0.1:${PORT}`;

const env = { ...process.env, DATABASE_URL: TEST_DB, ACTIVE_EVENT_SLUG: 'demo-adaptive-sports', PORT: String(PORT), PUBLIC_URL: BASE, NODE_ENV: 'test' };

/** 重建測試資料庫（結構 + 示範資料），並啟動伺服器。 */
export async function startServer() {
  execSync(`psql "${TEST_DB}" -q -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"`, { stdio: 'pipe' });
  execSync('node scripts/migrate.js', { cwd: root, env, stdio: 'pipe' });
  execSync('node scripts/seed.js --demo', { cwd: root, env, stdio: 'pipe' });
  const child = spawn('node', ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', (d) => process.stderr.write(d));
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return child; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('伺服器未啟動');
}

/** 以 cookie 保存登入狀態的簡易 client。 */
export function client() {
  let cookie = '';
  async function call(method, url, body) {
    const res = await fetch(BASE + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'asr', ...(cookie ? { Cookie: cookie } : {}) },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  return {
    call,
    login: (code) => call('POST', '/api/auth/login', { code }),
    get cookie() { return cookie; },
  };
}

// 示範認證碼（scripts/seed.js --demo）
export const ACCOUNTS = { admin: 'DEMOADMIN', entry1: '111111', entry2: '222222', reviewer: '333333' };
