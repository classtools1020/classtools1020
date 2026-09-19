import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadUser, ensureAdminFromEnv } from './auth.js';
import { HttpError } from './errors.js';
import { publicRouter } from './routes/public.js';
import { authRouter } from './routes/auth.js';
import { staffRouter } from './routes/staff.js';
import { adminRouter } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'false' ? false : 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'");
  next();
});
app.use(express.json({ limit: '256kb' }));
app.use(loadUser);

app.use('/api/public', publicRouter);
app.use('/api/auth', authRouter);
app.use('/api/staff', staffRouter);
app.use('/api/admin', adminRouter);
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', (_req, res) => res.status(404).json({ error: '找不到此 API' }));

const pub = path.join(__dirname, '..', 'public');
app.use(express.static(pub, { extensions: ['html'], index: 'index.html', maxAge: '1h', etag: true }));
app.get(['/staff', '/staff/*'], (_req, res) => res.sendFile(path.join(pub, 'staff', 'index.html')));

app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON 格式錯誤' });
  console.error(err);
  res.status(500).json({ error: '伺服器發生錯誤，請稍後再試' });
});

const port = Number(process.env.PORT || 3000);
await ensureAdminFromEnv().catch((e) => console.error('ADMIN_CODE 設定失敗：', e.message));
app.listen(port, () => console.log(`成績公告系統已啟動：http://localhost:${port}`));
