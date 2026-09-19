import { Router } from 'express';
import QRCode from 'qrcode';
import { query } from '../db.js';
import { sha256 } from '../auth.js';

export const publicRouter = Router();

/**
 * 公開成績資料。只讀 publications（已發布快照），草稿與待複核永遠不會出現在這裡。
 */
export async function buildPublicPayload() {
  const slug = process.env.ACTIVE_EVENT_SLUG;
  const { rows: events } = slug
    ? await query('SELECT id, slug, name, edition, event_date, venue, organizer, is_demo FROM events WHERE slug=$1', [slug])
    : await query('SELECT id, slug, name, edition, event_date, venue, organizer, is_demo FROM events WHERE is_active ORDER BY is_demo, id LIMIT 1');
  const event = events[0];
  if (!event) return { event: null, divisions: [], items: [], results: [], updated_at: null };

  const [{ rows: divisions }, { rows: items }, { rows: pubs }] = await Promise.all([
    query('SELECT id, code, name, award_places, spirit_places FROM divisions WHERE event_id=$1 ORDER BY sort_order, id', [event.id]),
    query('SELECT id, name, kind, score_kind, score_unit, sort_order FROM items WHERE event_id=$1 AND is_active ORDER BY sort_order, id', [event.id]),
    query(
      `SELECT p.division_id, p.item_id, p.revision, p.rows, p.published_at
         FROM publications p WHERE p.event_id=$1 AND p.is_current`,
      [event.id],
    ),
  ]);

  const divById = Object.fromEntries(divisions.map((d) => [d.id, d]));
  const itemById = Object.fromEntries(items.map((i) => [i.id, i]));
  const results = [];
  let updatedAt = null;
  for (const p of pubs) {
    const d = divById[p.division_id];
    const it = itemById[p.item_id];
    if (!d || !it) continue;
    const limit = it.kind === 'spirit' ? d.spirit_places : d.award_places;
    const rows = (p.rows || [])
      .filter((r) => r.rank <= limit)
      .sort((a, b) => a.rank - b.rank || String(a.school).localeCompare(b.school, 'zh-Hant'));
    results.push({
      division_id: p.division_id,
      item_id: p.item_id,
      revision: p.revision,
      published_at: p.published_at,
      rows,
    });
    if (!updatedAt || new Date(p.published_at) > new Date(updatedAt)) updatedAt = p.published_at;
  }
  return { event, divisions, items, results, updated_at: updatedAt };
}

publicRouter.get('/results', async (req, res, next) => {
  try {
    const payload = await buildPublicPayload();
    const body = JSON.stringify(payload);
    const etag = `"${sha256(body).slice(0, 32)}"`;
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.type('application/json').send(body);
  } catch (e) {
    next(e);
  }
});

publicRouter.get('/qr.svg', async (req, res, next) => {
  try {
    const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const svg = await QRCode.toString(base, { type: 'svg', margin: 1, width: 240, color: { dark: '#0b1f3a', light: '#ffffff' } });
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('image/svg+xml').send(svg);
  } catch (e) {
    next(e);
  }
});

publicRouter.get('/url', (req, res) => {
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  res.json({ url: base });
});
