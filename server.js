#!/usr/bin/env node
/**
 * tas-web v2 — web wrapper untuk TAS (Telegram as Storage) CLI.
 * Fitur: auth (SQLite), upload multi, preview, share link, ZIP, stats, activity.
 */
const express = require('express');
const multer = require('multer');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 8001;
const TAS_PASSWORD = process.env.TAS_PASSWORD || '';
const TAS_DATA_DIR = process.env.TAS_DATA_DIR || '/data';
const AUTH_USER = process.env.AUTH_USER || 'admin';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || ''; // kosong = mode publik (tanpa auth)
const API_TOKEN = process.env.API_TOKEN || ''; // token statis utk integrasi API (xbook)
const TMP_DIR = path.join(TAS_DATA_DIR, 'tmp', 'uploads');
const DL_DIR = path.join(TAS_DATA_DIR, 'tmp', 'downloads');
const CACHE_DIR = path.join(TAS_DATA_DIR, 'cache');
const DB_PATH = path.join(TAS_DATA_DIR, 'tas.db');

for (const d of [TMP_DIR, DL_DIR, CACHE_DIR]) fs.mkdirSync(d, { recursive: true });

const app = express();
app.use(express.json());

// CORS: untuk integrasi API dari app lain
app.use('/api', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Range');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------------- SQLite (users, sessions, shares, activity) ----------------
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, pass_hash TEXT, salt TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER, expires_at INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS shares (token TEXT PRIMARY KEY, file_hash TEXT, filename TEXT, size INTEGER, expires_at INTEGER, max_downloads INTEGER, downloads INTEGER DEFAULT 0, created_at INTEGER);
CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, action TEXT, detail TEXT);
`);

function hashPassword(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 64).toString('hex');
}

function seedAdmin() {
  if (!AUTH_PASSWORD) return;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(AUTH_PASSWORD, salt);
  db.prepare(`INSERT INTO users (username, pass_hash, salt, created_at) VALUES (?,?,?,?)
              ON CONFLICT(username) DO UPDATE SET pass_hash=excluded.pass_hash, salt=excluded.salt`)
    .run(AUTH_USER, hash, salt, Date.now());
  console.log(`🔐 Auth aktif: user "${AUTH_USER}" (dari env AUTH_USER/AUTH_PASSWORD)`);
}
seedAdmin();
const authEnabled = !!AUTH_PASSWORD;

function logActivity(action, detail) {
  try {
    db.prepare('INSERT INTO activity (ts, action, detail) VALUES (?,?,?)').run(Date.now(), action, String(detail).slice(0, 250));
  } catch {}
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function getSessionUser(req) {
  const auth = req.headers.authorization || '';
  if (API_TOKEN && auth === 'Bearer ' + API_TOKEN) return { user_id: 0, username: 'api' };
  const token = parseCookies(req).tas_session || auth.replace(/^Bearer /, '');
  if (!token) return null;
  return db.prepare(`SELECT s.user_id, u.username FROM sessions s JOIN users u ON u.id=s.user_id
                     WHERE s.token=? AND s.expires_at > ?`).get(token, Date.now()) || null;
}

function requireAuth(req, res, next) {
  if (!authEnabled) return next();
  // /api/stream publik (capability URL by hash — dipakai video tag dari app
  // lain seperti xbook yang tidak bisa kirim cookie/header auth)
  const pub = req.path.startsWith('/api/login') || req.path.startsWith('/s/') ||
              req.path.startsWith('/login') || req.path.startsWith('/api/stream');
  if (pub) return next();
  if (getSessionUser(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  return res.redirect('/login.html');
}
app.use(requireAuth);

// ---------------- TAS helpers ----------------
function tasEnv() {
  return { ...process.env, TAS_PASSWORD, TAS_DATA_DIR };
}

function runTas(args, timeoutMs = 900000) {
  return new Promise((resolve, reject) => {
    execFile('tas', args, { env: tasEnv(), timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || stdout || err.message || '').toString();
        reject(new Error(msg.slice(-600) || err.message));
      } else {
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      }
    });
  });
}

// tas status/init mencetak banner ASCII sebelum JSON → strip bagian non-JSON
function parseTasJson(stdout) {
  const s = stdout.toString();
  const i = s.search(/[[{]/);
  return JSON.parse(i >= 0 ? s.slice(i) : s);
}

async function findRecord(id) {
  const { stdout } = await runTas(['list', '--json']);
  return parseTasJson(stdout).find((f) => f.hash === id || f.filename === id) || null;
}

// ---------------- jobs ----------------
const jobs = new Map();

function createJob(name) {
  const job = { id: crypto.randomBytes(4).toString('hex'), name, status: 'running', message: 'Diproses...', createdAt: Date.now(), tmpPath: null };
  jobs.set(job.id, job);
  return job;
}

function finishJob(job, err, message) {
  job.status = err ? 'error' : 'done';
  job.message = err ? (err.message || String(err)) : (message || 'Selesai');
}

function pushJob(job, filePath, name) {
  const child = spawn('tas', ['push', filePath, '--name', name], { env: tasEnv() });
  let outTail = '';
  child.stdout.on('data', (d) => { outTail = (outTail + d).slice(-800); });
  child.stderr.on('data', (d) => { outTail = (outTail + d).slice(-800); });
  child.on('error', (err) => { job.tmpPath = filePath; finishJob(job, err); });
  child.on('close', (code) => {
    if (code === 0) {
      try { fs.unlinkSync(filePath); } catch {}
      job.tmpPath = null;
      logActivity('upload', name);
      finishJob(job, null, `Upload selesai: ${name}`);
    } else {
      job.tmpPath = filePath; // simpan utk retry
      finishJob(job, new Error(`tas push gagal (exit ${code}): ${outTail.slice(-300)}`));
    }
  });
}

// ---------------- auth API ----------------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username || '');
  if (!user || hashPassword(password || '', user.salt) !== user.pass_hash) {
    return res.status(401).json({ error: 'Username atau password salah' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?,?,?,?)')
    .run(token, user.id, Date.now() + 30 * 24 * 3600 * 1000, Date.now());
  logActivity('login', username);
  res.set('Set-Cookie', `tas_session=${token}; HttpOnly; Path=/; Max-Age=${30 * 24 * 3600}; SameSite=Lax`);
  res.json({ ok: true, username: user.username });
});

app.post('/api/logout', (req, res) => {
  const t = parseCookies(req).tas_session;
  if (t) db.prepare('DELETE FROM sessions WHERE token=?').run(t);
  res.set('Set-Cookie', 'tas_session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => res.json(getSessionUser(req)));

// ---------------- storage API ----------------
app.get('/api/status', async (req, res) => {
  try {
    const { stdout } = await runTas(['status', '--json']);
    res.json(parseTasJson(stdout));
  } catch (e) {
    res.json({ initialized: false, error: e.message });
  }
});

app.get('/api/files', async (req, res) => {
  try {
    const { stdout } = await runTas(['list', '--json']);
    res.json({ files: parseTasJson(stdout) });
  } catch (e) {
    res.json({ files: [], error: e.message });
  }
});

// upload: simpan dengan nama asli (tas push pakai basename sebagai filename)
const upload = multer({
  storage: multer.diskStorage({
    destination: TMP_DIR,
    filename: (req, file, cb) => {
      const safe = path.basename(file.originalname).replace(/[^\w.\-() ]+/g, '_');
      cb(null, Date.now() + '-' + safe);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB cap
});

app.post('/api/upload', upload.array('files', 20), (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'Tidak ada file' });
  const jobsOut = [];
  for (const f of req.files) {
    const job = createJob(f.originalname);
    pushJob(job, f.path, f.originalname);
    jobsOut.push({ jobId: job.id, name: f.originalname });
  }
  res.json({ jobs: jobsOut });
});

// upload dari URL (server yang download)
app.post('/api/upload-url', (req, res) => {
  const url = (req.body?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'URL tidak valid' });
  const job = createJob(url.slice(0, 60));
  const filePath = path.join(TMP_DIR, 'url-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'));
  (async () => {
    try {
      const r = await fetch(url, { redirect: 'follow' });
      if (!r.ok) throw new Error('Gagal download: HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length) throw new Error('File kosong');
      fs.writeFileSync(filePath, buf);
      const name = (req.body?.name || decodeURIComponent(url.split('/').pop() || 'download')).split('?')[0].slice(0, 200);
      pushJob(job, filePath, name);
    } catch (e) {
      finishJob(job, e);
      try { fs.unlinkSync(filePath); } catch {}
    }
  })();
  res.json({ jobId: job.id, name: job.name });
});

app.post('/api/upload/retry/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job tidak ditemukan' });
  if (!job.tmpPath || !fs.existsSync(job.tmpPath)) return res.status(400).json({ error: 'File sementara sudah tidak ada' });
  job.status = 'running';
  job.message = 'Retry...';
  pushJob(job, job.tmpPath, job.name);
  res.json({ ok: true, jobId: job.id });
});

app.get('/api/jobs', (req, res) => {
  res.json({ jobs: [...jobs.values()].slice(-30) });
});

app.get('/api/download/:id', async (req, res) => {
  const id = req.params.id;
  const outPath = path.join(DL_DIR, 'dl-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'));
  try {
    const rec = await findRecord(id);
    if (!rec) return res.status(404).json({ error: 'File tidak ditemukan' });
    await runTas(['pull', id, outPath]);
    logActivity('download', rec.filename);
    res.download(outPath, rec.filename, () => { try { fs.unlinkSync(outPath); } catch {} });
  } catch (e) {
    try { fs.unlinkSync(outPath); } catch {}
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/delete/:id', (req, res) => {
  // --hard: hapus dari index DAN dari chat Telegram (sync penuh)
  const child = spawn('tas', ['delete', req.params.id, '--hard'], { env: tasEnv() });
  let out = '';
  child.stdout.on('data', (d) => { out = (out + d).slice(-600); });
  child.stderr.on('data', (d) => { out = (out + d).slice(-600); });
  child.on('error', (err) => res.status(500).json({ error: err.message }));
  child.stdin.write('y\n');
  child.stdin.end();
  child.on('close', (code) => {
    if (code === 0) {
      logActivity('delete', req.params.id.slice(0, 16));
      res.json({ ok: true });
    } else {
      res.status(500).json({ error: out.slice(-300) || `exit ${code}` });
    }
  });
});

// ---------------- streaming ----------------
const pullPromises = new Map();

function ensureCached(id, cachePath) {
  if (fs.existsSync(cachePath)) return Promise.resolve(cachePath);
  if (pullPromises.has(id)) return pullPromises.get(id);
  const p = runTas(['pull', id, cachePath], 1200000)
    .then(() => cachePath)
    .catch((e) => { try { fs.unlinkSync(cachePath); } catch {} throw e; })
    .finally(() => pullPromises.delete(id));
  pullPromises.set(id, p);
  return p;
}

app.get('/api/stream/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const rec = await findRecord(id);
    if (!rec) return res.status(404).json({ error: 'File tidak ditemukan' });
    const ext = path.extname(rec.filename || '') || '.bin';
    const cachePath = path.join(CACHE_DIR, rec.hash + ext);
    await ensureCached(id, cachePath);
    const disp = `inline; filename*=UTF-8''${encodeURIComponent(rec.filename)}`;
    res.sendFile(cachePath, { headers: { 'Content-Disposition': disp } }, (err) => {
      if (err && !res.headersSent) res.status(500).json({ error: err.message });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/cache', (req, res) => {
  let total = 0;
  const files = fs.readdirSync(CACHE_DIR).map((f) => {
    const st = fs.statSync(path.join(CACHE_DIR, f));
    total += st.size;
    return { file: f, size: st.size, mtime: st.mtime };
  }).sort((a, b) => b.mtime - a.mtime);
  res.json({ count: files.length, totalBytes: total, files });
});

app.post('/api/cache/clear', (req, res) => {
  let removed = 0;
  for (const f of fs.readdirSync(CACHE_DIR)) {
    try { fs.unlinkSync(path.join(CACHE_DIR, f)); removed++; } catch {}
  }
  res.json({ ok: true, removed });
});

// ---------------- share links (expiring) ----------------
app.post('/api/share/:id', async (req, res) => {
  const id = req.params.id;
  const expireH = Math.min(Math.max(parseInt(req.body?.expire) || 24, 1), 720);
  const maxDl = Math.min(Math.max(parseInt(req.body?.maxDownloads) || 1, 1), 100);
  const rec = await findRecord(id);
  if (!rec) return res.status(404).json({ error: 'File tidak ditemukan' });
  const token = crypto.randomBytes(8).toString('hex');
  db.prepare('INSERT INTO shares (token, file_hash, filename, size, expires_at, max_downloads, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(token, rec.hash, rec.filename, rec.original_size, Date.now() + expireH * 3600 * 1000, maxDl, Date.now());
  logActivity('share', `${rec.filename} (${expireH}h, max ${maxDl}x)`);
  res.json({ token, url: `/s/${token}`, filename: rec.filename, expiresAt: Date.now() + expireH * 3600 * 1000, maxDownloads: maxDl });
});

app.get('/s/:token', async (req, res) => {
  const s = db.prepare('SELECT * FROM shares WHERE token=?').get(req.params.token);
  if (!s) return res.status(404).send('Link tidak valid');
  if (Date.now() > s.expires_at) {
    db.prepare('DELETE FROM shares WHERE token=?').run(s.token);
    return res.status(410).send('Link kadaluarsa');
  }
  if (s.downloads >= s.max_downloads) return res.status(410).send('Batas download tercapai');
  try {
    const ext = path.extname(s.filename) || '.bin';
    const cachePath = path.join(CACHE_DIR, s.file_hash + ext);
    await ensureCached(s.file_hash, cachePath);
    db.prepare('UPDATE shares SET downloads = downloads + 1 WHERE token=?').run(s.token);
    res.download(cachePath, s.filename);
  } catch (e) {
    res.status(500).send('Gagal memuat file');
  }
});

app.get('/api/shares', (req, res) => {
  res.json({ shares: db.prepare('SELECT * FROM shares ORDER BY created_at DESC LIMIT 20').all() });
});

app.post('/api/share/revoke/:token', (req, res) => {
  db.prepare('DELETE FROM shares WHERE token=?').run(req.params.token);
  res.json({ ok: true });
});

// ---------------- ZIP download ----------------
app.post('/api/zip', async (req, res) => {
  const ids = (req.body?.ids || []).slice(0, 50);
  if (!ids.length) return res.status(400).json({ error: 'Pilih minimal 1 file' });
  try {
    const { stdout } = await runTas(['list', '--json']);
    const all = parseTasJson(stdout);
    const picked = ids.map((id) => all.find((f) => f.hash === id || f.filename === id)).filter(Boolean);
    if (!picked.length) return res.status(404).json({ error: 'File tidak ditemukan' });

    const zipDir = path.join(DL_DIR, 'zip-' + crypto.randomBytes(4).toString('hex'));
    fs.mkdirSync(zipDir, { recursive: true });
    for (const rec of picked) {
      const out = path.join(zipDir, rec.filename.replace(/[^\w.\-() ]+/g, '_'));
      await runTas(['pull', rec.hash, out], 1800000);
    }
    logActivity('zip', `${picked.length} file`);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="tas-${Date.now()}.zip"`);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', () => res.end());
    archive.pipe(res);
    for (const f of fs.readdirSync(zipDir)) archive.file(path.join(zipDir, f), { name: f });
    archive.finalize();
    res.on('close', () => fs.rmSync(zipDir, { recursive: true, force: true }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------- stats & activity ----------------
app.get('/api/stats', async (req, res) => {
  try {
    const { stdout } = await runTas(['status', '--json']);
    const st = parseTasJson(stdout);
    const { stdout: lsOut } = await runTas(['list', '--json']);
    const files = parseTasJson(lsOut);
    const byType = {};
    for (const f of files) {
      const ext = path.extname(f.filename || '').toLowerCase().replace('.', '');
      const cat = ['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(ext) ? 'video'
        : ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) ? 'gambar'
        : ['mp3', 'wav', 'flac', 'ogg'].includes(ext) ? 'audio'
        : ['zip', 'tar', 'gz', 'rar', '7z'].includes(ext) ? 'arsip' : 'lainnya';
      byType[cat] = (byType[cat] || 0) + 1;
    }
    const cacheBytes = fs.readdirSync(CACHE_DIR).reduce((t, f) => t + fs.statSync(path.join(CACHE_DIR, f)).size, 0);
    const activeShares = db.prepare('SELECT COUNT(*) c FROM shares WHERE expires_at > ?').get(Date.now()).c;
    res.json({ ...st, byType, cacheBytes, activeShares });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/activity', (req, res) => {
  res.json({ activity: db.prepare('SELECT * FROM activity ORDER BY ts DESC LIMIT 50').all() });
});

// ---------------- static ----------------
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`tas-web v2 listening on :${PORT} (data: ${TAS_DATA_DIR}, auth: ${authEnabled ? 'ON' : 'OFF'})`);
});
