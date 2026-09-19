/** 刪除示範活動與示範帳號（正式資料不受影響）。 */
import { pool } from '../server/db.js';
const r = await pool.query('DELETE FROM events WHERE is_demo RETURNING id');
await pool.query("DELETE FROM users WHERE note='示範帳號'");
console.log(`已刪除 ${r.rowCount} 個示範活動與示範帳號。`);
await pool.end();
