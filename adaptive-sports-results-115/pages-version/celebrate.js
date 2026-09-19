/* 撒花與音效（不依賴任何套件）。尊重「減少動態效果」設定。 */
const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 撒紙花：3 秒、約 120 片，顏色取自賽事色系。 */
export function confetti({ count = 120, duration = 2800 } = {}) {
  if (reduce) return;
  const c = document.createElement('canvas');
  c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:50';
  document.body.appendChild(c);
  const ctx = c.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => { c.width = innerWidth * dpr; c.height = innerHeight * dpr; };
  resize();
  const colors = ['#f4b323', '#e0483d', '#1f5fbf', '#ffffff', '#7cc96a', '#ffd54a'];
  const parts = Array.from({ length: count }, () => ({
    x: Math.random() * c.width, y: -20 * dpr - Math.random() * c.height * 0.3,
    w: (6 + Math.random() * 6) * dpr, h: (8 + Math.random() * 8) * dpr,
    vx: (Math.random() - 0.5) * 1.6 * dpr, vy: (2 + Math.random() * 2.5) * dpr,
    rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.2,
    color: colors[Math.floor(Math.random() * colors.length)], sway: Math.random() * Math.PI * 2,
  }));
  const start = performance.now();
  (function frame(t) {
    const k = (t - start) / duration;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.globalAlpha = k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
    for (const p of parts) {
      p.x += p.vx + Math.sin(p.sway + t / 300) * 0.6 * dpr; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(t / 200 + p.sway)));
      ctx.restore();
    }
    if (k < 1) requestAnimationFrame(frame); else c.remove();
  })(start);
}

/** 清脆的「叮」（Web Audio 合成，不需要音檔）。只能在使用者點擊之後呼叫。 */
export function chime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    const t0 = ac.currentTime;
    [[880, 0], [1174.66, 0.12], [1567.98, 0.24]].forEach(([f, dt]) => {
      const o = ac.createOscillator(); const g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.6);
      o.connect(g).connect(ac.destination); o.start(t0 + dt); o.stop(t0 + dt + 0.7);
    });
    setTimeout(() => ac.close(), 1500);
  } catch { /* 靜音也沒關係 */ }
}
