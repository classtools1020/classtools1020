/** 建立或重設第一位管理者：ADMIN_EMAIL=... ADMIN_NAME=... ADMIN_PASSWORD=... npm run admin:create */
import { pool } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const name = process.env.ADMIN_NAME || '管理者';
const password = process.env.ADMIN_PASSWORD || '';
if (!email || password.length < 8) {
  console.error('請設定 ADMIN_EMAIL 與 ADMIN_PASSWORD（至少 8 個字元）');
  process.exit(1);
}
await pool.query(
  `INSERT INTO users (email, name, role, password_hash, is_active) VALUES ($1,$2,'admin',$3,TRUE)
   ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, role='admin', is_active=TRUE, name=EXCLUDED.name`,
  [email, name, hashPassword(password)],
);
console.log(`管理者 ${email} 已建立／更新。`);
await pool.end();
