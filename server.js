#!/usr/bin/env node
/**
 * tas-web v2 — web wrapper untuk TAS (Telegram as Storage) CLI.
 * Fitur: auth (SQLite), upload multi, preview, share link, ZIP, stats, activity.
 */
const express = require('express');
const multer = require('multer');
const { execFile, spawn } = require('child_process');
const { Readable } = require('stream');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const Database = require('better-sqlite3');
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage(); // konteks per-request (profile dari API token)

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
  res.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
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

app.use((req, res, next) => {
  als.run(resolveAuth(req), () => next());
});

function requireAuth(req, res, next) {
  if (!authEnabled) return next();
  const ctx = als.getStore() || {};
  // /api/stream publik (capability URL by hash — dipakai video tag dari app
  // lain seperti xbook yang tidak bisa kirim cookie/header auth)
  const pub = req.path.startsWith('/api/login') || req.path.startsWith('/s/') ||
              req.path.startsWith('/login') || req.path.startsWith('/api/stream') ||
              req.path.startsWith('/api/me');
  // file statis (html/css/js/img/font) publik — tidak ada data sensitif
  const ext = path.extname(req.path).toLowerCase();
  const isStatic = req.method === 'GET' &&
    ['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
     '.woff', '.woff2', '.ttf', '.eot', '.map'].includes(ext);
  if (pub || isStatic) return next();
  if (ctx.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  // halaman SPA (shell) publik — tidak ada data sensitif; auth di-handle client-side
  return next();
}
app.use(requireAuth);

// resolve auth → konteks ALS: token API per-bot mengikat request ke profile-nya
function resolveAuth(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const tok = auth.slice(7);
    const row = db.prepare('SELECT * FROM api_tokens WHERE token=? AND active=1').get(tok);
    if (row) {
      const prof = db.prepare('SELECT * FROM profiles WHERE id=?').get(row.profile_id);
      if (prof) {
        try { db.prepare('UPDATE api_tokens SET last_used_at=? WHERE id=?').run(Date.now(), row.id); } catch {}
        return { profile: prof, user: { user_id: 0, username: 'api:' + (row.name || 'bot') } };
      }
    }
  }
  return { profile: null, user: getSessionUser(req) };
}

// ---------------- multi-bot profiles ----------------
db.exec(`CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  bot_username TEXT DEFAULT '',
  data_dir TEXT UNIQUE,
  password TEXT DEFAULT '',
  initialized INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 0,
  created_at INTEGER
)`);

function seedDefaultProfile() {
  const n = db.prepare('SELECT COUNT(*) c FROM profiles').get().c;
  if (n > 0) return;
  const hasConfig = fs.existsSync(path.join(TAS_DATA_DIR, 'config.json'));
  db.prepare('INSERT INTO profiles (name, bot_username, data_dir, password, initialized, is_active, created_at) VALUES (?,?,?,?,?,?,?)')
    .run('Default', '', TAS_DATA_DIR, TAS_PASSWORD, hasConfig ? 1 : 0, 1, Date.now());
  console.log('🌱 seed profile Default (data: ' + TAS_DATA_DIR + (hasConfig ? ', sudah init' : '') + ')');
}
seedDefaultProfile();
// backfill: data dir yang sudah punya config.json → tandai initialized
for (const p of db.prepare('SELECT * FROM profiles').all()) {
  if (!p.initialized && fs.existsSync(path.join(p.data_dir, 'config.json'))) {
    db.prepare('UPDATE profiles SET initialized=1 WHERE id=?').run(p.id);
  }
}

let activeProfile = db.prepare('SELECT * FROM profiles WHERE is_active=1').get() ||
  db.prepare('SELECT * FROM profiles ORDER BY id LIMIT 1').get();

function setActiveProfile(id) {
  db.prepare('UPDATE profiles SET is_active=0').run();
  db.prepare('UPDATE profiles SET is_active=1 WHERE id=?').run(id);
  activeProfile = db.prepare('SELECT * FROM profiles WHERE id=?').get(id);
}

function tasEnv(profile) {
  // prioritas: profile eksplisit > konteks request (token API per-bot) > aktif global
  const ctx = als.getStore() || {};
  const p = profile || ctx.profile || activeProfile;
  if (!p) return { ...process.env, TAS_PASSWORD, TAS_DATA_DIR };
  return { ...process.env, TAS_PASSWORD: p.password || '', TAS_DATA_DIR: p.data_dir };
}

function toProfile(p) {
  return {
    id: p.id, name: p.name, botUsername: p.bot_username,
    initialized: !!p.initialized, isActive: !!p.is_active, createdAt: p.created_at,
  };
}

const initJobs = new Map(); // profileId -> {status, message, botUsername}

// ---------------- profiles API ----------------
app.get('/api/profiles', (req, res) => {
  const rows = db.prepare('SELECT * FROM profiles ORDER BY id').all();
  res.json({ profiles: rows.map(toProfile), activeId: activeProfile.id });
});

app.get('/api/profiles/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM profiles WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Profile tidak ditemukan' });
  const job = initJobs.get(p.id);
  const initState = job ? job : (p.initialized
    ? { status: 'done', message: 'Siap' }
    : { status: 'idle', message: 'Belum di-init' });
  res.json({ ...toProfile(p), initState });
});

app.post('/api/profiles', (req, res) => {
  const n = db.prepare('SELECT COUNT(*) c FROM profiles').get().c;
  const name = (req.body?.name || '').trim().slice(0, 50) || ('Bot ' + (n + 1));
  const dir = path.join(TAS_DATA_DIR, 'profiles', String(Date.now()));
  fs.mkdirSync(dir, { recursive: true });
  const info = db.prepare('INSERT INTO profiles (name, data_dir, created_at) VALUES (?,?,?)')
    .run(name, dir, Date.now());
  logActivity('profile', 'create ' + name);
  res.json(toProfile(db.prepare('SELECT * FROM profiles WHERE id=?').get(info.lastInsertRowid)));
});

app.post('/api/profiles/:id/init', (req, res) => {
  const p = db.prepare('SELECT * FROM profiles WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Profile tidak ditemukan' });
  const token = (req.body?.token || '').trim();
  const password = req.body?.password || '';
  if (!token.includes(':')) return res.status(400).json({ error: 'Token bot tidak valid' });
  if (password.length < 8) return res.status(400).json({ error: 'Password minimal 8 karakter' });
  const existing = initJobs.get(p.id);
  if (existing && existing.status === 'running') return res.status(400).json({ error: 'Init sedang berjalan' });

  db.prepare('UPDATE profiles SET password=? WHERE id=?').run(password, p.id);
  const job = { status: 'running', message: 'Menghubungkan ke Telegram...', botUsername: '' };
  initJobs.set(p.id, job);
  logActivity('profile', 'init ' + p.name);

  const child = spawn('tas', ['init'], {
    env: {
      ...process.env,
      TAS_PASSWORD: password,
      TAS_DATA_DIR: p.data_dir,
      TAS_BOT_TOKEN: token, // patch-init-env: init non-interaktif
    },
  });
  let out = '';
  child.stdout.on('data', (d) => { out = (out + d).slice(-1200); });
  child.stderr.on('data', (d) => { out = (out + d).slice(-1200); });

  child.on('error', (err) => {
    job.status = 'error';
    job.message = err.message;
  });
  child.on('close', (code) => {
    if (code === 0) {
      const m = out.match(/Connected as @([A-Za-z0-9_]+)/);
      job.botUsername = m ? m[1] : '';
      db.prepare('UPDATE profiles SET initialized=1, bot_username=? WHERE id=?').run(job.botUsername, p.id);
      job.status = 'done';
      job.message = 'Tersambung ke @' + job.botUsername;
    } else {
      job.status = 'error';
      job.message = out.slice(-220) || ('exit ' + code);
    }
    // job sengaja DIPERTAHANKAN di map (terminal state) — biar error/done
    // terakhir masih kebaca; di-overwrite saat init berikutnya
  });
  res.json({ ok: true, profileId: p.id });
});

app.post('/api/profiles/:id/switch', (req, res) => {
  const p = db.prepare('SELECT * FROM profiles WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Profile tidak ditemukan' });
  setActiveProfile(p.id);
  logActivity('profile', 'switch → ' + p.name);
  res.json({ ok: true, active: toProfile(p) });
});

app.delete('/api/profiles/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM profiles WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Profile tidak ditemukan' });
  const c = db.prepare('SELECT COUNT(*) c FROM profiles').get().c;
  if (c <= 1) return res.status(400).json({ error: 'Tidak bisa hapus profile terakhir' });
  db.prepare('DELETE FROM profiles WHERE id=?').run(p.id);
  if (p.is_active) {
    const next = db.prepare('SELECT * FROM profiles ORDER BY id LIMIT 1').get();
    setActiveProfile(next.id);
  }
  logActivity('profile', 'delete ' + p.name);
  // data dir TIDAK dihapus (aman) — biar file di Telegram tetap bisa diakses lagi
  res.json({ ok: true, dataDirKept: p.data_dir });
});

// ---------------- TAS helpers ----------------
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

app.get('/api/me', (req, res) => {
  const ctx = als.getStore() || {};
  res.json(ctx.user || null);
});

// ---------------- API tokens (per-bot, utk integrasi) ----------------
db.exec(`CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE,
  profile_id INTEGER,
  name TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  created_at INTEGER,
  last_used_at INTEGER
)`);

app.get('/api/tokens', (req, res) => {
  const rows = db.prepare(`SELECT t.id, t.token, t.name, t.profile_id, p.name AS profile_name, t.active, t.created_at, t.last_used_at
    FROM api_tokens t LEFT JOIN profiles p ON p.id=t.profile_id ORDER BY t.id DESC`).all();
  res.json({ tokens: rows.map((r) => ({ ...r, token: r.token.slice(0, 8) + '…' })) });
});

app.post('/api/tokens', (req, res) => {
  const profileId = parseInt(req.body?.profileId, 10);
  const name = (req.body?.name || '').trim().slice(0, 60) || 'Token';
  const prof = db.prepare('SELECT * FROM profiles WHERE id=?').get(profileId);
  if (!prof) return res.status(400).json({ error: 'Profile bot tidak ditemukan' });
  const token = 'tas_' + crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO api_tokens (token, profile_id, name, created_at) VALUES (?,?,?,?)')
    .run(token, profileId, name, Date.now());
  logActivity('token', 'create "' + name + '" utk ' + prof.name);
  res.json({ token, name, profileId, profileName: prof.name });
});

app.delete('/api/tokens/:id', (req, res) => {
  db.prepare('UPDATE api_tokens SET active=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

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

// upload dari URL (server yang download) — STREAM ke disk, jangan buffer di RAM
app.post('/api/upload-url', (req, res) => {
  const url = (req.body?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'URL tidak valid' });
  const job = createJob(url.slice(0, 60));
  const filePath = path.join(TMP_DIR, 'url-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'));
  (async () => {
    let ws = null;
    try {
      const r = await fetch(url, { redirect: 'follow' });
      if (!r.ok) throw new Error('Gagal download: HTTP ' + r.status);
      ws = fs.createWriteStream(filePath);
      await new Promise((resolve, reject) => {
        Readable.fromWeb(r.body).pipe(ws)
          .on('finish', resolve)
          .on('error', reject);
      });
      const st = fs.statSync(filePath);
      if (!st.size) throw new Error('File kosong');
      const name = (req.body?.name || decodeURIComponent(url.split('/').pop() || 'download')).split('?')[0].slice(0, 200);
      pushJob(job, filePath, name);
    } catch (e) {
      finishJob(job, e);
      try { if (ws) ws.destroy(); fs.unlinkSync(filePath); } catch {}
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
