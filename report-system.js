/**
 * ============================================================
 *  ReportSystem — 學生練習成果回報系統（共用模組）
 * ============================================================
 *  所有英文練習工具共用此模組，提供：
 *  1. 回報按鈕 UI
 *  2. 回報表單 Modal
 *  3. 資料送出（Google Apps Script）
 *  4. 本地紀錄備份
 *  5. 驗證碼產生
 * ============================================================
 */

const ReportSystem = (() => {
  'use strict';

  /* ──────────── 常數 ──────────── */
  const LS_KEY_NAME = 'studentName';
  const LS_KEY_ENDPOINT = 'reportEndpoint';
  const LS_KEY_HISTORY = 'reportHistory';
  const STYLE_ID = 'report-system-styles';
  const MODAL_ID = 'report-system-modal';

  /* ──────────── CSS 樣式注入 ──────────── */
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return; // 避免重複注入

    const css = `
      /* ===== 回報按鈕 ===== */
      .rs-report-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 12px 28px;
        border: none;
        border-radius: 50px;
        background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
        color: #1a1a2e;
        font-size: 17px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 4px 15px rgba(67, 233, 123, 0.4);
        transition: transform 0.2s, box-shadow 0.2s;
        font-family: 'Noto Sans TC', 'Microsoft JhengHei', sans-serif;
      }
      .rs-report-btn:hover {
        transform: translateY(-3px) scale(1.04);
        box-shadow: 0 8px 25px rgba(67, 233, 123, 0.55);
      }
      .rs-report-btn:active {
        transform: translateY(0) scale(0.97);
      }

      /* ===== Modal 背景 ===== */
      .rs-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        animation: rs-fadeIn 0.25s ease;
      }

      /* ===== Modal 卡片 ===== */
      .rs-modal {
        background: linear-gradient(145deg, #1e1e3a, #2a2a4a);
        border-radius: 20px;
        padding: 32px 28px;
        width: 92%;
        max-width: 420px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
        color: #e0e0e0;
        font-family: 'Noto Sans TC', 'Microsoft JhengHei', sans-serif;
        position: relative;
        animation: rs-slideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .rs-modal h2 {
        margin: 0 0 20px;
        text-align: center;
        font-size: 22px;
        color: #43e97b;
      }

      /* ===== 表單欄位 ===== */
      .rs-field {
        margin-bottom: 14px;
      }
      .rs-field label {
        display: block;
        font-size: 14px;
        color: #aaa;
        margin-bottom: 4px;
      }
      .rs-field input[type="text"] {
        width: 100%;
        padding: 10px 14px;
        border: 2px solid #444;
        border-radius: 10px;
        background: #16162b;
        color: #fff;
        font-size: 16px;
        outline: none;
        transition: border-color 0.2s;
        box-sizing: border-box;
      }
      .rs-field input[type="text"]:focus {
        border-color: #43e97b;
      }
      .rs-field input[readonly] {
        background: #252545;
        color: #ccc;
        cursor: default;
        border-color: #333;
      }

      /* ===== 練習資料摘要 ===== */
      .rs-summary {
        background: #16162b;
        border-radius: 12px;
        padding: 14px 16px;
        margin-bottom: 16px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px 16px;
        font-size: 15px;
      }
      .rs-summary-item {
        display: flex;
        justify-content: space-between;
      }
      .rs-summary-item .rs-label {
        color: #888;
      }
      .rs-summary-item .rs-value {
        color: #fff;
        font-weight: 600;
      }
      .rs-summary-item.rs-full-row {
        grid-column: 1 / -1;
      }

      /* ===== 驗證碼區塊 ===== */
      .rs-verify-box {
        background: linear-gradient(135deg, #2d2d5e, #1e1e3a);
        border: 2px dashed #43e97b;
        border-radius: 12px;
        padding: 12px 16px;
        text-align: center;
        margin-bottom: 18px;
      }
      .rs-verify-box .rs-code {
        font-size: 20px;
        font-weight: 700;
        color: #43e97b;
        letter-spacing: 2px;
        margin-top: 4px;
        font-family: 'Courier New', monospace;
      }
      .rs-verify-box .rs-hint {
        font-size: 12px;
        color: #888;
      }

      /* ===== 按鈕列 ===== */
      .rs-btn-row {
        display: flex;
        gap: 12px;
        margin-top: 8px;
      }
      .rs-btn-submit {
        flex: 1;
        padding: 12px;
        border: none;
        border-radius: 12px;
        background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
        color: #1a1a2e;
        font-size: 16px;
        font-weight: 700;
        cursor: pointer;
        transition: transform 0.15s, box-shadow 0.15s;
      }
      .rs-btn-submit:hover {
        transform: scale(1.03);
        box-shadow: 0 4px 18px rgba(67, 233, 123, 0.4);
      }
      .rs-btn-submit:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }
      .rs-btn-cancel {
        flex: 0.6;
        padding: 12px;
        border: 2px solid #555;
        border-radius: 12px;
        background: transparent;
        color: #aaa;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        transition: border-color 0.2s, color 0.2s;
      }
      .rs-btn-cancel:hover {
        border-color: #e74c3c;
        color: #e74c3c;
      }

      /* ===== 成功動畫 overlay ===== */
      .rs-success-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.75);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 100000;
        animation: rs-fadeIn 0.3s ease;
      }
      .rs-success-check {
        width: 100px;
        height: 100px;
        border-radius: 50%;
        background: linear-gradient(135deg, #43e97b, #38f9d7);
        display: flex;
        align-items: center;
        justify-content: center;
        animation: rs-popIn 0.5s cubic-bezier(0.17, 0.67, 0.29, 1.35);
        box-shadow: 0 0 40px rgba(67, 233, 123, 0.6);
      }
      .rs-success-check svg {
        width: 50px;
        height: 50px;
        stroke: #1a1a2e;
        stroke-width: 3;
        fill: none;
        stroke-dasharray: 50;
        stroke-dashoffset: 50;
        animation: rs-drawCheck 0.5s 0.3s forwards;
      }
      .rs-success-text {
        margin-top: 20px;
        font-size: 24px;
        font-weight: 700;
        color: #43e97b;
        font-family: 'Noto Sans TC', 'Microsoft JhengHei', sans-serif;
        animation: rs-fadeIn 0.4s 0.5s both;
      }
      .rs-success-sub {
        margin-top: 8px;
        font-size: 15px;
        color: #aaa;
        font-family: 'Noto Sans TC', 'Microsoft JhengHei', sans-serif;
        animation: rs-fadeIn 0.4s 0.7s both;
      }

      /* ===== 撒花粒子 ===== */
      .rs-confetti {
        position: fixed;
        width: 10px;
        height: 10px;
        border-radius: 2px;
        z-index: 100001;
        pointer-events: none;
        animation: rs-confettiFall var(--fall-duration, 2s) ease-in forwards;
      }

      /* ===== 失敗提示 ===== */
      .rs-fail-msg {
        background: #2a2a4a;
        border: 2px solid #f39c12;
        border-radius: 14px;
        padding: 20px;
        text-align: center;
        margin-top: 12px;
        animation: rs-fadeIn 0.3s ease;
      }
      .rs-fail-msg .rs-fail-icon {
        font-size: 40px;
        margin-bottom: 8px;
      }
      .rs-fail-msg .rs-fail-text {
        color: #f5d77d;
        font-size: 15px;
        line-height: 1.6;
      }

      /* ===== 動畫 keyframes ===== */
      @keyframes rs-fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes rs-slideUp {
        from { opacity: 0; transform: translateY(40px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes rs-popIn {
        0% { transform: scale(0); }
        70% { transform: scale(1.15); }
        100% { transform: scale(1); }
      }
      @keyframes rs-drawCheck {
        to { stroke-dashoffset: 0; }
      }
      @keyframes rs-confettiFall {
        0% {
          transform: translateY(0) rotate(0deg);
          opacity: 1;
        }
        100% {
          transform: translateY(100vh) rotate(var(--rotate-end, 720deg));
          opacity: 0;
        }
      }
    `;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ──────────── 便利函數 ──────────── */

  /** 從 localStorage 讀取學生姓名 */
  function getName() {
    return localStorage.getItem(LS_KEY_NAME) || '';
  }

  /** 儲存學生姓名到 localStorage */
  function setName(name) {
    if (name && name.trim()) {
      localStorage.setItem(LS_KEY_NAME, name.trim());
    }
  }

  /**
   * 生成驗證碼
   * 格式：姓名前2字-MMDD-HHmm-隨機4碼
   */
  function generateCode(name) {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');

    // 取姓名前 2 個字（支援中英文）
    const namePrefix = (name || '??').slice(0, 2);

    // 隨機 4 碼（英數混合）
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去除易混淆字元
    let rand = '';
    for (let i = 0; i < 4; i++) {
      rand += chars[Math.floor(Math.random() * chars.length)];
    }

    return `${namePrefix}-${mm}${dd}-${hh}${min}-${rand}`;
  }

  /* ──────────── 本地紀錄管理 ──────────── */

  /** 取得所有歷史紀錄 */
  function getHistory() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY_HISTORY) || '[]');
    } catch {
      return [];
    }
  }

  /** 新增一筆紀錄 */
  function addHistory(record) {
    const history = getHistory();
    history.push({
      time: new Date().toISOString(),
      tool: record.tool || '',
      level: record.level || '',
      score: record.score ?? 0,
      stars: record.stars ?? 0,
      coins: record.coins ?? 0,
      verifyCode: record.verifyCode || '',
      synced: !!record.synced,
    });
    localStorage.setItem(LS_KEY_HISTORY, JSON.stringify(history));
  }

  /** 將某筆紀錄標記為已同步 */
  function markSynced(verifyCode) {
    const history = getHistory();
    const target = history.find((r) => r.verifyCode === verifyCode);
    if (target) {
      target.synced = true;
      localStorage.setItem(LS_KEY_HISTORY, JSON.stringify(history));
    }
  }

  /* ──────────── 撒花效果 ──────────── */

  function launchConfetti() {
    const colors = ['#43e97b', '#38f9d7', '#f1c40f', '#e74c3c', '#9b59b6', '#3498db', '#ff6b6b', '#ffd93d'];
    const count = 60;

    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'rs-confetti';
      el.style.left = Math.random() * 100 + 'vw';
      el.style.top = '-10px';
      el.style.background = colors[Math.floor(Math.random() * colors.length)];
      el.style.width = (6 + Math.random() * 8) + 'px';
      el.style.height = (6 + Math.random() * 8) + 'px';
      el.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      el.style.setProperty('--fall-duration', (1.5 + Math.random() * 2) + 's');
      el.style.setProperty('--rotate-end', (360 + Math.random() * 720) + 'deg');
      el.style.animationDelay = (Math.random() * 0.5) + 's';
      document.body.appendChild(el);

      // 動畫結束後移除
      setTimeout(() => el.remove(), 4000);
    }
  }

  /* ──────────── 成功動畫 ──────────── */

  function showSuccess() {
    const overlay = document.createElement('div');
    overlay.className = 'rs-success-overlay';
    overlay.innerHTML = `
      <div class="rs-success-check">
        <svg viewBox="0 0 40 40">
          <polyline points="10,22 18,30 32,12" />
        </svg>
      </div>
      <div class="rs-success-text">回報成功！</div>
      <div class="rs-success-sub">老師已經收到你的成績了</div>
    `;
    document.body.appendChild(overlay);

    // 撒花！
    launchConfetti();

    // 點擊或 3 秒後自動關閉
    const close = () => overlay.remove();
    overlay.addEventListener('click', close);
    setTimeout(close, 3500);
  }

  /* ──────────── 失敗提示（顯示在 modal 內） ──────────── */

  function showFailMessage(container, message) {
    // 移除舊的失敗訊息
    const old = container.querySelector('.rs-fail-msg');
    if (old) old.remove();

    const div = document.createElement('div');
    div.className = 'rs-fail-msg';
    div.innerHTML = `
      <div class="rs-fail-icon">📋</div>
      <div class="rs-fail-text">${message}</div>
    `;
    container.appendChild(div);
  }

  /* ──────────── 送出資料 ──────────── */

  /**
   * 送出回報資料到 Google Apps Script
   * @param {Object} data - { name, tool, level, score, stars, coins, verifyCode }
   * @returns {Promise<boolean>} 是否成功
   */
  async function send(data) {
    const endpoint = localStorage.getItem(LS_KEY_ENDPOINT);

    if (!endpoint) {
      // 沒有設定 endpoint，存本地但標記未同步
      addHistory({ ...data, synced: false });
      return { success: false, reason: 'no-endpoint' };
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          tool: data.tool,
          level: data.level,
          score: data.score,
          stars: data.stars,
          coins: data.coins,
          verifyCode: data.verifyCode,
          time: new Date().toISOString(),
        }),
        mode: 'no-cors', // Google Apps Script 需要 no-cors
      });

      // no-cors 模式下 response.ok 永遠是 false，但請求會送出
      // 我們信任它成功了
      addHistory({ ...data, synced: true });
      markSynced(data.verifyCode);
      return { success: true };
    } catch (err) {
      console.warn('[ReportSystem] 送出失敗：', err);
      addHistory({ ...data, synced: false });
      return { success: false, reason: 'network-error' };
    }
  }

  /* ──────────── Modal 表單 ──────────── */

  /**
   * 開啟回報表單 Modal
   * @param {Object} data - 預填資料 { tool, level, score, stars, coins }
   */
  function openModal(data) {
    injectStyles();

    // 移除舊 modal（如果有）
    const old = document.getElementById(MODAL_ID);
    if (old) old.remove();

    const name = getName();
    const code = generateCode(name || '??');

    // 建立 overlay
    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.className = 'rs-overlay';

    overlay.innerHTML = `
      <div class="rs-modal">
        <h2>📤 回報練習成果給老師</h2>

        <div class="rs-field">
          <label>👤 你的名字</label>
          <input type="text" id="rs-name-input" placeholder="請輸入你的名字" value="${escapeHtml(name)}" />
        </div>

        <div class="rs-summary">
          <div class="rs-summary-item rs-full-row">
            <span class="rs-label">🛠 練習工具</span>
            <span class="rs-value">${escapeHtml(data.tool || '—')}</span>
          </div>
          <div class="rs-summary-item">
            <span class="rs-label">📊 關卡</span>
            <span class="rs-value">${escapeHtml(String(data.level || '—'))}</span>
          </div>
          <div class="rs-summary-item">
            <span class="rs-label">🏆 分數</span>
            <span class="rs-value">${data.score ?? 0}</span>
          </div>
          <div class="rs-summary-item">
            <span class="rs-label">⭐ 星數</span>
            <span class="rs-value">${data.stars ?? 0}</span>
          </div>
          <div class="rs-summary-item">
            <span class="rs-label">🪙 金幣</span>
            <span class="rs-value">${data.coins ?? 0}</span>
          </div>
        </div>

        <div class="rs-verify-box">
          <div class="rs-hint">📎 驗證碼（自動產生）</div>
          <div class="rs-code" id="rs-verify-code">${escapeHtml(code)}</div>
        </div>

        <div class="rs-btn-row">
          <button class="rs-btn-submit" id="rs-btn-submit">✅ 確認送出</button>
          <button class="rs-btn-cancel" id="rs-btn-cancel">取消</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // --- 事件綁定 ---

    const nameInput = document.getElementById('rs-name-input');
    const codeEl = document.getElementById('rs-verify-code');
    const submitBtn = document.getElementById('rs-btn-submit');
    const cancelBtn = document.getElementById('rs-btn-cancel');

    // 姓名改變時即時更新驗證碼
    nameInput.addEventListener('input', () => {
      const newCode = generateCode(nameInput.value || '??');
      codeEl.textContent = newCode;
    });

    // 取消按鈕
    cancelBtn.addEventListener('click', () => overlay.remove());

    // 點擊 overlay 背景也關閉
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // ESC 關閉
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // 確認送出
    submitBtn.addEventListener('click', async () => {
      const currentName = nameInput.value.trim();
      if (!currentName) {
        nameInput.style.borderColor = '#e74c3c';
        nameInput.placeholder = '請先輸入你的名字！';
        nameInput.focus();
        return;
      }

      // 儲存姓名
      setName(currentName);

      // 停用按鈕避免重複送出
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ 送出中...';

      const currentCode = codeEl.textContent;
      const payload = {
        name: currentName,
        tool: data.tool || '',
        level: data.level || '',
        score: data.score ?? 0,
        stars: data.stars ?? 0,
        coins: data.coins ?? 0,
        verifyCode: currentCode,
      };

      const result = await send(payload);

      if (result.success) {
        overlay.remove();
        showSuccess();
      } else {
        // 送出失敗，但驗證碼已存在本地
        submitBtn.disabled = false;
        submitBtn.textContent = '✅ 確認送出';

        const modal = overlay.querySelector('.rs-modal');
        if (result.reason === 'no-endpoint') {
          showFailMessage(
            modal,
            '老師尚未開啟回報功能<br>請 <b>截圖驗證碼</b> 傳給老師即可！<br><span style="font-size:12px;color:#999;">（你的紀錄已存在本機）</span>'
          );
        } else {
          showFailMessage(
            modal,
            '網路連線失敗，無法送出<br>請 <b>截圖驗證碼</b> 傳給老師即可！<br><span style="font-size:12px;color:#999;">（你的紀錄已存在本機，之後可重新送出）</span>'
          );
        }
      }
    });

    // 自動聚焦姓名欄位（如果是空的）
    if (!name) {
      nameInput.focus();
    }
  }

  /* ──────────── HTML 跳脫 ──────────── */

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ──────────── 公開 API ──────────── */

  /**
   * 在指定容器插入「回報給老師」按鈕
   * @param {string} containerId - 容器元素的 id
   */
  function createButton(containerId) {
    injectStyles();

    const container = document.getElementById(containerId);
    if (!container) {
      console.warn(`[ReportSystem] 找不到容器：#${containerId}`);
      return null;
    }

    const btn = document.createElement('button');
    btn.className = 'rs-report-btn';
    btn.innerHTML = '📤 回報給老師';
    container.appendChild(btn);

    return btn;
  }

  /**
   * 一鍵顯示回報按鈕，點擊後自動帶入資料打開 Modal
   * @param {string} containerId - 容器元素的 id
   * @param {Object} data - { tool, level, score, stars, coins }
   */
  function showButton(containerId, data) {
    const btn = createButton(containerId);
    if (!btn) return;

    btn.addEventListener('click', () => {
      openModal(data);
    });

    return btn;
  }

  /* ──────────── 匯出 ──────────── */

  return {
    createButton,
    showButton,
    openModal,
    send,
    getName,
    setName,
    generateCode,
    getHistory,
    addHistory,
    markSynced,
    injectStyles,
  };
})();
