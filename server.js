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
        const app = row.app_id ? db.prepare('SELECT * FROM apps WHERE id=?').get(row.app_id) : null;
        try { db.prepare('UPDATE api_tokens SET last_used_at=? WHERE id=?').run(Date.now(), row.id); } catch {}
        return { app, profile: prof, user: { user_id: 0, username: 'api:' + (row.name || 'bot') } };
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
  // bot baru langsung di-attach ke app yang dipilih (default: app pertama)
  const appId = parseInt(req.body?.appId, 10) || appIdFor(req);
  if (appId) db.prepare('INSERT OR IGNORE INTO app_profiles (app_id, profile_id) VALUES (?,?)').run(appId, info.lastInsertRowid);
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
  stopBotIngest(p.id); // jeda polling bot ini dulu (tas init pakai getUpdates utk waitForChatId)
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
      startBotIngest(); // bot baru siap → aktifkan polling kalau profile ini aktif
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
  startBotIngest(); // polling bot ikut pindah ke profile baru
  res.json({ ok: true, active: toProfile(p) });
});

app.delete('/api/profiles/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM profiles WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Profile tidak ditemukan' });
  const c = db.prepare('SELECT COUNT(*) c FROM profiles').get().c;
  if (c <= 1) return res.status(400).json({ error: 'Tidak bisa hapus profile terakhir' });
  stopBotIngest(p.id); // berhenti polling bot profile yang dihapus
  db.prepare('DELETE FROM app_profiles WHERE profile_id=?').run(p.id);
  db.prepare('DELETE FROM profiles WHERE id=?').run(p.id);
  if (p.is_active) {
    const next = db.prepare('SELECT * FROM profiles ORDER BY id LIMIT 1').get();
    setActiveProfile(next.id);
  }
  logActivity('profile', 'delete ' + p.name);
  // data dir TIDAK dihapus (aman) — biar file di Telegram tetap bisa diakses lagi
  res.json({ ok: true, dataDirKept: p.data_dir });
});

// ---------------- apps API ----------------
app.get('/api/apps', (req, res) => {
  const apps = db.prepare('SELECT * FROM apps ORDER BY id').all().map(toApp);
  const memberships = db.prepare('SELECT app_id, profile_id FROM app_profiles').all();
  const counts = db.prepare('SELECT app_id, COUNT(*) c FROM app_profiles GROUP BY app_id').all();
  for (const a of apps) {
    a.bots = memberships.filter((m) => m.app_id === a.id).map((m) => m.profile_id);
    a.botCount = (counts.find((c) => c.app_id === a.id) || {}).c || 0;
  }
  res.json({ apps });
});

app.post('/api/apps', (req, res) => {
  const name = (req.body?.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Nama app wajib diisi' });
  const info = db.prepare('INSERT INTO apps (name, description, created_at) VALUES (?,?,?)')
    .run(name, (req.body?.description || '').toString().slice(0, 200), Date.now());
  logActivity('app', 'create "' + name + '"');
  res.json(toApp(db.prepare('SELECT * FROM apps WHERE id=?').get(info.lastInsertRowid)));
});

app.post('/api/apps/:id/rename', (req, res) => {
  const a = db.prepare('SELECT * FROM apps WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'App tidak ditemukan' });
  const name = (req.body?.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Nama app wajib diisi' });
  db.prepare('UPDATE apps SET name=? WHERE id=?').run(name, a.id);
  logActivity('app', 'rename "' + name + '"');
  res.json(toApp({ ...a, name }));
});

app.delete('/api/apps/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM apps WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'App tidak ditemukan' });
  const c = db.prepare('SELECT COUNT(*) c FROM apps').get().c;
  if (c <= 1) return res.status(400).json({ error: 'Tidak bisa hapus app terakhir' });
  db.transaction(() => {
    db.prepare('DELETE FROM app_profiles WHERE app_id=?').run(a.id);
    db.prepare('DELETE FROM api_tokens WHERE app_id=?').run(a.id);
    db.prepare('DELETE FROM folder_files WHERE folder_id IN (SELECT id FROM folders WHERE app_id=?)').run(a.id);
    db.prepare('DELETE FROM folders WHERE app_id=?').run(a.id);
    db.prepare('DELETE FROM apps WHERE id=?').run(a.id);
  })();
  logActivity('app', 'delete "' + a.name + '"');
  res.json({ ok: true });
});

// attach/detach bot ke app (many-to-many: 1 bot bisa di banyak app)
app.post('/api/apps/:id/bots', (req, res) => {
  const a = db.prepare('SELECT * FROM apps WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'App tidak ditemukan' });
  const p = db.prepare('SELECT * FROM profiles WHERE id=?').get(parseInt(req.body?.profileId, 10) || 0);
  if (!p) return res.status(400).json({ error: 'Bot tidak ditemukan' });
  db.prepare('INSERT OR IGNORE INTO app_profiles (app_id, profile_id) VALUES (?,?)').run(a.id, p.id);
  logActivity('app', 'attach bot "' + p.name + '" → "' + a.name + '"');
  res.json({ ok: true });
});

app.delete('/api/apps/:id/bots/:profileId', (req, res) => {
  db.prepare('DELETE FROM app_profiles WHERE app_id=? AND profile_id=?').run(req.params.id, req.params.profileId);
  logActivity('app', 'detach bot #' + req.params.profileId);
  res.json({ ok: true });
});

// ---------------- TAS helpers ----------------
function runTas(args, timeoutMs = 900000, profile = null) {
  return new Promise((resolve, reject) => {
    execFile('tas', args, { env: tasEnv(profile), timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
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

async function findRecord(id, profile = null) {
  const { stdout } = await runTas(['list', '--json'], 900000, profile);
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

function pushJob(job, filePath, name, folderId, onDone, profile) {
  if (folderId) job.folderId = folderId;
  const child = spawn('tas', ['push', filePath, '--name', name], { env: tasEnv(profile) });
  let outTail = '';
  child.stdout.on('data', (d) => { outTail = (outTail + d).slice(-800); });
  child.stderr.on('data', (d) => { outTail = (outTail + d).slice(-800); });
  child.on('error', (err) => { job.tmpPath = filePath; finishJob(job, err); });
  child.on('close', (code) => {
    if (code === 0) {
      try { fs.unlinkSync(filePath); } catch {}
      job.tmpPath = null;
      const m = outTail.match(/Hash:\s*([A-Za-z0-9]+)/);
      if (m) job.hash = m[1];
      // auto-masuk folder kalau upload dimulai dari dalam folder
      if (job.folderId && job.hash) {
        if (db.prepare('SELECT id FROM folders WHERE id=?').get(job.folderId)) {
          db.prepare('INSERT OR REPLACE INTO folder_files (folder_id, file_hash, added_at) VALUES (?,?,?)')
            .run(job.folderId, job.hash, Date.now());
        }
      }
      logActivity('upload', name);
      finishJob(job, null, `Upload selesai: ${name}`);
    } else {
      job.tmpPath = filePath; // simpan utk retry
      finishJob(job, new Error(`tas push gagal (exit ${code}): ${outTail.slice(-300)}`));
    }
    if (onDone) onDone(job);
  });
}

// ---------------- bot ingest: upload via Telegram bot ----------------
// User kirim file ke bot → bot download → tas push (chunk terenkripsi masuk
// chat) → pesan asli user dihapus → file muncul di list web.
const BOT_INGEST = process.env.BOT_INGEST !== '0';
const BOT_INGEST_MAX = 20 * 1024 * 1024; // Bot API getFile limit 20MB
const BOT_API = 'https://api.telegram.org';

function fmtBytes(b) {
  if (b == null || isNaN(b)) return '0 B';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

// jejak pesan konfirmasi ✅ di chat — dihapus bareng file-nya saat delete dari web
db.exec(`CREATE TABLE IF NOT EXISTS ingest_confirmations (
  file_hash TEXT,
  profile_id INTEGER,
  chat_id INTEGER,
  msg_id INTEGER,
  created_at INTEGER
)`);

// dekripsi encryptedBotToken (AES-256-GCM + PBKDF2-600k, format tas-cli v2)
function decryptBotToken(profile) {
  if (process.env.TAS_BOT_TOKEN) return process.env.TAS_BOT_TOKEN; // override manual
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(profile.data_dir, 'config.json'), 'utf8'));
    if (cfg.botToken) return cfg.botToken; // config v1 (plaintext)
    if (cfg.encryptedBotToken && profile.password) {
      const b = Buffer.from(cfg.encryptedBotToken, 'base64');
      const salt = b.subarray(0, 32), iv = b.subarray(32, 44);
      const tag = b.subarray(-16), ct = b.subarray(44, -16);
      const key = crypto.pbkdf2Sync(profile.password, salt, 600000, 32, 'sha512');
      const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
    }
  } catch (e) { console.log('⚠️ decryptBotToken gagal:', e.message); }
  return null;
}

async function tgApi(token, method, params = {}, timeoutMs = 70000) {
  const res = await fetch(`${BOT_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`TG ${method}: ${data.description || ('HTTP ' + res.status)}`);
  return data.result;
}

const botPolls = new Map(); // profileId -> { token, botId, offset, processed:Set, stopped }

// stopBotIngest(profileId?) — tanpa arg = stop SEMUA; dgn arg = stop satu profile
function stopBotIngest(profileId) {
  if (profileId) {
    const p = botPolls.get(profileId);
    if (p) { p.stopped = true; botPolls.delete(profileId); }
    return;
  }
  for (const p of botPolls.values()) p.stopped = true;
  botPolls.clear();
}

// aktifkan polling utk SEMUA profile yang sudah initialized — tiap bot
// meng-ingest file ke storage profile-nya masing-masing
async function startBotIngest() {
  if (!BOT_INGEST) return;
  const profs = db.prepare('SELECT * FROM profiles WHERE initialized=1').all();
  for (const prof of profs) {
    if (botPolls.has(prof.id)) continue; // sudah polling
    const token = decryptBotToken(prof);
    if (!token) {
      console.log(`📥 Bot ingest: token bot tidak ditemukan utk profile "${prof.name}"`);
      continue;
    }
    try {
      const me = await tgApi(token, 'getMe', {}, 15000);
      const p = { token, botId: me.id, profileId: prof.id, offset: 0, processed: new Set(), stopped: false };
      botPolls.set(prof.id, p);
      // sinkronisasi offset ke update terbaru → pesan lama tidak diproses ulang
      try {
        const last = await tgApi(token, 'getUpdates', { offset: -1, timeout: 1 });
        if (last.length) p.offset = last[last.length - 1].update_id + 1;
      } catch {}
      console.log(`📥 Bot ingest aktif: @${me.username} → profile "${prof.name}" (file ≤20MB, pesan asli dihapus setelah tersimpan)`);
      pollLoop(prof.id);
    } catch (e) {
      console.log(`⚠️ Bot ingest "${prof.name}": getMe gagal — ` + e.message.slice(0, 120));
    }
  }
}

async function pollLoop(profileId) {
  const p = botPolls.get(profileId);
  if (!p || p.stopped) return;
  try {
    const updates = await tgApi(p.token, 'getUpdates', {
      offset: p.offset, timeout: 50, allowed_updates: ['message'],
    });
    for (const u of updates) {
      p.offset = u.update_id + 1;
      if (u.message) {
        try { await handleIncomingMessage(p, u.message); }
        catch (e) { console.log('⚠️ handle pesan gagal:', e.message.slice(0, 150)); }
      }
    }
  } catch (e) {
    // timeout long-poll = normal; error lain → jeda sebentar
    if (!/timed? ?out|abort|fetch failed/i.test(e.message)) {
      console.log('⚠️ poll loop:', e.message.slice(0, 120));
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (botPolls.get(profileId) === p) setTimeout(() => pollLoop(profileId), 250);
}

// pilih file dari pesan (document/video/photo/audio/voice/video_note/animation)
function pickFile(msg) {
  if (msg.document) return { fileId: msg.document.file_id, fileName: msg.document.file_name || 'document.bin', fileSize: msg.document.file_size };
  if (msg.video) return { fileId: msg.video.file_id, fileName: msg.video.file_name || 'video.mp4', fileSize: msg.video.file_size };
  if (msg.photo && msg.photo.length) { const ph = msg.photo[msg.photo.length - 1]; return { fileId: ph.file_id, fileName: null, fileSize: ph.file_size }; }
  if (msg.audio) return { fileId: msg.audio.file_id, fileName: msg.audio.file_name || 'audio.mp3', fileSize: msg.audio.file_size };
  if (msg.voice) return { fileId: msg.voice.file_id, fileName: null, fileSize: msg.voice.file_size };
  if (msg.video_note) return { fileId: msg.video_note.file_id, fileName: null, fileSize: msg.video_note.file_size };
  if (msg.animation) return { fileId: msg.animation.file_id, fileName: msg.animation.file_name || 'animation.gif', fileSize: msg.animation.file_size };
  return null;
}

function fallbackName(msg) {
  const ts = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  if (msg.photo) return `photo_${ts}.jpg`;
  if (msg.voice) return `voice_${ts}.ogg`;
  if (msg.video_note) return `video_note_${ts}.mp4`;
  if (msg.animation) return `animation_${ts}.gif`;
  return `file_${ts}.bin`;
}

async function tgReply(p, chatId, text) {
  try {
    const r = await tgApi(p.token, 'sendMessage', { chat_id: chatId, text }, 15000);
    return r ? r.message_id : null;
  } catch { return null; }
}

async function deleteOriginal(p, chatId, msgId) {
  try {
    await tgApi(p.token, 'deleteMessage', { chat_id: chatId, message_id: msgId }, 15000);
  } catch (e) {
    console.log('⚠️ hapus pesan asli gagal:', e.message.slice(0, 100));
  }
}

async function handleIncomingMessage(p, msg) {
  if (!msg || msg.from?.id === p.botId) return; // pesan bot sendiri (chunk terenkripsi) → skip
  const chatId = msg.chat?.id;
  const msgId = msg.message_id;
  if (chatId == null || msgId == null) return;
  if (p.processed.has(msgId)) return;
  p.processed.add(msgId);
  if (p.processed.size > 2000) p.processed.clear();

  const file = pickFile(msg);
  if (!file) return; // teks/stiker/dll → abaikan

  const name = (file.fileName || fallbackName(msg)).replace(/[^\w.\-() ]+/g, '_').slice(0, 180);
  const size = file.fileSize || 0;
  if (size > BOT_INGEST_MAX) {
    await tgReply(p, chatId, `⚠️ "${name}" (${fmtBytes(size)}) melebihi limit 20MB Bot API — upload lewat web saja.`);
    return; // pesan asli TIDAK dihapus
  }

  // download file dari Telegram
  let filePath = null;
  try {
    const f = await tgApi(p.token, 'getFile', { file_id: file.fileId });
    if (!f.file_path) throw new Error('file_path kosong');
    const ext = path.extname(name) || '';
    filePath = path.join(TMP_DIR, `bot-${Date.now()}-${crypto.randomBytes(3).toString('hex')}${ext}`);
    const r = await fetch(`${BOT_API}/file/bot${p.token}/${f.file_path}`, { signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw new Error('download HTTP ' + r.status);
    fs.writeFileSync(filePath, Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    await tgReply(p, chatId, `⚠️ Gagal ambil file "${name}": ${e.message.slice(0, 150)}`);
    return;
  }

  // push ke storage profile bot ini — chunk terenkripsi otomatis dikirim balik
  // ke chat oleh tas (jangan lupa profile eksplisit: bukan selalu yg aktif)
  const prof = db.prepare('SELECT * FROM profiles WHERE id=?').get(p.profileId);
  if (!prof) return;
  const job = createJob(name);
  job.size = size;
  job.message = 'Ingest dari Telegram...';
  await new Promise((resolve) => {
    pushJob(job, filePath, name, null, async () => {
      if (job.status === 'done') {
        logActivity('upload', 'bot: ' + name);
        const sent = await tgReply(p, chatId, `✅ "${name}" (${fmtBytes(size)}) tersimpan — chunk terenkripsi ada di chat ini & terlihat di tas-web.`);
        // jejak pesan konfirmasi → ikut terhapus saat file di-delete dari web
        if (job.hash && sent) {
          db.prepare('INSERT OR REPLACE INTO ingest_confirmations (file_hash, profile_id, chat_id, msg_id, created_at) VALUES (?,?,?,?,?)')
            .run(job.hash, p.profileId, chatId, sent, Date.now());
        }
        deleteOriginal(p, chatId, msgId); // hapus pesan asli user
      } else {
        tgReply(p, chatId, `❌ Gagal simpan "${name}": ${job.message.slice(0, 200)}`);
      }
      resolve();
    }, prof);
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

// ---------------- apps (workspace: grup bot + API keys) ----------------
db.exec(`CREATE TABLE IF NOT EXISTS apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS app_profiles (
  app_id INTEGER NOT NULL,
  profile_id INTEGER NOT NULL,
  PRIMARY KEY (app_id, profile_id)
);`);
// kolom app_id utk api_tokens & folders (kalau belum ada — migrasi)
const tokCols = db.prepare('PRAGMA table_info(api_tokens)').all();
if (!tokCols.some((c) => c.name === 'app_id')) db.exec('ALTER TABLE api_tokens ADD COLUMN app_id INTEGER');
const folderCols = db.prepare('PRAGMA table_info(folders)').all();
if (!folderCols.some((c) => c.name === 'app_id')) db.exec('ALTER TABLE folders ADD COLUMN app_id INTEGER');

function seedDefaultApp() {
  if (db.prepare('SELECT COUNT(*) c FROM apps').get().c > 0) return;
  const info = db.prepare('INSERT INTO apps (name, description, created_at) VALUES (?,?,?)')
    .run('Default', 'App utama (migrasi otomatis)', Date.now());
  const appId = info.lastInsertRowid;
  const ins = db.prepare('INSERT OR IGNORE INTO app_profiles (app_id, profile_id) VALUES (?,?)');
  for (const p of db.prepare('SELECT id FROM profiles').all()) ins.run(appId, p.id);
  console.log('🌱 seed app Default (id ' + appId + ') — semua bot di-attach');
}
seedDefaultApp();
// baris legacy tanpa app → app pertama
const firstApp = db.prepare('SELECT id FROM apps ORDER BY id LIMIT 1').get();
if (firstApp) {
  db.prepare('UPDATE folders SET app_id=? WHERE app_id IS NULL').run(firstApp.id);
  db.prepare('UPDATE api_tokens SET app_id=? WHERE app_id IS NULL').run(firstApp.id);
}

function toApp(a) {
  return { id: a.id, name: a.name, description: a.description, createdAt: a.created_at };
}

// resolve app utk operasi per-app: query param > konteks token API > app pertama
function appIdFor(req) {
  if (req?.query?.appId) return parseInt(req.query.appId, 10) || null;
  const ctx = als.getStore() || {};
  if (ctx.app?.id) return ctx.app.id;
  const first = db.prepare('SELECT id FROM apps ORDER BY id LIMIT 1').get();
  return first ? first.id : null;
}

// ---------------- folders (virtual, model Google Drive) ----------------
// File asli tetap di Telegram (flat). Folder = layer organisasi di SQLite:
// folder bertingkat (parent_id), 1 file (by hash) maksimal di 1 folder.
db.exec(`CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS folder_files (
  folder_id INTEGER NOT NULL,
  file_hash TEXT PRIMARY KEY,
  added_at INTEGER
);`);

app.get('/api/folders', (req, res) => {
  const appId = appIdFor(req);
  const folders = appId
    ? db.prepare('SELECT * FROM folders WHERE app_id=? ORDER BY name').all(appId)
    : db.prepare('SELECT * FROM folders ORDER BY name').all();
  const counts = db.prepare('SELECT folder_id, COUNT(*) c FROM folder_files GROUP BY folder_id').all();
  const countMap = {};
  for (const c of counts) countMap[c.folder_id] = c.c;
  const fileFolders = {};
  for (const row of db.prepare('SELECT folder_id, file_hash FROM folder_files').all()) {
    fileFolders[row.file_hash] = row.folder_id;
  }
  res.json({
    folders: folders.map((f) => ({
      id: f.id, name: f.name, parentId: f.parent_id,
      createdAt: f.created_at, fileCount: countMap[f.id] || 0,
    })),
    fileFolders,
  });
});

app.post('/api/folders', (req, res) => {
  const name = (req.body?.name || '').trim().slice(0, 100);
  if (!name) return res.status(400).json({ error: 'Nama folder wajib diisi' });
  const parentId = req.body?.parentId ? parseInt(req.body.parentId, 10) : null;
  if (parentId && !db.prepare('SELECT id FROM folders WHERE id=?').get(parentId)) {
    return res.status(400).json({ error: 'Folder induk tidak ditemukan' });
  }
  const info = db.prepare('INSERT INTO folders (name, parent_id, app_id, created_at) VALUES (?,?,?,?)')
    .run(name, parentId, appIdFor(req), Date.now());
  logActivity('folder', 'create "' + name + '"');
  res.json({ id: info.lastInsertRowid, name, parentId, createdAt: Date.now(), fileCount: 0 });
});

app.put('/api/folders/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM folders WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Folder tidak ditemukan' });
  const name = req.body?.name !== undefined && String(req.body.name).trim()
    ? String(req.body.name).trim().slice(0, 100) : f.name;
  let parentId = f.parent_id;
  if (req.body.parentId !== undefined) {
    parentId = req.body.parentId ? parseInt(req.body.parentId, 10) : null;
    if (parentId === f.id) return res.status(400).json({ error: 'Folder tidak bisa jadi induk dirinya sendiri' });
    if (parentId) {
      // cegah siklus: telusuri rantai induk
      let cur = parentId; const seen = new Set();
      while (cur) {
        if (cur === f.id) return res.status(400).json({ error: 'Terjadi siklus folder' });
        if (seen.has(cur)) break;
        seen.add(cur);
        const p = db.prepare('SELECT parent_id FROM folders WHERE id=?').get(cur);
        cur = p ? p.parent_id : null;
      }
      if (!db.prepare('SELECT id FROM folders WHERE id=?').get(parentId)) {
        return res.status(400).json({ error: 'Folder induk tidak ditemukan' });
      }
    }
  }
  db.prepare('UPDATE folders SET name=?, parent_id=? WHERE id=?').run(name, parentId, f.id);
  logActivity('folder', 'rename "' + name + '"');
  res.json({ id: f.id, name, parentId, createdAt: f.created_at, fileCount: db.prepare('SELECT COUNT(*) c FROM folder_files WHERE folder_id=?').get(f.id).c });
});

// alias gaya POST (konsisten dgn endpoint lain di codebase)
app.post('/api/folders/:id/rename', (req, res) => {
  const f = db.prepare('SELECT * FROM folders WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Folder tidak ditemukan' });
  const name = (req.body?.name || '').trim().slice(0, 100);
  if (!name) return res.status(400).json({ error: 'Nama folder wajib diisi' });
  db.prepare('UPDATE folders SET name=? WHERE id=?').run(name, f.id);
  logActivity('folder', 'rename "' + name + '"');
  res.json({ id: f.id, name, parentId: f.parent_id, createdAt: f.created_at });
});

app.delete('/api/folders/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM folders WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Folder tidak ditemukan' });
  db.transaction(() => {
    // subfolder naik ke parent; file pindah ke parent (atau root kalau parent kosong)
    db.prepare('UPDATE folders SET parent_id=? WHERE parent_id=?').run(f.parent_id, f.id);
    if (f.parent_id) db.prepare('UPDATE folder_files SET folder_id=? WHERE folder_id=?').run(f.parent_id, f.id);
    else db.prepare('DELETE FROM folder_files WHERE folder_id=?').run(f.id);
    db.prepare('DELETE FROM folders WHERE id=?').run(f.id);
  })();
  logActivity('folder', 'delete "' + f.name + '"');
  res.json({ ok: true });
});

// pindahkan file (by hash) ke folder; folderId null/kosong = kembali ke root
app.post('/api/files/folder', (req, res) => {
  const hashes = (req.body?.hashes || []).slice(0, 100).map(String).filter(Boolean);
  if (!hashes.length) return res.status(400).json({ error: 'Pilih minimal 1 file' });
  const folderId = req.body?.folderId ? parseInt(req.body.folderId, 10) : null;
  if (folderId && !db.prepare('SELECT id FROM folders WHERE id=?').get(folderId)) {
    return res.status(400).json({ error: 'Folder tidak ditemukan' });
  }
  db.transaction(() => {
    for (const h of hashes) {
      db.prepare('DELETE FROM folder_files WHERE file_hash=?').run(h);
      if (folderId) {
        db.prepare('INSERT OR REPLACE INTO folder_files (folder_id, file_hash, added_at) VALUES (?,?,?)')
          .run(folderId, h, Date.now());
      }
    }
  })();
  logActivity('folder', 'move ' + hashes.length + ' file');
  res.json({ ok: true, count: hashes.length, folderId });
});

app.get('/api/tokens', (req, res) => {
  const appId = parseInt(req.query.appId, 10) || null;
  const base = `SELECT t.id, t.token, t.name, t.profile_id, p.name AS profile_name, t.active, t.created_at, t.last_used_at, t.app_id,
    a.name AS app_name FROM api_tokens t LEFT JOIN profiles p ON p.id=t.profile_id LEFT JOIN apps a ON a.id=t.app_id`;
  const rows = appId
    ? db.prepare(base + ' WHERE t.app_id=? ORDER BY t.id DESC').all(appId)
    : db.prepare(base + ' ORDER BY t.id DESC').all();
  res.json({ tokens: rows });
});

app.post('/api/tokens', (req, res) => {
  const profileId = parseInt(req.body?.profileId, 10);
  const appId = parseInt(req.body?.appId, 10) || null;
  const name = (req.body?.name || '').trim().slice(0, 60) || 'Token';
  const prof = db.prepare('SELECT * FROM profiles WHERE id=?').get(profileId);
  if (!prof) return res.status(400).json({ error: 'Profile bot tidak ditemukan' });
  if (appId) {
    const a = db.prepare('SELECT * FROM apps WHERE id=?').get(appId);
    if (!a) return res.status(400).json({ error: 'App tidak ditemukan' });
    const m = db.prepare('SELECT 1 FROM app_profiles WHERE app_id=? AND profile_id=?').get(appId, profileId);
    if (!m) return res.status(400).json({ error: 'Bot tidak terdaftar di app tersebut' });
  }
  const token = 'tas_' + crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO api_tokens (token, profile_id, app_id, name, created_at) VALUES (?,?,?,?,?)')
    .run(token, profileId, appId, name, Date.now());
  logActivity('token', 'create "' + name + '" utk ' + prof.name);
  res.json({ token, name, profileId, appId, profileName: prof.name });
});

app.delete('/api/tokens/:id', (req, res) => {
  // hard delete: hapus baris token sepenuhnya (bukan cuma nonaktifkan)
  const info = db.prepare('DELETE FROM api_tokens WHERE id=?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Token tidak ditemukan' });
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
    // ?all=1 → gabungan file dari semua bot di app (tiap file dilabeli bot asal)
    if (req.query.all === '1') {
      const ctx = als.getStore() || {};
      const appId = parseInt(req.query.appId, 10) || ctx.app?.id || appIdFor(req);
      const profs = appId
        ? db.prepare('SELECT p.* FROM profiles p JOIN app_profiles ap ON ap.profile_id=p.id WHERE ap.app_id=?').all(appId)
        : db.prepare('SELECT * FROM profiles WHERE initialized=1').all();
      const files = [];
      for (const prof of profs) {
        try {
          const { stdout } = await runTas(['list', '--json'], 900000, prof);
          for (const f of parseTasJson(stdout)) files.push({ ...f, profileId: prof.id, profileName: prof.name });
        } catch {}
      }
      return res.json({ files });
    }
    const { stdout } = await runTas(['list', '--json']);
    res.json({ files: parseTasJson(stdout) });
  } catch (e) {
    res.json({ files: [], error: e.message });
  }
});

// resolve bot target dari query (dipakai operasi file di view "semua bot")
function profileFromQuery(req) {
  const pid = parseInt(req.query.profileId, 10);
  return pid ? db.prepare('SELECT * FROM profiles WHERE id=?').get(pid) : null;
}

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
  const folderId = req.body?.folderId ? parseInt(req.body.folderId, 10) : null;
  if (folderId && !db.prepare('SELECT id FROM folders WHERE id=?').get(folderId)) {
    return res.status(400).json({ error: 'Folder tidak ditemukan' });
  }
  const jobsOut = [];
  for (const f of req.files) {
    const job = createJob(f.originalname);
    pushJob(job, f.path, f.originalname, folderId);
    jobsOut.push({ jobId: job.id, name: f.originalname });
  }
  res.json({ jobs: jobsOut });
});

// upload dari URL (server yang download) — STREAM ke disk, jangan buffer di RAM
app.post('/api/upload-url', (req, res) => {
  const url = (req.body?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'URL tidak valid' });
  const folderId = req.body?.folderId ? parseInt(req.body.folderId, 10) : null;
  if (folderId && !db.prepare('SELECT id FROM folders WHERE id=?').get(folderId)) {
    return res.status(400).json({ error: 'Folder tidak ditemukan' });
  }
  const job = createJob(url.slice(0, 60));
  if (folderId) job.folderId = folderId;
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
  const prof = profileFromQuery(req);
  const outPath = path.join(DL_DIR, 'dl-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'));
  try {
    const rec = await findRecord(id, prof);
    if (!rec) return res.status(404).json({ error: 'File tidak ditemukan' });
    await runTas(['pull', id, outPath], 900000, prof);
    logActivity('download', rec.filename);
    res.download(outPath, rec.filename, () => { try { fs.unlinkSync(outPath); } catch {} });
  } catch (e) {
    try { fs.unlinkSync(outPath); } catch {}
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/delete/:id', (req, res) => {
  // --hard: hapus dari index DAN dari chat Telegram (sync penuh)
  const prof = profileFromQuery(req);
  const child = spawn('tas', ['delete', req.params.id, '--hard'], { env: tasEnv(prof) });
  let out = '';
  child.stdout.on('data', (d) => { out = (out + d).slice(-600); });
  child.stderr.on('data', (d) => { out = (out + d).slice(-600); });
  child.on('error', (err) => res.status(500).json({ error: err.message }));
  child.stdin.write('y\n');
  child.stdin.end();
  child.on('close', (code) => {
    if (code === 0) {
      logActivity('delete', req.params.id.slice(0, 16));
      // bersihkan mapping folder (id = hash karena frontend kirim f.hash)
      db.prepare('DELETE FROM folder_files WHERE file_hash=?').run(req.params.id);
      // hapus juga pesan konfirmasi ✅ bot-ingest di chat (kalau ada)
      try {
        const ctx = als.getStore() || {};
        const prof = ctx.profile || activeProfile;
        if (prof) {
          const row = db.prepare('SELECT * FROM ingest_confirmations WHERE file_hash=? AND profile_id=?')
            .get(req.params.id, prof.id);
          if (row) {
            db.prepare('DELETE FROM ingest_confirmations WHERE file_hash=? AND profile_id=?').run(req.params.id, prof.id);
            const token = decryptBotToken(prof);
            if (token) {
              tgApi(token, 'deleteMessage', { chat_id: row.chat_id, message_id: row.msg_id }, 15000).catch(() => {});
            }
          }
        }
      } catch {}
      res.json({ ok: true });
    } else {
      res.status(500).json({ error: out.slice(-300) || `exit ${code}` });
    }
  });
});

// ---------------- streaming ----------------
const pullPromises = new Map();

function ensureCached(id, cachePath, profile = null) {
  if (fs.existsSync(cachePath)) return Promise.resolve(cachePath);
  if (pullPromises.has(cachePath)) return pullPromises.get(cachePath);
  const p = runTas(['pull', id, cachePath], 1200000, profile)
    .then(() => cachePath)
    .catch((e) => { try { fs.unlinkSync(cachePath); } catch {} throw e; })
    .finally(() => pullPromises.delete(cachePath));
  pullPromises.set(cachePath, p);
  return p;
}

app.get('/api/stream/:id', async (req, res) => {
  const id = req.params.id;
  const prof = profileFromQuery(req);
  try {
    const rec = await findRecord(id, prof);
    if (!rec) return res.status(404).json({ error: 'File tidak ditemukan' });
    const ext = path.extname(rec.filename || '') || '.bin';
    // cache per profile — hash bisa sama di dua bot berbeda
    const cachePath = path.join(CACHE_DIR, `${rec.hash}-${prof ? prof.id : 'x'}${ext}`);
    await ensureCached(id, cachePath, prof);
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

// ---------------- S3 gateway credentials ----------------
// Access key + secret utk klien S3 (rclone/s3cmd/aws cli). 1 bot = 1 bucket.
db.exec(`CREATE TABLE IF NOT EXISTS s3_creds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER UNIQUE,
  access_key TEXT UNIQUE,
  secret_key TEXT,
  created_at INTEGER
)`);

app.get('/api/s3', (req, res) => {
  const rows = db.prepare(`SELECT c.id, c.profile_id, c.access_key, c.created_at, p.name AS profile_name,
    p.bot_username FROM s3_creds c LEFT JOIN profiles p ON p.id=c.profile_id ORDER BY c.id`).all();
  res.json({ creds: rows });
});

app.post('/api/s3/creds', (req, res) => {
  const profileId = parseInt(req.body?.profileId, 10);
  const prof = db.prepare('SELECT * FROM profiles WHERE id=?').get(profileId);
  if (!prof) return res.status(400).json({ error: 'Bot tidak ditemukan' });
  const existing = db.prepare('SELECT * FROM s3_creds WHERE profile_id=?').get(profileId);
  if (existing) return res.status(400).json({ error: 'Bot ini sudah punya kredensial S3 — hapus dulu kalau mau buat ulang' });
  const accessKey = 'tas' + crypto.randomBytes(12).toString('hex').slice(0, 20);
  const secretKey = crypto.randomBytes(24).toString('base64url');
  const info = db.prepare('INSERT INTO s3_creds (profile_id, access_key, secret_key, created_at) VALUES (?,?,?,?)')
    .run(profileId, accessKey, secretKey, Date.now());
  logActivity('s3', 'create creds utk ' + prof.name);
  res.json({
    id: info.lastInsertRowid, profileId, profileName: prof.name,
    accessKey, secretKey, // secret hanya muncul SEKALI saat dibuat
    bucket: bucketForProfile(prof),
    endpoint: S3_PREFIX,
  });
});

app.delete('/api/s3/creds/:id', (req, res) => {
  const info = db.prepare('DELETE FROM s3_creds WHERE id=?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Kredensial tidak ditemukan' });
  res.json({ ok: true });
});

// ---------------- S3-compatible gateway ----------------
// tas-web bertingkah sebagai S3 object storage (path-style, SigV4).
// File tetap disimpan di Telegram via backend tas — 1 bot = 1 bucket.
const S3_PREFIX = '/s3';
const S3_MAX_BYTES = 2 * 1024 * 1024 * 1024; // sama dgn cap upload web

function awsUriEncode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || '';
}

// nama bucket = slug nama profile; unik dgn fallback bot-<id>
function bucketForProfile(prof) {
  let slug = slugify(prof.name);
  const others = db.prepare('SELECT id, name FROM profiles WHERE id != ?').all(prof.id);
  if (!slug || others.some((o) => slugify(o.name) === slug)) slug = 'bot-' + prof.id;
  return slug;
}

function profileForBucket(bucket) {
  const b = String(bucket || '').toLowerCase();
  for (const p of db.prepare('SELECT * FROM profiles').all()) {
    if (bucketForProfile(p) === b) return p;
  }
  const m = b.match(/^bot-(\d+)$/);
  if (m) return db.prepare('SELECT * FROM profiles WHERE id=?').get(Number(m[1]));
  return null;
}

// ---------------- presigned URL (SigV4 query auth) ----------------
// URL download sementara tanpa kredensial — aman dibagikan, kadaluarsa otomatis (AWS-style)

function presignUrl(req, cred, prof, key, expires) {
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z/, 'Z');
  const region = 'us-east-1';
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const host = req.headers.host || 'localhost:8001';
  const bucket = bucketForProfile(prof);
  // path yang ditandatangani = path lengkap request, termasuk prefix /s3
  const path = '/s3/' + bucket + '/' + key.split('/').map(awsUriEncode).join('/');
  const qp = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': cred.access_key + '/' + scope,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(qp).sort()
    .map((k) => awsUriEncode(k) + '=' + awsUriEncode(qp[k])).join('&');
  const canonicalRequest = ['GET', path, canonicalQuery, 'host:' + host + '\n', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  let k = hmac('AWS4' + cred.secret_key, dateStamp);
  k = hmac(k, region);
  k = hmac(k, 's3');
  k = hmac(k, 'aws4_request');
  const signature = hmac(k, stringToSign).toString('hex');
  return `http://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// buat presigned URL (butuh login web / API token; token hanya bisa presign bucket bot-nya sendiri)
app.post('/api/s3/presign', (req, res) => {
  const ctx = als.getStore() || {};
  const { bucket, key, expires } = req.body || {};
  const exp = parseInt(expires, 10) || 3600;
  if (!bucket || !key) return res.status(400).json({ error: 'bucket dan key wajib diisi' });
  if (!(exp >= 1 && exp <= 604800)) return res.status(400).json({ error: 'expires harus 1..604800 detik' });
  const prof = profileForBucket(bucket);
  if (!prof) return res.status(404).json({ error: 'Bucket tidak ditemukan' });
  if (ctx.profile && ctx.profile.id !== prof.id) {
    return res.status(403).json({ error: 'Token ini tidak punya akses ke bucket ' + bucket });
  }
  const cred = db.prepare('SELECT * FROM s3_creds WHERE profile_id=?').get(prof.id);
  if (!cred) return res.status(404).json({ error: 'Kredensial S3 utk bot ini belum dibuat (buat di halaman API)' });
  const url = presignUrl(req, cred, prof, key, exp);
  res.json({ ok: true, url, method: 'GET', bucket, key, expiresIn: exp });
});

function xmlEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[c]));
}

function s3Xml(res, status, body) {
  res.status(status).set('Content-Type', 'application/xml').send('<?xml version="1.0" encoding="UTF-8"?>\n' + body);
}

function s3Err(res, status, code, message) {
  s3Xml(res, status, `<Error><Code>${xmlEscape(code)}</Code><Message>${xmlEscape(message)}</Message></Error>`);
}

function mimeType(name) {
  const ext = path.extname(name || '').toLowerCase();
  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
    '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.pdf': 'application/pdf', '.zip': 'application/zip',
    '.json': 'application/json', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  };
  return map[ext] || 'application/octet-stream';
}

function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest(); }

// Verifikasi AWS Signature v4. Dukung 2 mode:
//  - header:  Authorization: AWS4-HMAC-SHA256 Credential=AKID/date/region/s3/aws4_request, ...
//  - presigned URL: X-Amz-Algorithm/Credential/Date/Expires/SignedHeaders/Signature di query string
function verifySigV4(req, secret) {
  const presigned = !!req.query['X-Amz-Algorithm'];
  let dateStamp, region, signedHeadersStr, signature, amzDate;
  if (presigned) {
    const credParts = String(req.query['X-Amz-Credential'] || '').split('/');
    dateStamp = credParts[1] || '';
    region = credParts[2] || '';
    signedHeadersStr = String(req.query['X-Amz-SignedHeaders'] || '');
    signature = String(req.query['X-Amz-Signature'] || '');
    amzDate = String(req.query['X-Amz-Date'] || '');
    const expires = parseInt(req.query['X-Amz-Expires'], 10);
    if (!(expires >= 1 && expires <= 604800)) {
      return { ok: false, code: 'AuthorizationQueryParametersError', msg: 'X-Amz-Expires harus 1..604800 detik' };
    }
    const issued = parseAmzDate(amzDate);
    if (!issued) return { ok: false, code: 'AccessDenied', msg: 'X-Amz-Date tidak valid' };
    if (Date.now() > issued + expires * 1000) return { ok: false, code: 'AccessDenied', msg: 'Request has expired' };
    if (Date.now() < issued - 15 * 60 * 1000) return { ok: false, code: 'AccessDenied', msg: 'Request is not yet valid' };
    if (signedHeadersStr !== 'host') {
      return { ok: false, code: 'AuthorizationQueryParametersError', msg: 'Presigned URL hanya support signed header "host"' };
    }
  } else {
    const auth = req.headers.authorization || '';
    const m = auth.match(/^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request,\s*SignedHeaders=([^,]+),\s*Signature=([0-9a-f]{64})$/i);
    if (!m) return { ok: false, code: 'InvalidArgument', msg: 'Authorization header tidak valid' };
    const amzDateHdr = req.headers['x-amz-date'];
    if (!amzDateHdr) return { ok: false, code: 'InvalidArgument', msg: 'Header x-amz-date wajib ada' };
    amzDate = amzDateHdr;
    dateStamp = m[2];
    region = m[3];
    signedHeadersStr = m[4];
    signature = m[5];
  }

  // canonical URI = path persis seperti dikirim (encoded), query di-sort & re-encode
  const raw = req.originalUrl;
  const qIdx = raw.indexOf('?');
  const canonicalUri = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
  const queryRaw = qIdx >= 0 ? raw.slice(qIdx + 1) : '';
  let pairs = [];
  if (queryRaw) {
    try {
      pairs = queryRaw.split('&').filter(Boolean).map((p) => {
        const i = p.indexOf('=');
        const k = i >= 0 ? p.slice(0, i) : p;
        const v = i >= 0 ? p.slice(i + 1) : '';
        return { k: decodeURIComponent(k), v: decodeURIComponent(v) };
      }).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.v < b.v ? -1 : a.v > b.v ? 1 : 0));
    } catch { return { ok: false, code: 'InvalidArgument', msg: 'Query string tidak valid' }; }
  }
  // presigned: parameter X-Amz-Signature TIDAK ikut dihitung
  if (presigned) pairs = pairs.filter((p) => p.k !== 'X-Amz-Signature');
  const canonicalQuery = pairs.map((p) => awsUriEncode(p.k) + '=' + awsUriEncode(p.v)).join('&');

  const signedHeaders = signedHeadersStr.split(';').map((h) => h.trim().toLowerCase());
  // presigned: payload hash selalu UNSIGNED-PAYLOAD (konvensi S3);
  // header mode: dari x-amz-content-sha256, fallback hash string kosong
  const payloadHash = presigned ? 'UNSIGNED-PAYLOAD' : (req.headers['x-amz-content-sha256'] ||
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  // hitung & bandingkan signature utk satu varian canonical headers
  const check = (canonicalHeaders) => {
    const canonicalRequest = [req.method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders.join(';'), payloadHash].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    let k = hmac('AWS4' + secret, dateStamp);
    k = hmac(k, region);
    k = hmac(k, 's3');
    k = hmac(k, 'aws4_request');
    const expect = hmac(k, stringToSign).toString('hex');
    return expect.length === signature.length &&
      crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(signature));
  };

  // pass 1: canonical headers dari nilai header PERSIS seperti diterima
  let canonicalHeaders = '';
  for (const h of signedHeaders) {
    let val = req.headers[h];
    if (val == null) {
      // accept-encoding sering di-strip/rewrite proxy (Cloudflare/nginx) —
      // SDK menandatangani nilai 'identity', jadi header yang hilang dianggap identity
      if (h === 'accept-encoding') val = 'identity';
      else return { ok: false, code: 'InvalidArgument', msg: 'Signed header tidak ada: ' + h };
    }
    canonicalHeaders += h + ':' + String(val).trim().replace(/\s+/g, ' ') + '\n';
  }
  if (check(canonicalHeaders)) return { ok: true };

  // pass 2 (header auth saja): proxy (Cloudflare/nginx) mengubah nilai accept-encoding
  // (mis. → gzip/br) padahal SDK (Go) menandatangani 'identity'. Normalisasi → verifikasi ulang.
  // Catatan: format canonical header SigV4 = name:value TANPA spasi setelah colon.
  // Aman: signature tetap harus valid — butuh secret key; nilai accept-encoding tidak membawa hak akses.
  if (!presigned && signedHeaders.includes('accept-encoding') && !/^accept-encoding:identity\n/m.test(canonicalHeaders)) {
    const alt = canonicalHeaders.replace(/^accept-encoding:.*$/m, 'accept-encoding:identity');
    if (check(alt)) return { ok: true };
  }

  return { ok: false, code: 'SignatureDoesNotMatch', msg: 'Signature tidak cocok' };
}

// parse X-Amz-Date (YYYYMMDDTHHMMSSZ, UTC) → epoch ms; null kalau format salah
function parseAmzDate(s) {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return isNaN(d.getTime()) ? null : d.getTime();
}

// middleware auth utk semua request /s3
// 2 mode: (1) header Authorization SigV4 (rclone/SDK), (2) presigned URL (X-Amz-* di query string)
app.use('/s3', (req, res, next) => {
  let accessKey = '';
  if (req.query['X-Amz-Algorithm']) {
    accessKey = String(req.query['X-Amz-Credential'] || '').split('/')[0] || '';
  } else {
    const m = (req.headers.authorization || '').match(/Credential=([^/]+)\//);
    accessKey = m ? m[1] : '';
  }
  const cred = accessKey ? db.prepare('SELECT * FROM s3_creds WHERE access_key=?').get(accessKey) : null;
  if (!cred) return s3Err(res, 403, 'InvalidAccessKeyId', 'Access key tidak dikenal');
  const v = verifySigV4(req, cred.secret_key);
  if (!v.ok) return s3Err(res, 403, v.code || 'SignatureDoesNotMatch', v.msg || 'Signature tidak cocok');
  req.s3Cred = cred;
  req.s3Profile = db.prepare('SELECT * FROM profiles WHERE id=?').get(cred.profile_id) || null;
  next();
});

// ---------------- S3 routes ----------------
app.get('/s3', (req, res) => {
  const prof = req.s3Profile;
  if (!prof) return s3Err(res, 403, 'AccessDenied', 'Profile bot tidak ditemukan');
  const bucket = bucketForProfile(prof);
  const created = new Date(prof.created_at || Date.now()).toISOString();
  s3Xml(res, 200, `<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Owner><ID>tas</ID><DisplayName>tas-web</DisplayName></Owner>
  <Buckets><Bucket><Name>${xmlEscape(bucket)}</Name><CreationDate>${created}</CreationDate></Bucket></Buckets>
</ListAllMyBucketsResult>`);
});

function bucketAccess(req, res) {
  const prof = profileForBucket(req.params.bucket);
  if (!prof) { s3Err(res, 404, 'NoSuchBucket', 'Bucket tidak ditemukan'); return null; }
  if (prof.id !== req.s3Cred.profile_id) { s3Err(res, 403, 'AccessDenied', 'Bucket milik bot lain'); return null; }
  return prof;
}

app.get('/s3/:bucket', async (req, res) => {
  const prof = bucketAccess(req, res);
  if (!prof) return;
  const prefix = req.query.prefix || '';
  const delimiter = req.query.delimiter || '';
  const listType = req.query['list-type'] === '2' ? 2 : 1;
  try {
    const { stdout } = await runTas(['list', '--json'], 900000, prof);
    let files = parseTasJson(stdout);
    if (prefix) files = files.filter((f) => (f.filename || '').startsWith(prefix));
    files.sort((a, b) => (a.filename || '').localeCompare(b.filename || ''));
    const contents = [];
    const prefixes = new Set();
    for (const f of files) {
      const key = f.filename || '';
      if (delimiter) {
        const rest = key.slice(prefix.length);
        const idx = rest.indexOf(delimiter);
        if (idx >= 0) { prefixes.add(prefix + rest.slice(0, idx + delimiter.length)); continue; }
      }
      contents.push(`<Contents><Key>${xmlEscape(key)}</Key><LastModified>${new Date(f.created_at || Date.now()).toISOString()}</LastModified><ETag>&quot;${xmlEscape(f.hash || '')}&quot;</ETag><Size>${f.original_size || 0}</Size><StorageClass>STANDARD</StorageClass></Contents>`);
    }
    const common = [...prefixes].sort()
      .map((p) => `<CommonPrefixes><Prefix>${xmlEscape(p)}</Prefix></CommonPrefixes>`).join('');
    const name = xmlEscape(req.params.bucket);
    const body = listType === 2
      ? `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${name}</Name><Prefix>${xmlEscape(prefix)}</Prefix><Delimiter>${xmlEscape(delimiter)}</Delimiter><IsTruncated>false</IsTruncated><MaxKeys>1000</MaxKeys>${common}${contents.join('')}</ListBucketResult>`
      : `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${name}</Name><Prefix>${xmlEscape(prefix)}</Prefix><Marker></Marker><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${contents.join('')}${common}</ListBucketResult>`;
    s3Xml(res, 200, body);
  } catch (e) {
    s3Err(res, 500, 'InternalError', e.message);
  }
});

async function getObject(req, res, headOnly) {
  const prof = bucketAccess(req, res);
  if (!prof) return;
  const key = req.params[0];
  try {
    const rec = await findKey(prof, key);
    if (!rec) return s3Err(res, 404, 'NoSuchKey', 'Key tidak ditemukan');
    const meta = {
      'Content-Type': mimeType(rec.filename),
      'Content-Length': String(rec.original_size || 0),
      'ETag': '"' + rec.hash + '"',
      'Last-Modified': new Date(rec.created_at || Date.now()).toUTCString(),
      'x-amz-meta-tas-hash': rec.hash,
    };
    if (headOnly) return res.set(meta).status(200).end();
    const ext = path.extname(rec.filename || '') || '.bin';
    const cachePath = path.join(CACHE_DIR, `${rec.hash}-${prof.id}${ext}`);
    await ensureCached(key, cachePath, prof);
    res.set(meta);
    fs.createReadStream(cachePath).pipe(res);
  } catch (e) {
    s3Err(res, 500, 'InternalError', e.message);
  }
}

app.get('/s3/:bucket/*', (req, res) => getObject(req, res, false));
app.head('/s3/:bucket/*', (req, res) => getObject(req, res, true));

// hapus file lama dgn nama sama (overwrite semantics S3) — async, tidak blokir respon
function deleteByName(prof, name, callback) {
  const c = spawn('tas', ['delete', name, '--hard'], { env: tasEnv(prof) });
  let out = '';
  c.stdout.on('data', (d) => { out = (out + d).slice(-300); });
  c.stderr.on('data', (d) => { out = (out + d).slice(-300); });
  c.on('error', () => callback && callback(null));
  c.stdin.write('y\n');
  c.stdin.end();
  c.on('close', () => callback && callback(null));
}

// cari object by key (nama file) — kalau duplikat nama, ambil yang TERBARU
async function findKey(prof, key) {
  const { stdout } = await runTas(['list', '--json'], 900000, prof);
  const all = parseTasJson(stdout).filter((f) => f.filename === key);
  if (!all.length) return null;
  return all.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
}

app.put('/s3/:bucket/*', async (req, res) => {
  if (req.query.uploadId || req.query.partNumber) {
    return s3Err(res, 501, 'NotImplemented', 'Multipart upload belum didukung (fase 2)');
  }
  const prof = bucketAccess(req, res);
  if (!prof) return;
  const key = req.params[0];
  const len = parseInt(req.headers['content-length'] || '0', 10);
  if (len > S3_MAX_BYTES) return s3Err(res, 400, 'EntityTooLarge', 'File melebihi 2GB');
  const expectedHash = req.headers['x-amz-content-sha256'] || '';
  const tmpPath = path.join(TMP_DIR, 's3-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex'));
  try {
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(tmpPath);
      const hash = crypto.createHash('sha256');
      req.on('data', (d) => hash.update(d));
      ws.on('finish', () => resolve(hash));
      ws.on('error', reject);
      req.on('error', reject);
      req.pipe(ws);
    }).then((hash) => {
      if (expectedHash && !/^(UNSIGNED-PAYLOAD|STREAMING-)/.test(expectedHash) && hash.digest('hex') !== expectedHash) {
        throw Object.assign(new Error('Payload hash tidak cocok'), { code: 'XAmzContentSHA256Mismatch', status: 400 });
      }
    });
    if (!fs.statSync(tmpPath).size) {
      fs.unlinkSync(tmpPath);
      return s3Err(res, 400, 'InvalidRequest', 'Body kosong');
    }
    // overwrite semantics: hapus object lama (by hash) DULU biar key unik,
    // baru push yang baru — kalau konten sama, tas bikin record baru (dedup
    // tidak aktif karena record lama sudah hilang)
    const existing = await findKey(prof, key);
    if (existing) {
      await new Promise((resolve) => deleteByName(prof, existing.hash, resolve));
      db.prepare('DELETE FROM folder_files WHERE file_hash=?').run(existing.hash);
    }
    const job = createJob(key);
    job.size = fs.statSync(tmpPath).size;
    await new Promise((resolve) => {
      pushJob(job, tmpPath, key, null, () => resolve(), prof);
    });
    if (job.status !== 'done') {
      try { fs.unlinkSync(tmpPath); } catch {}
      // dedup TAS (race/sisa) = konten sama → idempotent PUT (perilaku S3: 200 OK)
      if (/duplicate|already uploaded/i.test(job.message || '')) {
        return res.status(200).set('ETag', '"' + (existing?.hash || '') + '"').end();
      }
      return s3Err(res, 500, 'InternalError', job.message);
    }
    res.status(200).set('ETag', '"' + job.hash + '"').end();
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch {}
    s3Err(res, e.status || 500, e.code || 'InternalError', e.message);
  }
});

app.delete('/s3/:bucket/*', async (req, res) => {
  const prof = bucketAccess(req, res);
  if (!prof) return;
  const key = req.params[0];
  try {
    const rec = await findKey(prof, key);
    if (!rec) return res.status(204).end(); // delete key yang tidak ada = 204 (S3)
    await new Promise((resolve) => deleteByName(prof, rec.hash, resolve));
    db.prepare('DELETE FROM folder_files WHERE file_hash=?').run(rec.hash);
    res.status(204).end();
  } catch (e) {
    s3Err(res, 500, 'InternalError', e.message);
  }
});

// bucket-level ops: bucket = bot yang sudah ada → CreateBucket idempotent sukses
app.put('/s3/:bucket', (req, res) => {
  if (profileForBucket(req.params.bucket)) return res.status(200).end();
  s3Err(res, 404, 'NoSuchBucket', 'Bucket tidak ditemukan');
});
app.delete('/s3/:bucket', (req, res) => {
  if (profileForBucket(req.params.bucket)) return res.status(204).end(); // tidak hapus bot via S3
  s3Err(res, 404, 'NoSuchBucket', 'Bucket tidak ditemukan');
});
app.post('/s3/:bucket', (req, res) => s3Err(res, 501, 'NotImplemented', 'Multipart upload belum didukung (fase 2)'));
app.post('/s3/:bucket/*', (req, res) => s3Err(res, 501, 'NotImplemented', 'Multipart upload belum didukung (fase 2)'));

// ---------------- static ----------------
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) {
      // index.html wajib di-revalidate: biar update UI langsung kebawa (asset di-hash)
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      // asset ber-hash aman di-cache lama
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`tas-web v2 listening on :${PORT} (data: ${TAS_DATA_DIR}, auth: ${authEnabled ? 'ON' : 'OFF'})`);
  startBotIngest(); // upload via Telegram bot (aktif utk profile yg sudah init)
});
