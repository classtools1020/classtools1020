/**
 * 瀏覽器端驗收（Playwright + 預裝 Chromium）：
 * 手機尺寸完成輸入 → 送複核 → 另一裝置複核發布 → 第三個裝置公開頁自動更新；
 * 離線儲存不誤報成功、重連後自動同步且不重複；衝突對話框；觸控目標 ≥ 44px、文字 ≥ 16px。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { startServer, BASE, ACCOUNTS } from '../helpers.js';

const shots = new URL('./screenshots/', import.meta.url).pathname;
fs.mkdirSync(shots, { recursive: true });
const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

let failed = 0;
function check(cond, msg) { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failed += 1; }

const server = await startServer();
const browser = await chromium.launch({ executablePath: exe });
const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

async function login(page, [email, password]) {
  await page.goto(`${BASE}/staff`);
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  await page.waitForSelector('.sheet-list');
}

try {
  // ---------- 裝置 A：輸入人員（手機） ----------
  const ctxA = await browser.newContext(mobile);
  const A = await ctxA.newPage();
  A.on('pageerror', (e) => check(false, `裝置A 頁面錯誤：${e.message}`));
  await login(A, ACCOUNTS.entry1);
  await A.screenshot({ path: `${shots}/01-entry-home-mobile.png`, fullPage: true });

  // 打開國小組「速速配」
  await A.click('.sheet-list a.title:has-text("速速配") >> nth=0');
  await A.waitForSelector('#btn-add');
  const heading = await A.textContent('.editor-head h2');
  check(heading.includes('國小組') && heading.includes('速速配'), `開啟成績表：${heading.trim()}`);

  for (let i = 1; i <= 4; i++) await A.selectOption('#quick-team', { index: i });
  await A.fill('.row-edit >> nth=0 >> [data-f=score]', '95');
  await A.fill('.row-edit >> nth=1 >> [data-f=score]', '90');
  // 並列：把第 3 列名次改為 2 → 出現並列勾選
  await A.fill('.row-edit >> nth=2 >> [data-f=rank]', '2');
  await A.waitForSelector('.row-edit.dup');
  check(await A.isVisible('.row-edit >> nth=1 >> .f-tie'), '同名次時自動顯示「並列」勾選');
  await A.check('.row-edit >> nth=1 >> [data-f=tied]');
  await A.check('.row-edit >> nth=2 >> [data-f=tied]');
  await A.screenshot({ path: `${shots}/02-entry-sheet-mobile.png`, fullPage: true });

  // 觸控目標與文字大小
  const metrics = await A.evaluate(() => {
    const btns = [...document.querySelectorAll('button, a.btn, select.input, input.input')].filter((b) => b.offsetParent);
    const small = btns.filter((b) => b.getBoundingClientRect().height < 44).map((b) => `${b.tagName}:${(b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 12)}`);
    const texts = [...document.querySelectorAll('p, td, th, label, a, span, h2, input, select, button')].filter((e) => e.offsetParent && e.textContent.trim());
    const tiny = texts.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 13).length;
    const main = parseFloat(getComputedStyle(document.body).fontSize);
    return { small, tiny, main, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
  });
  check(metrics.small.length === 0, `所有按鈕／輸入框高度 ≥ 44px（不足：${metrics.small.join(', ') || '無'}）`);
  check(metrics.main >= 16, `主要文字 ${metrics.main}px ≥ 16px`);
  check(metrics.scrollW <= metrics.innerW, `手機無橫向溢出（${metrics.scrollW} ≤ ${metrics.innerW}）`);

  await A.click('#btn-save');
  await A.waitForSelector('.save-state.saved');
  check((await A.textContent('.save-state')).includes('已儲存'), '儲存後顯示「已儲存」');

  // ---------- 離線：儲存失敗不誤報成功，保留本機草稿 ----------
  await A.fill('.row-edit >> nth=0 >> [data-f=remark]', '離線加註');
  await ctxA.setOffline(true);
  await A.click('#btn-save');
  await A.waitForSelector('.save-state.offline');
  const offlineText = await A.textContent('.save-state');
  check(offlineText.includes('尚未同步'), `離線儲存顯示：${offlineText}`);
  const hasLocal = await A.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('asr:draft:')));
  check(hasLocal, '離線時草稿保存在 localStorage');
  await A.screenshot({ path: `${shots}/03-offline-mobile.png` });
  // 重新連線 → 自動重送
  await ctxA.setOffline(false);
  await A.evaluate(() => window.dispatchEvent(new Event('online')));
  await A.waitForSelector('.save-state.saved', { timeout: 10000 });
  const stillLocal = await A.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('asr:draft:')));
  check(!stillLocal, '重連後本機草稿已同步並清除');

  // 重新載入確認伺服器只有一份、內容正確（無重複）
  await A.reload();
  await A.waitForSelector('#btn-add');
  const rowCount = await A.locator('.row-edit').count();
  check(rowCount === 4, `重連後伺服器資料 4 列，無重複（實際 ${rowCount}）`);
  check((await A.inputValue('.row-edit >> nth=0 >> [data-f=remark]')) === '離線加註', '離線期間的修改已同步');

  // ---------- 衝突：另一個分頁修改同一張表 ----------
  const A2 = await ctxA.newPage();
  await A2.goto(A.url());
  await A2.waitForSelector('#btn-add');
  await A2.fill('.row-edit >> nth=3 >> [data-f=score]', '70');
  await A2.click('#btn-save');
  await A2.waitForSelector('.save-state.saved');
  await A.fill('.row-edit >> nth=3 >> [data-f=score]', '60');
  await A.click('#btn-save');
  await A.waitForSelector('#dlg[open]');
  check((await A.textContent('#dlg')).includes('偵測到衝突'), '舊版本儲存時跳出衝突對話框，不會默默覆蓋');
  await A.screenshot({ path: `${shots}/04-conflict-mobile.png` });
  await A.click('#dlg [data-x=load]');
  await A.waitForSelector('#btn-add');
  check((await A.inputValue('.row-edit >> nth=3 >> [data-f=score]')) === '70', '選擇載入伺服器版本後顯示對方的內容');
  await A2.close();

  // 送複核
  await A.click('#btn-submit');
  await A.waitForSelector('#dlg[open]');
  await A.click('#dlg [data-x=ok]');
  await A.waitForSelector('.status-pending');
  check(await A.isVisible('text=此成績表已送複核'), '送複核後顯示待複核狀態，輸入欄位鎖定');
  check((await A.locator('#btn-save').count()) === 0, '待複核時輸入人員沒有儲存／發布按鈕');

  // ---------- 裝置 C：公開頁（另一個無登入的瀏覽器） ----------
  const ctxC = await browser.newContext(mobile);
  const C = await ctxC.newPage();
  await C.goto(`${BASE}/`);
  await C.waitForSelector('#update-status .dot');
  check(!(await C.textContent('#results')).includes('速速配') || (await C.locator('section:has-text("速速配") .empty').count()) === 1, '公開頁：待複核項目顯示「成績尚未公告」');

  // ---------- 裝置 B：複核人員（平板） ----------
  const ctxB = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true });
  const Bp = await ctxB.newPage();
  Bp.on('pageerror', (e) => check(false, `裝置B 頁面錯誤：${e.message}`));
  await login(Bp, ACCOUNTS.reviewer);
  await Bp.click('a[href="#/review"]');
  await Bp.waitForSelector('.sheet-list');
  await Bp.click('.sheet-list a.title:has-text("速速配") >> nth=0');
  await Bp.waitForSelector('#btn-publish');
  check((await Bp.locator('table.results tbody tr').count()) === 4, '複核畫面顯示即將公開的 4 筆結果（與公開頁相同格式）');
  check((await Bp.locator('table.results .tag:has-text("並列")').count()) === 2, '複核畫面呈現並列標示');
  await Bp.screenshot({ path: `${shots}/05-review-tablet.png`, fullPage: true });
  await Bp.click('#btn-publish');
  await Bp.waitForSelector('#dlg[open]');
  await Bp.click('#dlg [data-x=ok]');
  await Bp.waitForSelector('.status-published');
  check(true, '複核人員發布成功');

  // ---------- 裝置 C 自動更新 ----------
  await C.waitForSelector('section:has-text("速速配") table.results', { timeout: 30000 });
  const pubRows = await C.locator('section:has-text("速速配") table.results tbody tr').count();
  check(pubRows === 4, `公開頁在未重新整理下自動更新，顯示 4 筆（實際 ${pubRows}）`);
  check((await C.textContent('#update-status')).includes('最後公布'), '公開頁顯示最後更新時間');
  const elem8 = await C.locator('section:has-text("探囊取物大奔走") table.results tbody tr').count();
  check(elem8 === 8, `國小組第 1–8 名清楚列出（實際 ${elem8}）`);
  check((await C.locator('.spirit .spirit-list li').count()) === 8, '精神總錦標獨立區塊顯示 8 名');
  await C.screenshot({ path: `${shots}/06-public-mobile-after-publish.png`, fullPage: true });
  // 切換國中組：只有前三名
  await C.click('#division-seg button:has-text("國中組")');
  const jr = await C.locator('section:has-text("探囊取物大奔走") table.results tbody tr').count();
  check(jr === 3, `國中組僅顯示前 3 名（實際 ${jr}）`);
  // 搜尋學校
  await C.click('#division-seg button:has-text("國小組")');
  await C.fill('#school-search', '竹東');
  const hits = await C.locator('mark').count();
  check(hits >= 1, `搜尋學校可標示結果（${hits} 處）`);
  // 更新失敗提示
  await ctxC.setOffline(true);
  await C.evaluate(() => window.dispatchEvent(new Event('online'))); // 觸發一次抓取
  await C.waitForSelector('#error-banner:not([hidden])', { timeout: 10000 });
  check((await C.textContent('#error-banner')).includes('更新失敗'), '斷線時公開頁明確提示更新失敗');
  await ctxC.setOffline(false);

  // ---------- 管理者：邀請與分工（桌機） ----------
  const ctxD = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const D = await ctxD.newPage();
  D.on('pageerror', (e) => check(false, `裝置D 頁面錯誤：${e.message}`));
  await login(D, ACCOUNTS.admin);
  await D.click('a[href="#/admin/users"]');
  await D.waitForSelector('#inv-form');
  await D.fill('#inv-name', '王老師');
  await D.fill('#inv-email', 'wang@example.com');
  await D.click('#inv-form button[type=submit]');
  await D.waitForSelector('#inv-link');
  const link = await D.textContent('#inv-link');
  check(link.includes('/staff/invite/'), `產生邀請連結：${link.slice(0, 40)}…`);
  await D.screenshot({ path: `${shots}/07-admin-users-desktop.png`, fullPage: true });
  // 新同事用連結建立帳號
  const ctxE = await browser.newContext(mobile);
  const E = await ctxE.newPage();
  await E.goto(link);
  await E.waitForSelector('#inv-form');
  await E.fill('#pw', 'wang-password-1');
  await E.fill('#pw2', 'wang-password-1');
  await E.click('#inv-form button[type=submit]');
  await E.waitForSelector('#btn-logout');
  check((await E.textContent('#top-actions')).includes('王老師'), '新同事以邀請連結設定密碼後登入');
  await E.screenshot({ path: `${shots}/08-invited-mobile.png` });

  await ctxA.close(); await ctxB.close(); await ctxC.close(); await ctxD.close(); await ctxE.close();
} catch (e) {
  check(false, `例外：${e.message}`);
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} 項未通過` : '\n全部通過');
process.exit(failed ? 1 : 0);
