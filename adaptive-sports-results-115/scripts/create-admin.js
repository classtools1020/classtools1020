/** 建立或重設管理者：ADMIN_CODE=至少8字元 ADMIN_NAME=曾老師 npm run admin:create（伺服器啟動時也會自動讀取 ADMIN_CODE）。 */
import { pool } from '../server/db.js';
import { ensureAdminFromEnv } from '../server/auth.js';
if (!process.env.ADMIN_CODE) { console.error('請設定 ADMIN_CODE（至少 8 個字元）'); process.exit(1); }
await ensureAdminFromEnv();
await pool.end();
