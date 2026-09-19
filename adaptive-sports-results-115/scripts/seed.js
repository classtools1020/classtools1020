/**
 * 建立正式活動資料（組別、11 個競賽項目、精神總錦標），不含任何成績與學校。
 * 加上 --demo 則另外建立「示範活動」與假資料（與正式資料分離，可隨時刪除）。
 */
import { pool, withTx } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

const ITEMS = ['探囊取物大奔走', '階梯球', '速速配', '顆星連珠', '弓箭標靶', '草地投籃', '九宮格', '舀杯高手', '看你多搖擺', '目標一致'];

async function ensureEvent(client, { slug, name, isDemo }) {
  const { rows } = await client.query(
    `INSERT INTO events (slug, name, edition, event_date, venue, organizer, is_demo, is_active)
     VALUES ($1,$2,'第23屆','2026-11-06','國立新竹特殊教育學校','新竹縣立竹東國民中學',$3,TRUE)
     ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
    [slug, name, isDemo],
  );
  const eventId = rows[0].id;
  const divs = [
    { code: 'elementary', name: '國小組', award: 8, spirit: 8, order: 1 },
    { code: 'junior', name: '國中組', award: 3, spirit: 3, order: 2 },
  ];
  const divisionIds = {};
  for (const d of divs) {
    const r = await client.query(
      `INSERT INTO divisions (event_id, code, name, award_places, spirit_places, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (event_id, code) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
      [eventId, d.code, d.name, d.award, d.spirit, d.order],
    );
    divisionIds[d.code] = r.rows[0].id;
  }
  const itemIds = [];
  for (let i = 0; i < ITEMS.length; i++) {
    const r = await client.query(
      `INSERT INTO items (event_id, name, kind, score_kind, sort_order) VALUES ($1,$2,'ranked','none',$3)
       ON CONFLICT (event_id, name) DO UPDATE SET sort_order=EXCLUDED.sort_order RETURNING id`,
      [eventId, ITEMS[i], i + 1],
    );
    itemIds.push(r.rows[0].id);
  }
  const ko = await client.query(
    `INSERT INTO items (event_id, name, kind, score_kind, sort_order) VALUES ($1,'沙包投擲賽','knockout','none',11)
     ON CONFLICT (event_id, name) DO UPDATE SET kind='knockout' RETURNING id`, [eventId]);
  itemIds.push(ko.rows[0].id);
  const sp = await client.query(
    `INSERT INTO items (event_id, name, kind, score_kind, sort_order) VALUES ($1,'精神總錦標','spirit','none',99)
     ON CONFLICT (event_id, name) DO UPDATE SET kind='spirit' RETURNING id`, [eventId]);
  itemIds.push(sp.rows[0].id);
  return { eventId, divisionIds, itemIds };
}

const demo = process.argv.includes('--demo');

await withTx(async (client) => {
  if (!demo) {
    const { eventId } = await ensureEvent(client, {
      slug: 'hsinchu-115-adaptive-sports',
      name: '115年度新竹縣第23屆特殊教育學生適應體育趣味運動競賽',
      isDemo: false,
    });
    console.log(`正式活動已建立（event_id=${eventId}）。學校、隊伍與同事帳號請由管理者在後台建立。`);
    return;
  }
  // 示範活動與正式活動分離：正式活動存在時系統仍以正式活動為準，
  // 想瀏覽示範資料請設定環境變數 ACTIVE_EVENT_SLUG=demo-adaptive-sports。
  const { eventId, divisionIds, itemIds } = await ensureEvent(client, {
    slug: 'demo-adaptive-sports',
    name: '【示範】適應體育趣味運動競賽',
    isDemo: true,
  });
  const schools = ['竹東國中', '竹北國中', '新竹特教學校', '關西國中', '湖口國中', '竹東國小', '竹北國小', '博愛國小', '關西國小', '湖口國小', '新豐國小', '芎林國小', '新埔國小'];
  const teams = { elementary: [], junior: [] };
  for (let i = 0; i < schools.length; i++) {
    const name = schools[i];
    const s = await client.query(
      'INSERT INTO schools (event_id, name, sort_order) VALUES ($1,$2,$3) ON CONFLICT (event_id, name) DO UPDATE SET sort_order=EXCLUDED.sort_order RETURNING id',
      [eventId, name, i]);
    const codes = name.includes('特教') ? ['elementary', 'junior'] : name.endsWith('國小') ? ['elementary'] : ['junior'];
    for (const c of codes) {
      const t = await client.query(
        `INSERT INTO teams (event_id, division_id, school_id, label) VALUES ($1,$2,$3,'')
         ON CONFLICT (division_id, school_id, label) DO UPDATE SET is_active=TRUE RETURNING id`,
        [eventId, divisionIds[c], s.rows[0].id]);
      teams[c].push(t.rows[0].id);
    }
  }
  const users = [
    ['demo-admin@example.com', '示範管理者', 'admin', 'demo-admin-1234'],
    ['demo-entry1@example.com', '示範輸入甲', 'entry', 'demo-entry-1234'],
    ['demo-entry2@example.com', '示範輸入乙', 'entry', 'demo-entry-1234'],
    ['demo-reviewer@example.com', '示範複核', 'reviewer', 'demo-review-1234'],
  ];
  const userIds = {};
  for (const [email, name, role, pw] of users) {
    const r = await client.query(
      `INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, role=EXCLUDED.role RETURNING id`,
      [email, name, role, hashPassword(pw)]);
    userIds[email] = r.rows[0].id;
  }
  const half = Math.ceil(itemIds.length / 2);
  for (const code of ['elementary', 'junior']) {
    for (let i = 0; i < itemIds.length; i++) {
      const uid = i < half ? userIds['demo-entry1@example.com'] : userIds['demo-entry2@example.com'];
      await client.query('INSERT INTO assignments VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [uid, divisionIds[code], itemIds[i]]);
      await client.query('INSERT INTO assignments VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [userIds['demo-reviewer@example.com'], divisionIds[code], itemIds[i]]);
    }
  }
  // 兩張已公布的示範成績表（國小 8 名、國中 3 名）與一張待複核
  const publish = async (code, itemIdx, n) => {
    const d = divisionIds[code];
    const it = itemIds[itemIdx];
    const s = await client.query(
      `INSERT INTO sheets (event_id, division_id, item_id, status, version, updated_by) VALUES ($1,$2,$3,'published',3,$4)
       ON CONFLICT (division_id, item_id) DO UPDATE SET status='published' RETURNING id`,
      [eventId, d, it, userIds['demo-reviewer@example.com']]);
    await client.query('DELETE FROM sheet_rows WHERE sheet_id=$1', [s.rows[0].id]);
    const rows = [];
    for (let r = 1; r <= n; r++) {
      const teamId = teams[code][r - 1];
      await client.query('INSERT INTO sheet_rows (sheet_id, team_id, rank, score) VALUES ($1,$2,$3,$4)', [s.rows[0].id, teamId, r, String(100 - r * 7)]);
      const t = await client.query('SELECT sc.name AS school, t.label FROM teams t JOIN schools sc ON sc.id=t.school_id WHERE t.id=$1', [teamId]);
      rows.push({ rank: r, tied: false, school: t.rows[0].school, label: t.rows[0].label, score: String(100 - r * 7), remark: null });
    }
    await client.query('UPDATE publications SET is_current=FALSE WHERE sheet_id=$1', [s.rows[0].id]);
    await client.query(
      'INSERT INTO publications (sheet_id, event_id, division_id, item_id, revision, rows, published_by) VALUES ($1,$2,$3,$4,1,$5,$6)',
      [s.rows[0].id, eventId, d, it, JSON.stringify(rows), userIds['demo-reviewer@example.com']]);
  };
  await publish('elementary', 0, 8);
  await publish('junior', 0, 3);
  await publish('elementary', 11, 8); // 精神總錦標
  console.log(`示範活動已建立（event_id=${eventId}）。示範帳號：`);
  users.forEach(([e, n, r, p]) => console.log(`  ${r.padEnd(8)} ${e} / ${p}  (${n})`));
  console.log('瀏覽示範資料：ACTIVE_EVENT_SLUG=demo-adaptive-sports npm start；正式上線前執行 npm run db:demo:remove 清除示範資料。');
});
await pool.end();
