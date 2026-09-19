/* 成績表渲染：公開頁與複核頁共用，確保「複核看到的 = 公開頁呈現的」。 */
export const MEDAL = { 1: '金牌', 2: '銀牌', 3: '銅牌' };

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function rocDate(ymd) {
  if (!ymd) return '';
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return `民國${y - 1911}年${m}月${d}日`;
}

function highlight(text, q) {
  if (!q) return esc(text);
  const i = String(text).indexOf(q);
  if (i < 0) return esc(text);
  return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
}

function awardLabel(rank, division, item) {
  if (item.kind === 'spirit') return rank <= division.spirit_places ? '錦旗' : '';
  if (rank <= 3) return '獎牌';
  if (rank <= division.award_places) return '獎狀';
  return '';
}

/** rows: [{rank, tied, school, label, score, remark}] */
export function renderRankCell(rank, tied) {
  const medal = MEDAL[rank];
  return `<span class="rank r${rank <= 3 ? rank : 'n'}"><span class="num">${rank}</span>${medal ? `<span class="medal">${medal}</span>` : ''}${tied ? '<span class="tag">並列</span>' : ''}</span>`;
}

export function renderResultsTable({ rows, division, item, query = '' }) {
  if (!rows || !rows.length) {
    return `<p class="empty"><strong>成績尚未公告</strong>　裁判核定後將於此公布。</p>`;
  }
  const unit = item.score_unit ? `（${esc(item.score_unit)}）` : '';
  const hasScore = rows.some((r) => r.score != null && r.score !== '');
  const hasRemark = rows.some((r) => r.remark);
  return `<table class="results">
  <thead><tr>
    <th class="col-rank" scope="col">名次</th>
    <th scope="col">學校／隊伍</th>
    ${hasScore ? `<th class="col-score" scope="col">成績${unit}</th>` : ''}
    <th class="col-award" scope="col">獎勵</th>
    ${hasRemark ? '<th class="col-remark" scope="col">備註</th>' : ''}
  </tr></thead>
  <tbody>${rows.map((r) => `<tr>
    <td class="col-rank">${renderRankCell(r.rank, r.tied)}</td>
    <td><span class="school">${highlight(r.school, query)}${r.label ? `<small>${esc(r.label)}</small>` : ''}</span></td>
    ${hasScore ? `<td class="col-score">${esc(r.score ?? '')}</td>` : ''}
    <td class="col-award">${awardLabel(r.rank, division, item)}</td>
    ${hasRemark ? `<td class="col-remark">${esc(r.remark ?? '')}</td>` : ''}
  </tr>`).join('')}</tbody></table>`;
}

export function renderSpiritList({ rows, division, query = '' }) {
  if (!rows || !rows.length) {
    return `<p class="empty"><strong>成績尚未公告</strong>　精神總錦標將於閉幕典禮公布。</p>`;
  }
  return `<ol class="spirit-list">${rows.map((r) => `<li>
    ${renderRankCell(r.rank, r.tied)}
    <span class="school">${highlight(r.school, query)}${r.label ? `<small>${esc(r.label)}</small>` : ''}</span>
    <span class="pennant">${r.rank <= division.spirit_places ? '錦旗一面' : ''}</span>
  </li>`).join('')}</ol>`;
}

export const FLAG_SVG = `<svg class="flag" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 2h2v20H5zM8 3h11l-3 4 3 4H8z"/></svg>`;
