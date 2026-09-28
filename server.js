#!/usr/bin/env node
/**
 * tas-web v2 — web wrapper untuk TAS (Telegram as Storage) CLI.
 * Fitur: auth (SQLite), upload multi, preview, share link, ZIP, stats, activity.
 */
const express = require('express');
const multer = require('multer');
const { execFile, spawn } = require('child_process');
const { Readable, Transform } = require('stream');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
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
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // cap upload web / URL / S3 (2GB)
// upload besar dipecah di frontend (chunked) supaya tiap request < 100MB (batas
// edge Cloudflare). Ukuran chunk bisa diatur via env UPLOAD_CHUNK_MB (maks 95).
const CHUNK_MB = Math.min(Math.max(parseInt(process.env.UPLOAD_CHUNK_MB, 10) || 80, 8), 95);
const CHUNK_SIZE = CHUNK_MB * 1024 * 1024;
const CHUNK_DIR = path.join(TMP_DIR, 'chunks');
const CHUNK_TTL_MS = 6 * 3600 * 1000; // sesi chunk mangkrak > 6 jam dibersihkan

for (const d of [TMP_DIR, DL_DIR, CACHE_DIR, CHUNK_DIR]) fs.mkdirSync(d, { recursive: true });

// ---------------- secret-at-rest (AES-256-GCM) ----------------
// Kunci master: env TAS_MASTER_KEY, atau file .master.key di data dir (0600, dibuat otomatis).
// Dipakai mengenkripsi password bot & secret S3 supaya tidak plaintext di SQLite.
function loadMasterKey() {
  const env = process.env.TAS_MASTER_KEY;
  if (env) return crypto.createHash('sha256').update(String(env)).digest();
  const kf = path.join(TAS_DATA_DIR, '.master.key');
  try {
    const hex = fs.readFileSync(kf, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, 'hex');
  } catch {}
  const key = crypto.randomBytes(32);
  fs.writeFileSync(kf, key.toString('hex'), { mode: 0o600 });
  console.log('🔑 master key dibuat: ' + kf);
  return key;
}
const MASTER_KEY = loadMasterKey();

function encryptSecret(plain) {
  if (plain == null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return 'v2:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function decryptSecret(stored) {
  if (!stored) return '';
  const s = String(stored);
  if (!s.startsWith('v2:')) return s; // baris legacy (plaintext) — dibiarkan apa adanya
  try {
    const b = Buffer.from(s.slice(3), 'base64');
    const iv = b.subarray(0, 12), tag = b.subarray(12, 28), ct = b.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', MASTER_KEY, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch { return ''; }
}
const profPassword = (p) => decryptSecret(p?.password);

// ---------------- SSRF guard (upload dari URL) ----------------
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true; // link-local / cloud metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    if (p[0] >= 224) return true; // multicast/reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (l.startsWith('fc') || l.startsWith('fd')) return true; // unique local
    if (l.startsWith('fe80')) return true; // link-local
    if (l.startsWith('::ffff:')) return isPrivateIp(l.slice(7));
    return false;
  }
  return true; // tidak dikenali → tolak
}
async function assertPublicUrl(u) {
  let parsed;
  try { parsed = new URL(u); } catch { throw new Error('URL tidak valid'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('hanya http/https');
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('host internal tidak diizinkan');
    return parsed;
  }
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length) throw new Error('host tidak bisa di-resolve');
  for (const a of addrs) if (isPrivateIp(a.address)) throw new Error('host internal tidak diizinkan');
  return parsed;
}
// fetch dgn validasi SSRF di SETIAP hop redirect (redirect: manual)
async function safeFetch(url, maxRedirects = 5) {
  let cur = url;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicUrl(cur);
    const r = await fetch(cur, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const loc = r.headers.get('location');
      if (!loc) return r;
      cur = new URL(loc, cur).toString();
      continue;
    }
    return r;
  }
  throw new Error('terlalu banyak redirect');
}

const app = express();
app.disable('x-powered-by');
// Di balik reverse proxy (Caddy) → pakai X-Forwarded-For/Proto supaya req.ip &
// req.secure benar (rate-limit per-klien, cookie Secure, presign https).
// TRUST_PROXY: jumlah hop (default 1), "true"/"false", atau daftar IP/subnet.
app.set('trust proxy', (() => {
  const tp = process.env.TRUST_PROXY;
  if (tp === undefined || tp === '') return 1;
  if (/^\d+$/.test(tp)) return Number(tp);
  if (tp === 'true') return true;
  if (tp === 'false') return false;
  return tp;
})());
app.use(express.json());
// form share terkunci (POST password) — body kecil, urlencoded
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// perbandingan rahasia constant-time (cegah timing attack pada ===)
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// bersihkan pesan (output CLI bisa memuat path absolut) sebelum dikirim ke client
function stripPaths(s) {
  const raw = String(s == null ? '' : s);
  return raw
    .split(TAS_DATA_DIR).join('<data>')
    .split(__dirname).join('<app>')
    .replace(/\/(?:root|home|data|tmp|var|usr|opt|app|workspace)\/[^\s'"]*/g, '<path>')
    .slice(0, 300);
}
// catat detail di server, kirim versi bersih ke client
function publicErrorMessage(e) {
  const raw = (e && e.message) ? String(e.message) : String(e || '');
  console.error('[tas-web] error:', (e && e.stack) ? e.stack : raw);
  return stripPaths(raw) || 'Terjadi kesalahan internal';
}

// argumen posisi ke CLI `tas` tidak boleh tampak seperti flag (--xx) / kontrol
function tasArgSafe(v) {
  const s = String(v == null ? '' : v);
  return s.length > 0 && !s.startsWith('-') && !/[\x00-\x1f\x7f]/.test(s);
}

// header keamanan dasar (clickjacking, sniffing, referrer, HSTS saat HTTPS)
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Content-Security-Policy', "frame-ancestors 'none'");
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// CORS /api: allowlist via env API_ALLOWED_ORIGINS (default: same-origin / tanpa CORS).
// '*' tetap didukung utk kompatibilitas (reflect Origin) — tidak disarankan.
const API_CORS_ORIGINS = (process.env.API_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin || '';
  const allow = API_CORS_ORIGINS.includes('*') ? (origin || '*')
    : (origin && API_CORS_ORIGINS.includes(origin) ? origin : '');
  if (allow) {
    res.set('Access-Control-Allow-Origin', allow);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.set('Access-Control-Allow-Headers',
      req.headers['access-control-request-headers'] || 'Content-Type, Range, Authorization');
    res.set('Access-Control-Max-Age', '86400');
    if (allow !== '*') res.set('Access-Control-Allow-Credentials', 'true');
  }
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
-- kunci per-file (password): akses web & share wajib "unlock" dulu.
-- PRIMARY KEY (file_hash, profile_id): hash sama di dua bot = kunci terpisah.
CREATE TABLE IF NOT EXISTS file_locks (
  file_hash TEXT NOT NULL,
  profile_id INTEGER NOT NULL,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  hint TEXT DEFAULT '',
  created_at INTEGER,
  updated_at INTEGER,
  PRIMARY KEY (file_hash, profile_id)
);
`);

function hashPassword(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 64).toString('hex');
}
// versi async → tidak memblokir event loop saat login
function hashPasswordAsync(pw, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(pw), salt, 64, (err, key) => (err ? reject(err) : resolve(key.toString('hex'))));
  });
}
// salt dummy: saat user tidak ada tetap di-hash → waktu respons setara (anti-enumerasi)
const DUMMY_SALT = 'f'.repeat(32);

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
  if (API_TOKEN && safeEqual(auth, 'Bearer ' + API_TOKEN)) return { user_id: 0, username: 'api' };
  const token = parseCookies(req).tas_session || auth.replace(/^Bearer /, '');
  if (!token) return null;
  return db.prepare(`SELECT s.user_id, u.username FROM sessions s JOIN users u ON u.id=s.user_id
                     WHERE s.token=? AND s.expires_at > ?`).get(token, Date.now()) || null;
}

app.use((req, res, next) => {
  als.run(resolveAuth(req), () => next());
});

// endpoint yang boleh diakses token API per-bot (integrasi storage).
// Sisanya (manajemen bot/app, /api/tokens, /api/s3, AI settings, cache, dll)
// hanya boleh dari sesi login web / API_TOKEN global — cegah token bot jadi admin.
const TOKEN_ROUTES = [
  /^\/api\/me$/,
  /^\/api\/status$/,
  /^\/api\/stats$/,
  /^\/api\/files(\/|$)/,
  /^\/api\/folders(\/|$)/,
  /^\/api\/stream\//,
  /^\/api\/download\//,
  /^\/api\/jobs$/,
  /^\/api\/upload(\/|$)/,
  /^\/api\/upload-url$/,
  /^\/api\/delete\//,
  /^\/api\/share\//,
  /^\/api\/zip$/,
  /^\/api\/s3\/presign$/,
];
const tokenRouteAllowed = (req) => TOKEN_ROUTES.some((re) => re.test(req.path));

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
  // hanya file statis di luar /api yang publik — kalau tidak, path API yang
  // kebetulan berakhiran .js/.jpg (mis. /api/download/x.js) lolos auth
  const isStatic = req.method === 'GET' && !req.path.startsWith('/api/') &&
    ['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
     '.woff', '.woff2', '.ttf', '.eot', '.map'].includes(ext);
  if (pub || isStatic) return next();
  if (ctx.user) {
    if (ctx.scoped && !tokenRouteAllowed(req)) {
      return res.status(403).json({ error: 'Token bot tidak punya akses ke endpoint ini' });
    }
    return next();
  }
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
        return { app, profile: prof, scoped: true, user: { user_id: 0, username: 'api:' + (row.name || 'bot') } };
      }
    }
  }
  return { profile: null, scoped: false, user: getSessionUser(req) };
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

// data_dir yang tersimpan bisa menunjuk path HOST (mis. /root/tas-web/data)
// kalau server pernah jalan di luar container. Di dalam container path benar
// adalah TAS_DATA_DIR (/data). Remap kalau path lama tidak ada tapi padanannya ada.
function normalizeDataDir(p) {
  const cur = p.data_dir;
  if (cur && fs.existsSync(cur)) return cur;
  const base = path.basename(cur || '');
  if (!base) return cur;
  if (base === path.basename(TAS_DATA_DIR)) return TAS_DATA_DIR;
  const cand = path.join(TAS_DATA_DIR, 'profiles', base);
  if (fs.existsSync(cand)) return cand;
  return cur;
}

function seedDefaultProfile() {
  const n = db.prepare('SELECT COUNT(*) c FROM profiles').get().c;
  if (n > 0) return;
  const hasConfig = fs.existsSync(path.join(TAS_DATA_DIR, 'config.json'));
  db.prepare('INSERT INTO profiles (name, bot_username, data_dir, password, initialized, is_active, created_at) VALUES (?,?,?,?,?,?,?)')
    .run('Default', '', TAS_DATA_DIR, encryptSecret(TAS_PASSWORD), hasConfig ? 1 : 0, 1, Date.now());
  console.log('🌱 seed profile Default (data: ' + TAS_DATA_DIR + (hasConfig ? ', sudah init' : '') + ')');
}
seedDefaultProfile();
// repair + backfill data_dir: path host → path container, lalu tandai initialized
for (const p of db.prepare('SELECT * FROM profiles').all()) {
  const fixed = normalizeDataDir(p);
  if (fixed !== p.data_dir) {
    db.prepare('UPDATE profiles SET data_dir=? WHERE id=?').run(fixed, p.id);
    console.log(`🔧 data_dir profile #${p.id} "${p.name}" diperbaiki: ${p.data_dir} → ${fixed}`);
    p.data_dir = fixed;
  }
  if (!p.initialized && fixed && fs.existsSync(path.join(fixed, 'config.json'))) {
    db.prepare('UPDATE profiles SET initialized=1 WHERE id=?').run(p.id);
  }
}
// migrasi one-time: password profil yang masih plaintext → enkripsi
{
  let n = 0;
  for (const p of db.prepare('SELECT * FROM profiles').all()) {
    if (p.password && !String(p.password).startsWith('v2:')) {
      db.prepare('UPDATE profiles SET password=? WHERE id=?').run(encryptSecret(p.password), p.id);
      n++;
    }
  }
  if (n) console.log(`🔐 ${n} password profil dienkripsi (migrasi)`);
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
  return { ...process.env, TAS_PASSWORD: profPassword(p), TAS_DATA_DIR: p.data_dir };
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

  db.prepare('UPDATE profiles SET password=? WHERE id=?').run(encryptSecret(password), p.id);
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
    startBotIngest(); // polling sempat dijeda di atas → hidupkan lagi profile lain
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
      startBotIngest(); // init gagal → jangan biarkan polling bot ini mati permanen
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

// ---------- cache hasil `tas list` / `tas status` (TTL pendek) ----------
// tiap panggilan tanpa cache = spawn proses CLI baru; ini memangkas spawn
// berulang saat banyak request (list files, preview, download, stats) berturut-turut.
const tasCache = new Map(); // key -> { at, data }
const TAS_TTL = 4000;
function effProfileId(profile) {
  if (profile?.id) return profile.id;
  const ctx = als.getStore() || {};
  return ctx.profile?.id ?? activeProfile?.id ?? 'x';
}
function cacheGet(key, ttl) {
  const e = tasCache.get(key);
  return e && Date.now() - e.at < ttl ? e.data : null;
}
function cacheSet(key, data) {
  tasCache.set(key, { at: Date.now(), data });
  if (tasCache.size > 200) {
    const cut = Date.now() - 60000;
    for (const [k, v] of tasCache) if (v.at < cut) tasCache.delete(k);
  }
}
function invalidateTasCache() { tasCache.clear(); }

async function tasList(profile = null) {
  const key = 'list:' + effProfileId(profile);
  const c = cacheGet(key, TAS_TTL);
  if (c) return c;
  const { stdout } = await runTas(['list', '--json'], 900000, profile);
  const data = parseTasJson(stdout);
  cacheSet(key, data);
  return data;
}
async function tasStatus(profile = null) {
  const key = 'status:' + effProfileId(profile);
  const c = cacheGet(key, TAS_TTL);
  if (c) return c;
  const { stdout } = await runTas(['status', '--json'], 900000, profile);
  const data = parseTasJson(stdout);
  cacheSet(key, data);
  return data;
}

async function findRecord(id, profile = null) {
  const all = await tasList(profile);
  return (Array.isArray(all) ? all : []).find((f) => f.hash === id || f.filename === id) || null;
}

// ---------------- file locks (kunci password per file) ----------------
// Konten file tetap terenkripsi AES-256-GCM seperti biasa; lapisan ini hanya
// gerbang akses: preview/download/stream/ZIP & share link wajib "unlock" dulu.
// Kunci disimpan per (file_hash, profile_id) — hash sama di bot berbeda = kunci
// terpisah. Token unlock stateless (HMAC master key, TTL 30 menit).
const UNLOCK_TTL_MS = 30 * 60 * 1000;

function lockProfileId(profile) {
  if (profile?.id) return profile.id;
  const ctx = als.getStore() || {};
  return ctx.profile?.id ?? activeProfile?.id ?? 0;
}
function getLock(hash, profileId) {
  return db.prepare('SELECT * FROM file_locks WHERE file_hash=? AND profile_id=?').get(hash, profileId) || null;
}
function verifyLockPassword(lock, pw) {
  if (!lock) return false;
  return safeEqual(hashPassword(String(pw == null ? '' : pw), lock.salt), lock.pass_hash);
}
function makeUnlockToken(hash, profileId, version) {
  const exp = Date.now() + UNLOCK_TTL_MS;
  const sig = crypto.createHmac('sha256', MASTER_KEY)
    .update(`u1|${hash}|${profileId}|${version}|${exp}`).digest('hex');
  return { token: `${exp}.${sig}`, expiresAt: exp };
}
function verifyUnlockToken(token, hash, profileId, version) {
  if (!token || typeof token !== 'string') return false;
  const i = token.indexOf('.');
  if (i < 1) return false;
  const exp = Number(token.slice(0, i));
  const sig = token.slice(i + 1);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const want = crypto.createHmac('sha256', MASTER_KEY)
    .update(`u1|${hash}|${profileId}|${version}|${exp}`).digest('hex');
  return safeEqual(sig, want);
}
// token bisa lewat header (fetch/xhr) atau query (tag <video>/<img>, link download)
function reqUnlockToken(req) {
  const h = req.headers['x-unlock-token'];
  if (typeof h === 'string' && h) return h;
  if (req.query && req.query.unlock) return String(req.query.unlock);
  if (req.body && req.body.unlock) return String(req.body.unlock);
  return '';
}
// status kunci utk satu file + apakah request ini sudah membawa token valid
function evaluateLock(req, hash, profileId) {
  const lock = getLock(hash, profileId);
  if (!lock) return { locked: false, unlocked: true, hint: '' };
  const unlocked = verifyUnlockToken(reqUnlockToken(req), hash, profileId, lock.updated_at);
  return { locked: true, unlocked, hint: lock.hint || '', lockedAt: lock.created_at };
}

// rate-limit percobaan password (anti brute force): 10 gagal / menit per IP
const lockAttempts = new Map();
function lockRateOk(req) {
  const e = lockAttempts.get(req.ip || 'x');
  return !e || Date.now() > e.reset || e.n < 10;
}
function bumpLockAttempt(req) {
  const ip = req.ip || 'x';
  const now = Date.now();
  let e = lockAttempts.get(ip);
  if (!e || now > e.reset) e = { n: 0, reset: now + 60000 };
  e.n++;
  lockAttempts.set(ip, e);
  if (lockAttempts.size > 500) for (const [k, v] of lockAttempts) if (now > v.reset) lockAttempts.delete(k);
}
function resetLockAttempt(req) { lockAttempts.delete(req.ip || 'x'); }

function htmlEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
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
      // auto-masuk folder kalau upload dimulai dari dalam folder (per bot)
      if (job.folderId && job.hash) {
        const pid = (profile && profile.id) || (als.getStore() || {}).profile?.id || activeProfile?.id || null;
        const folder = pid ? db.prepare('SELECT id FROM folders WHERE id=? AND profile_id=?').get(job.folderId, pid) : null;
        if (folder) {
          db.prepare('INSERT OR REPLACE INTO folder_files (profile_id, folder_id, file_hash, added_at) VALUES (?,?,?,?)')
            .run(pid, job.folderId, job.hash, Date.now());
        }
      }
      logActivity('upload', name);
      finishJob(job, null, `Upload selesai: ${name}`);
      invalidateTasCache(); // list berubah → buang cache biar file baru langsung terlihat
    } else {
      job.tmpPath = filePath; // simpan utk retry
      finishJob(job, new Error(`tas push gagal (exit ${code}): ${outTail.slice(-300)}`));
    }
    if (onDone) Promise.resolve().then(() => onDone(job)).catch(() => {});
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
    const pw = profPassword(profile);
    if (cfg.encryptedBotToken && pw) {
      const b = Buffer.from(cfg.encryptedBotToken, 'base64');
      const salt = b.subarray(0, 32), iv = b.subarray(32, 44);
      const tag = b.subarray(-16), ct = b.subarray(44, -16);
      const key = crypto.pbkdf2Sync(pw, salt, 600000, 32, 'sha512');
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
    // reserve slot SEBELUM await → dua startBotIngest() konkuren tidak bisa
    // sama-sama lolos cek `has()` dan bikin poller ganda (getUpdates berebut offset)
    const p = { token, botId: null, profileId: prof.id, offset: 0, processed: new Set(), stopped: false };
    botPolls.set(prof.id, p);
    try {
      const me = await tgApi(token, 'getMe', {}, 15000);
      if (botPolls.get(prof.id) !== p) continue; // di-stop saat await
      p.botId = me.id;
      // sinkronisasi offset ke update terbaru → pesan lama tidak diproses ulang
      try {
        const last = await tgApi(token, 'getUpdates', { offset: -1, timeout: 1 });
        if (last.length) p.offset = last[last.length - 1].update_id + 1;
      } catch {}
      console.log(`📥 Bot ingest aktif: @${me.username} → profile "${prof.name}" (file ≤20MB, pesan asli dihapus setelah tersimpan)`);
      pollLoop(prof.id);
    } catch (e) {
      if (botPolls.get(prof.id) === p) botPolls.delete(prof.id); // biar bisa retry
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
const loginAttempts = new Map(); // ip -> { count, resetAt } — throttle brute force
const LOGIN_MAX = 10, LOGIN_WINDOW = 60 * 1000;
function loginBlocked(ip) {
  const rec = loginAttempts.get(ip);
  return !!(rec && Date.now() < rec.resetAt && rec.count >= LOGIN_MAX);
}
function loginFailed(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  const next = (rec && now < rec.resetAt) ? rec : { count: 0, resetAt: now + LOGIN_WINDOW };
  next.count++;
  loginAttempts.set(ip, next);
  if (loginAttempts.size > 5000) for (const [k, v] of loginAttempts) if (now > v.resetAt) loginAttempts.delete(k);
}
// cookie sesi: tambahkan Secure kalau request lewat HTTPS
function sessionCookie(req, value, maxAge) {
  const secure = req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  return `tas_session=${value}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure ? '; Secure' : ''}`;
}
app.post('/api/login', async (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'x';
  if (loginBlocked(ip)) return res.status(429).json({ error: 'Terlalu banyak percobaan login, coba lagi nanti' });
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username || '');
  // tetap hash saat user tidak ada (salt dummy) → timing tidak membocorkan keberadaan user
  const hash = await hashPasswordAsync(password || '', user ? user.salt : DUMMY_SALT);
  if (!user || !safeEqual(hash, user.pass_hash)) {
    loginFailed(ip);
    return res.status(401).json({ error: 'Username atau password salah' });
  }
  loginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?,?,?,?)')
    .run(token, user.id, Date.now() + 30 * 24 * 3600 * 1000, Date.now());
  logActivity('login', username);
  res.set('Set-Cookie', sessionCookie(req, token, 30 * 24 * 3600));
  res.json({ ok: true, username: user.username });
});

app.post('/api/logout', (req, res) => {
  const t = parseCookies(req).tas_session;
  if (t) db.prepare('DELETE FROM sessions WHERE token=?').run(t);
  res.set('Set-Cookie', sessionCookie(req, '', 0));
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
// tabel folders/folder_files WAJIB dibuat sebelum migrasi kolom di bawah —
// fresh install: tabel belum ada, ALTER TABLE akan crash ("no such table")
db.exec(`CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER,
  created_at INTEGER
);
-- folder_files: satu file (hash) hanya di 1 folder PER BOT (profile_id).
-- PRIMARY KEY (profile_id, file_hash) → hash sama di bot lain = keanggotaan sendiri.
CREATE TABLE IF NOT EXISTS folder_files (
  profile_id INTEGER NOT NULL,
  folder_id INTEGER NOT NULL,
  file_hash TEXT NOT NULL,
  added_at INTEGER,
  PRIMARY KEY (profile_id, file_hash)
);
-- file yang disembunyikan (per bot). File asli tetap di Telegram.
CREATE TABLE IF NOT EXISTS hidden_files (
  profile_id INTEGER NOT NULL,
  file_hash TEXT NOT NULL,
  hidden_at INTEGER,
  PRIMARY KEY (profile_id, file_hash)
);`);
// kolom app_id utk api_tokens, folders & profile_id utk shares (migrasi)
const tokCols = db.prepare('PRAGMA table_info(api_tokens)').all();
if (!tokCols.some((c) => c.name === 'app_id')) db.exec('ALTER TABLE api_tokens ADD COLUMN app_id INTEGER');
const folderCols = db.prepare('PRAGMA table_info(folders)').all();
if (!folderCols.some((c) => c.name === 'app_id')) db.exec('ALTER TABLE folders ADD COLUMN app_id INTEGER');
// folder kini milik 1 bot (profile_id) + bisa disembunyikan (hidden)
if (!folderCols.some((c) => c.name === 'profile_id')) db.exec('ALTER TABLE folders ADD COLUMN profile_id INTEGER');
if (!folderCols.some((c) => c.name === 'hidden')) db.exec('ALTER TABLE folders ADD COLUMN hidden INTEGER DEFAULT 0');
const shareCols = db.prepare('PRAGMA table_info(shares)').all();
if (!shareCols.some((c) => c.name === 'profile_id')) db.exec('ALTER TABLE shares ADD COLUMN profile_id INTEGER');

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

// --- migrasi folder per-bot ---
// folder lama (per app) diwariskan ke bot pertama app tsb; kalau app kosong → bot pertama.
{
  let n = 0;
  for (const f of db.prepare('SELECT * FROM folders WHERE profile_id IS NULL').all()) {
    let pid = null;
    if (f.app_id) {
      const row = db.prepare('SELECT profile_id FROM app_profiles WHERE app_id=? ORDER BY profile_id LIMIT 1').get(f.app_id);
      pid = row ? row.profile_id : null;
    }
    if (!pid) { const p = db.prepare('SELECT id FROM profiles ORDER BY id LIMIT 1').get(); pid = p ? p.id : null; }
    if (pid) { db.prepare('UPDATE folders SET profile_id=? WHERE id=?').run(pid, f.id); n++; }
  }
  if (n) console.log(`🔁 ${n} folder lama dipindah ke kepemilikan bot (profile_id)`);
}
// folder_files lama (key global by hash) → dibangun ulang jadi per-bot (profile_id, file_hash)
{
  const ffCols = db.prepare('PRAGMA table_info(folder_files)').all();
  if (!ffCols.some((c) => c.name === 'profile_id')) {
    db.exec(`CREATE TABLE folder_files_new (
      profile_id INTEGER NOT NULL,
      folder_id INTEGER NOT NULL,
      file_hash TEXT NOT NULL,
      added_at INTEGER,
      PRIMARY KEY (profile_id, file_hash)
    )`);
    db.exec(`INSERT OR IGNORE INTO folder_files_new (profile_id, folder_id, file_hash, added_at)
             SELECT f.profile_id, ff.folder_id, ff.file_hash, ff.added_at
             FROM folder_files ff JOIN folders f ON f.id = ff.folder_id
             WHERE f.profile_id IS NOT NULL`);
    db.exec('DROP TABLE folder_files');
    db.exec('ALTER TABLE folder_files_new RENAME TO folder_files');
    console.log('🔁 migrasi folder_files → per-bot (profile_id, file_hash)');
  }
}

function toApp(a) {
  return { id: a.id, name: a.name, description: a.description, createdAt: a.created_at };
}

// resolve app utk operasi per-app: query param > konteks token API > app pertama.
// token bot (scoped) DIPAKSA ke app-nya sendiri — query appId diabaikan (cegah lintas-app).
function appIdFor(req) {
  const ctx = als.getStore() || {};
  if (ctx.scoped && ctx.app?.id) return ctx.app.id;
  if (req?.query?.appId) return parseInt(req.query.appId, 10) || null;
  if (ctx.app?.id) return ctx.app.id;
  const first = db.prepare('SELECT id FROM apps ORDER BY id LIMIT 1').get();
  return first ? first.id : null;
}

// token bot hanya boleh menyentuh folder app-nya sendiri
function folderInScope(f) {
  const ctx = als.getStore() || {};
  if (ctx.scoped && ctx.app?.id) return f && f.app_id === ctx.app.id;
  return true;
}

// bot pemilik folder untuk request ini (token scoped > body/query profileId > bot aktif)
function folderBot(req) {
  const ctx = als.getStore() || {};
  if (ctx.profile) return ctx.profile;
  const id = parseInt(req?.query?.profileId ?? req?.body?.profileId, 10);
  if (id) { const p = db.prepare('SELECT * FROM profiles WHERE id=?').get(id); if (p) return p; }
  return activeProfile || null;
}
// folder harus milik bot ini (isolation per-bot) + lolos scope token
function folderInBotScope(f, req) {
  if (!f) return false;
  const bot = folderBot(req);
  if (!bot) return false;
  if (f.profile_id && f.profile_id !== bot.id) return false;
  return folderInScope(f);
}
// peta folder tersembunyi efektif (milik sendiri ATAU leluhurnya disembunyikan)
function folderHiddenMap(profileId) {
  const rows = db.prepare('SELECT id, parent_id, hidden FROM folders WHERE profile_id=?').all(profileId);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const eff = new Map();
  const calc = (id) => {
    if (eff.has(id)) return eff.get(id);
    const r = byId.get(id);
    if (!r) return false;
    eff.set(id, true); // guard siklus
    const v = !!r.hidden || (r.parent_id ? calc(r.parent_id) : false);
    eff.set(id, v);
    return v;
  };
  for (const r of rows) calc(r.id);
  return eff;
}
// file-tersembunyi efektif utk bot: eksplisit disembunyikan ATAU berada di folder tersembunyi
function hiddenFileSet(profileId) {
  if (!profileId) return new Set();
  const set = new Set(db.prepare('SELECT file_hash FROM hidden_files WHERE profile_id=?').all(profileId).map((r) => r.file_hash));
  const hf = folderHiddenMap(profileId);
  if (hf.size) {
    for (const row of db.prepare('SELECT folder_id, file_hash FROM folder_files WHERE profile_id=?').all(profileId)) {
      if (hf.get(row.folder_id)) set.add(row.file_hash);
    }
  }
  return set;
}

// ---------------- folders (virtual, model Google Drive) ----------------
// File asli tetap di Telegram (flat). Folder = layer organisasi di SQLite.
// (CREATE TABLE folders/folder_files sudah dijalankan lebih awal, sebelum migrasi app_id.)

// index utk query panas (activity feed, cek sesi, folder per app, lookup konfirmasi ingest)
db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity(ts);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_folders_app ON folders(app_id);
CREATE INDEX IF NOT EXISTS idx_folders_profile ON folders(profile_id);
CREATE INDEX IF NOT EXISTS idx_folder_files_folder ON folder_files(folder_id);
CREATE INDEX IF NOT EXISTS idx_folder_files_profile ON folder_files(profile_id);
CREATE INDEX IF NOT EXISTS idx_hidden_files_profile ON hidden_files(profile_id);
CREATE INDEX IF NOT EXISTS idx_ingest_hash ON ingest_confirmations(file_hash, profile_id);`);

app.get('/api/folders', (req, res) => {
  const bot = folderBot(req);
  const pid = bot ? bot.id : null;
  const folders = pid ? db.prepare('SELECT * FROM folders WHERE profile_id=? ORDER BY name').all(pid) : [];
  const countMap = {};
  const fileFolders = {};
  if (pid) {
    for (const c of db.prepare('SELECT folder_id, COUNT(*) c FROM folder_files WHERE profile_id=? GROUP BY folder_id').all(pid)) countMap[c.folder_id] = c.c;
    for (const row of db.prepare('SELECT folder_id, file_hash FROM folder_files WHERE profile_id=?').all(pid)) fileFolders[row.file_hash] = row.folder_id;
  }
  const hidden = pid ? folderHiddenMap(pid) : new Map();
  res.json({
    botId: pid,
    folders: folders.map((f) => ({
      id: f.id, name: f.name, parentId: f.parent_id, createdAt: f.created_at,
      profileId: f.profile_id, fileCount: countMap[f.id] || 0,
      hidden: !!f.hidden, hiddenEffective: !!hidden.get(f.id),
    })),
    fileFolders,
  });
});

app.post('/api/folders', (req, res) => {
  const bot = folderBot(req);
  if (!bot) return res.status(400).json({ error: 'Pilih bot dulu untuk membuat folder' });
  const name = (req.body?.name || '').trim().slice(0, 100);
  if (!name) return res.status(400).json({ error: 'Nama folder wajib diisi' });
  const parentId = req.body?.parentId ? parseInt(req.body.parentId, 10) : null;
  if (parentId) {
    const p = db.prepare('SELECT * FROM folders WHERE id=?').get(parentId);
    if (!p || p.profile_id !== bot.id) return res.status(400).json({ error: 'Folder induk tidak ditemukan' });
  }
  const ctx = als.getStore() || {};
  const appId = ctx.app?.id ?? appIdFor(req);
  const info = db.prepare('INSERT INTO folders (name, parent_id, profile_id, app_id, hidden, created_at) VALUES (?,?,?,?,0,?)')
    .run(name, parentId, bot.id, appId, Date.now());
  logActivity('folder', 'create "' + name + '" @ ' + (bot.name || bot.id));
  res.json({ id: info.lastInsertRowid, name, parentId, profileId: bot.id, createdAt: Date.now(), fileCount: 0, hidden: false });
});

// sembunyikan / tampilkan folder (per bot). Isi folder ikut tersembunyi (lihat hiddenFileSet).
app.post('/api/folders/:id/hide', (req, res) => {
  const f = db.prepare('SELECT * FROM folders WHERE id=?').get(req.params.id);
  if (!f || !folderInBotScope(f, req)) return res.status(404).json({ error: 'Folder tidak ditemukan' });
  const hidden = req.body?.hidden !== false; // default: sembunyikan
  db.prepare('UPDATE folders SET hidden=? WHERE id=?').run(hidden ? 1 : 0, f.id);
  logActivity(hidden ? 'hide-folder' : 'unhide-folder', f.name);
  res.json({ ok: true, hidden });
});

app.put('/api/folders/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM folders WHERE id=?').get(req.params.id);
  if (!f || !folderInBotScope(f, req)) return res.status(404).json({ error: 'Folder tidak ditemukan' });
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
      if (!db.prepare('SELECT * FROM folders WHERE id=?').get(parentId)) {
        return res.status(400).json({ error: 'Folder induk tidak ditemukan' });
      }
      const pp = db.prepare('SELECT profile_id FROM folders WHERE id=?').get(parentId);
      if (pp && pp.profile_id !== f.profile_id) return res.status(400).json({ error: 'Folder induk milik bot lain' });
    }
  }
  db.prepare('UPDATE folders SET name=?, parent_id=? WHERE id=?').run(name, parentId, f.id);
  logActivity('folder', 'rename "' + name + '"');
  res.json({ id: f.id, name, parentId, createdAt: f.created_at, fileCount: db.prepare('SELECT COUNT(*) c FROM folder_files WHERE folder_id=?').get(f.id).c });
});

// alias gaya POST (konsisten dgn endpoint lain di codebase)
app.post('/api/folders/:id/rename', (req, res) => {
  const f = db.prepare('SELECT * FROM folders WHERE id=?').get(req.params.id);
  if (!f || !folderInBotScope(f, req)) return res.status(404).json({ error: 'Folder tidak ditemukan' });
  const name = (req.body?.name || '').trim().slice(0, 100);
  if (!name) return res.status(400).json({ error: 'Nama folder wajib diisi' });
  db.prepare('UPDATE folders SET name=? WHERE id=?').run(name, f.id);
  logActivity('folder', 'rename "' + name + '"');
  res.json({ id: f.id, name, parentId: f.parent_id, createdAt: f.created_at });
});

app.delete('/api/folders/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM folders WHERE id=?').get(req.params.id);
  if (!f || !folderInBotScope(f, req)) return res.status(404).json({ error: 'Folder tidak ditemukan' });
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

// pindahkan file (by hash) ke folder; folderId null/kosong = kembali ke root.
// Keanggotaan disimpan per bot: (profile_id, file_hash).
app.post('/api/files/folder', (req, res) => {
  const bot = folderBot(req);
  if (!bot) return res.status(400).json({ error: 'Pilih bot dulu' });
  const hashes = (req.body?.hashes || []).slice(0, 100).map(String).filter(Boolean);
  if (!hashes.length) return res.status(400).json({ error: 'Pilih minimal 1 file' });
  const folderId = req.body?.folderId ? parseInt(req.body.folderId, 10) : null;
  if (folderId) {
    const folder = db.prepare('SELECT * FROM folders WHERE id=?').get(folderId);
    if (!folder || folder.profile_id !== bot.id || !folderInScope(folder)) return res.status(400).json({ error: 'Folder tidak ditemukan' });
  }
  db.transaction(() => {
    for (const h of hashes) {
      db.prepare('DELETE FROM folder_files WHERE profile_id=? AND file_hash=?').run(bot.id, h);
      if (folderId) {
        db.prepare('INSERT OR REPLACE INTO folder_files (profile_id, folder_id, file_hash, added_at) VALUES (?,?,?,?)')
          .run(bot.id, folderId, h, Date.now());
      }
    }
  })();
  logActivity('folder', 'move ' + hashes.length + ' file @ ' + (bot.name || bot.id));
  res.json({ ok: true, count: hashes.length, folderId });
});

// sembunyikan / tampilkan file (per bot). body: { hashes:[...], hidden:true|false }
app.post('/api/files/hide', (req, res) => {
  const bot = folderBot(req);
  if (!bot) return res.status(400).json({ error: 'Pilih bot dulu' });
  const hashes = (req.body?.hashes || []).slice(0, 500).map(String).filter(Boolean);
  if (!hashes.length) return res.status(400).json({ error: 'Pilih minimal 1 file' });
  const hide = req.body?.hidden !== false;
  db.transaction(() => {
    for (const h of hashes) {
      if (hide) db.prepare('INSERT OR REPLACE INTO hidden_files (profile_id, file_hash, hidden_at) VALUES (?,?,?)').run(bot.id, h, Date.now());
      else db.prepare('DELETE FROM hidden_files WHERE profile_id=? AND file_hash=?').run(bot.id, h);
    }
  })();
  logActivity(hide ? 'hide-file' : 'unhide-file', hashes.length + ' file @ ' + (bot.name || bot.id));
  res.json({ ok: true, hidden: hide, count: hashes.length });
});

// token dikembalikan TERMASKER — nilai penuh hanya via /reveal (sesi login) atau saat dibuat
function maskToken(t) {
  const s = String(t || '');
  return s.length <= 16 ? s : s.slice(0, 10) + '…' + s.slice(-4);
}
app.get('/api/tokens', (req, res) => {
  const appId = parseInt(req.query.appId, 10) || null;
  const base = `SELECT t.id, t.token, t.name, t.profile_id, p.name AS profile_name, t.active, t.created_at, t.last_used_at, t.app_id,
    a.name AS app_name FROM api_tokens t LEFT JOIN profiles p ON p.id=t.profile_id LEFT JOIN apps a ON a.id=t.app_id`;
  const rows = appId
    ? db.prepare(base + ' WHERE t.app_id=? ORDER BY t.id DESC').all(appId)
    : db.prepare(base + ' ORDER BY t.id DESC').all();
  res.json({ tokens: rows.map((r) => ({ ...r, token: maskToken(r.token) })) });
});

// reveal nilai penuh satu token (admin/web saja — token bot diblokir di requireAuth)
app.get('/api/tokens/:id/reveal', (req, res) => {
  const row = db.prepare('SELECT token FROM api_tokens WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Token tidak ditemukan' });
  res.json({ token: row.token });
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
    res.json(await tasStatus());
  } catch (e) {
    res.status(502).json({ initialized: false, error: publicErrorMessage(e) });
  }
});

app.get('/api/files', async (req, res) => {
  try {
    // ?all=1 → gabungan file dari semua bot di app (tiap file dilabeli bot asal)
    if (req.query.all === '1') {
      // appIdFor: token bot (scoped) dipaksa ke app-nya sendiri (abaikan query)
      const appId = appIdFor(req);
      const profs = appId
        ? db.prepare('SELECT p.* FROM profiles p JOIN app_profiles ap ON ap.profile_id=p.id WHERE ap.app_id=?').all(appId)
        : db.prepare('SELECT * FROM profiles WHERE initialized=1').all();
      const results = await Promise.all(profs.map(async (prof) => {
        try {
          const list = await tasList(prof);
          const hidden = hiddenFileSet(prof.id);
          return (Array.isArray(list) ? list : []).map((f) => ({ ...f, profileId: prof.id, profileName: prof.name, locked: !!getLock(f.hash, prof.id), hidden: hidden.has(f.hash) }));
        } catch { return []; }
      }));
      return res.json({ files: results.flat() });
    }
    // single-bot: bot = konteks request (token API) atau bot aktif global
    const prof = profileFromQuery(req);
    const pid = lockProfileId(prof);
    const hidden = hiddenFileSet(pid);
    const list = await tasList(prof);
    res.json({ files: (Array.isArray(list) ? list : []).map((f) => ({ ...f, locked: !!getLock(f.hash, pid), hidden: hidden.has(f.hash) })) });
  } catch (e) {
    res.status(502).json({ files: [], error: publicErrorMessage(e) });
  }
});

// resolve bot target dari query (dipakai operasi file di view "semua bot").
// token API per-bot DIPAKSA ke bot-nya sendiri — override profileId diabaikan.
function profileFromQuery(req) {
  const ctx = als.getStore() || {};
  if (ctx.profile) return ctx.profile;
  const pid = parseInt(req.query.profileId, 10);
  return pid ? db.prepare('SELECT * FROM profiles WHERE id=?').get(pid) : null;
}

// ---------------- API kunci file ----------------
// Set/ubah/hapus kunci hanya dari sesi web penuh — token bot scoped TIDAK boleh
// mengelola kunci (unlock tetap boleh, supaya integrasi bisa buka dgn password).
app.get('/api/files/:id/lock', async (req, res) => {
  try {
    const prof = profileFromQuery(req);
    const rec = await findRecord(req.params.id, prof);
    if (!rec) return res.status(404).json({ error: 'File tidak ditemukan' });
    const pid = lockProfileId(prof);
    const st = evaluateLock(req, rec.hash, pid);
    res.json({ locked: st.locked, unlocked: st.unlocked, hint: st.hint || '', lockedAt: st.lockedAt || null });
  } catch (e) { res.status(500).json({ error: publicErrorMessage(e) }); }
});

app.post('/api/files/:id/lock', async (req, res) => {
  const ctx = als.getStore() || {};
  if (ctx.scoped) return res.status(403).json({ error: 'Token bot tidak bisa mengunci file' });
  if (!lockRateOk(req)) return res.status(429).json({ error: 'Terlalu banyak percobaan — coba lagi sebentar lagi' });
  const password = String(req.body?.password || '');
  const hint = String(req.body?.hint || '').trim().slice(0, 120);
  if (password.length < 4) return res.status(400).json({ error: 'Password minimal 4 karakter' });
  try {
    const prof = profileFromQuery(req);
    const rec = await findRecord(req.params.id, prof);
    if (!rec) return res.status(404).json({ error: 'File tidak ditemukan' });
    const pid = lockProfileId(prof);
    const existing = getLock(rec.hash, pid);
    if (existing && !verifyLockPassword(existing, req.body?.currentPassword)) {
      bumpLockAttempt(req);
      return res.status(403).json({ error: 'Password lama salah' });
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const pass_hash = hashPassword(password, salt);
    const now = Date.now();
    db.prepare(`INSERT INTO file_locks (file_hash, profile_id, pass_hash, salt, hint, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?)
                ON CONFLICT(file_hash, profile_id) DO UPDATE SET
                  pass_hash=excluded.pass_hash, salt=excluded.salt, hint=excluded.hint, updated_at=excluded.updated_at`)
      .run(rec.hash, pid, pass_hash, salt, hint, now, now);
    resetLockAttempt(req);
    logActivity('lock', rec.filename || rec.hash);
    res.json({ ok: true, locked: true });
  } catch (e) { res.status(500).json({ error: publicErrorMessage(e) }); }
});

app.post('/api/files/:id/lock/remove', async (req, res) => {
  const ctx = als.getStore() || {};
  if (ctx.scoped) return res.status(403).json({ error: 'Token bot tidak bisa mengubah kunci file' });
  if (!lockRateOk(req)) return res.status(429).json({ error: 'Terlalu banyak percobaan — coba lagi sebentar lagi' });
  try {
    const prof = profileFromQuery(req);
    const rec = await findRecord(req.params.id, prof);
    if (!rec) return res.status(404).json({ error: 'File tidak ditemukan' });
    const pid = lockProfileId(prof);
    const existing = getLock(rec.hash, pid);
    if (existing && !verifyLockPassword(existing, req.body?.password)) {
      bumpLockAttempt(req);
      return res.status(403).json({ error: 'Password salah' });
    }
    db.prepare('DELETE FROM file_locks WHERE file_hash=? AND profile_id=?').run(rec.hash, pid);
    resetLockAttempt(req);
    logActivity('unlock-remove', rec.filename || rec.hash);
    res.json({ ok: true, locked: false });
  } catch (e) { res.status(500).json({ error: publicErrorMessage(e) }); }
});

// buka file (dapat token sementara). Boleh dari sesi web maupun token bot scoped.
app.post('/api/files/:id/unlock', async (req, res) => {
  if (!lockRateOk(req)) return res.status(429).json({ error: 'Terlalu banyak percobaan — coba lagi sebentar lagi' });
  try {
    const prof = profileFromQuery(req);
    const rec = await findRecord(req.params.id, prof);
    if (!rec) return res.status(404).json({ error: 'File tidak ditemukan' });
    const pid = lockProfileId(prof);
    const lock = getLock(rec.hash, pid);
    if (!lock) return res.json({ ok: true, locked: false, token: null });
    if (!verifyLockPassword(lock, req.body?.password)) {
      bumpLockAttempt(req);
      return res.status(403).json({ error: 'Password salah' });
    }
    resetLockAttempt(req);
    const { token, expiresAt } = makeUnlockToken(rec.hash, pid, lock.updated_at);
    logActivity('unlock', rec.filename || rec.hash);
    res.json({ ok: true, locked: true, token, expiresAt });
  } catch (e) { res.status(500).json({ error: publicErrorMessage(e) }); }
});

// upload: simpan dengan nama asli (tas push pakai basename sebagai filename)
const upload = multer({
  storage: multer.diskStorage({
    destination: TMP_DIR,
    filename: (req, file, cb) => {
      const safe = path.basename(file.originalname).replace(/[^\w.\-() ]+/g, '_');
      // random suffix → nama temp tidak tabrakan kalau dua upload di ms yang sama
      cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '-' + safe);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES }, // 2GB cap
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

// ---------------- chunked upload (file besar dipecah di frontend) ----------------
// Tiap request < 100MB → lolos batas body Cloudflare. Server menyatukan chunk
// berurutan jadi 1 file temp, baru di-push ke Telegram (pushJob).
function concatFiles(parts, dest) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    out.on('error', reject);
    let i = 0;
    const next = () => {
      if (i >= parts.length) return out.end(() => resolve(dest));
      const rs = fs.createReadStream(parts[i++]);
      rs.on('error', reject);
      rs.on('end', next);
      rs.pipe(out, { end: false });
    };
    next();
  });
}

// bersihkan sesi chunk mangkrak (dipanggil saat start & tiap upload chunk baru)
function sweepChunks() {
  let n = 0;
  try {
    for (const name of fs.readdirSync(CHUNK_DIR)) {
      try {
        const st = fs.statSync(path.join(CHUNK_DIR, name));
        if (Date.now() - st.mtimeMs > CHUNK_TTL_MS) { fs.rmSync(path.join(CHUNK_DIR, name), { recursive: true, force: true }); n++; }
      } catch {}
    }
  } catch {}
  return n;
}

app.get('/api/upload/limits', (req, res) => {
  res.json({ chunked: true, chunkSize: CHUNK_SIZE, maxFileSize: MAX_UPLOAD_BYTES });
});

const chunkUpload = multer({
  storage: multer.diskStorage({
    // field uploadId/index HARUS dikirim sebelum file di FormData (urutan multer)
    destination: (req, file, cb) => {
      const id = String(req.body?.uploadId || '');
      if (!/^[a-f0-9]{16,64}$/.test(id)) return cb(Object.assign(new Error('uploadId tidak valid'), { status: 400 }));
      try { const dir = path.join(CHUNK_DIR, id); fs.mkdirSync(dir, { recursive: true }); cb(null, dir); }
      catch (e) { cb(e); }
    },
    filename: (req, file, cb) => {
      const idx = parseInt(req.body?.index, 10);
      if (!Number.isInteger(idx) || idx < 0 || idx > 9999) return cb(Object.assign(new Error('index tidak valid'), { status: 400 }));
      cb(null, String(idx) + '.part');
    },
  }),
  // beri sedikit kelonggaran: chunk tepat seukuran CHUNK_SIZE harus lolos
  // (batas total tetap MAX_UPLOAD_BYTES saat complete)
  limits: { fileSize: CHUNK_SIZE + 4 * 1024 * 1024, files: 1, fields: 20 },
});

app.post('/api/upload/chunk', (req, res) => {
  chunkUpload.single('chunk')(req, res, (err) => {
    if (err) {
      const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 400);
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Chunk melebihi batas' : (err.message || 'Chunk gagal');
      return res.status(status).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'Chunk kosong' });
    const total = parseInt(req.body?.total, 10);
    if (!Number.isInteger(total) || total < 1 || total > 1000) return res.status(400).json({ error: 'total tidak valid' });
    if (Math.random() < 0.2) sweepChunks(); // pruning oportunistik
    const dir = path.join(CHUNK_DIR, req.body.uploadId);
    let received = 0;
    try { received = fs.readdirSync(dir).filter((f) => /^\d+\.part$/.test(f)).length; } catch {}
    res.json({ ok: true, received, total });
  });
});

app.post('/api/upload/chunk/complete', async (req, res) => {
  const id = String(req.body?.uploadId || '');
  const total = parseInt(req.body?.total, 10);
  const size = parseInt(req.body?.size, 10) || 0;
  const folderId = req.body?.folderId ? parseInt(req.body.folderId, 10) : null;
  const name = String(req.body?.name || 'upload.bin').slice(0, 200);
  if (!/^[a-f0-9]{16,64}$/.test(id)) return res.status(400).json({ error: 'uploadId tidak valid' });
  if (!Number.isInteger(total) || total < 1 || total > 1000) return res.status(400).json({ error: 'total tidak valid' });
  if (folderId && !db.prepare('SELECT id FROM folders WHERE id=?').get(folderId)) return res.status(400).json({ error: 'Folder tidak ditemukan' });
  const dir = path.join(CHUNK_DIR, id);
  if (!fs.existsSync(dir)) return res.status(409).json({ error: 'Sesi upload tidak ditemukan' });
  const parts = [];
  const missing = [];
  let sum = 0;
  for (let i = 0; i < total; i++) {
    const p = path.join(dir, i + '.part');
    if (!fs.existsSync(p)) { missing.push(i); continue; }
    sum += fs.statSync(p).size;
    parts.push(p);
  }
  if (missing.length) return res.status(409).json({ error: 'Chunk belum lengkap', missing });
  if (sum > MAX_UPLOAD_BYTES) { fs.rmSync(dir, { recursive: true, force: true }); return res.status(413).json({ error: 'File melebihi batas 2GB' }); }
  if (size && sum !== size) return res.status(400).json({ error: 'Ukuran file tidak cocok (' + sum + ' vs ' + size + ')' });
  try {
    const safe = path.basename(name).replace(/[^\w.\-() ]+/g, '_');
    const assembled = path.join(TMP_DIR, 'chunked-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex') + '-' + safe);
    await concatFiles(parts, assembled);
    fs.rmSync(dir, { recursive: true, force: true });
    const job = createJob(name);
    pushJob(job, assembled, name, folderId);
    res.json({ jobs: [{ jobId: job.id, name }] });
  } catch (e) {
    res.status(500).json({ error: publicErrorMessage(e) });
  }
});

app.post('/api/upload/chunk/abort', (req, res) => {
  const id = String(req.body?.uploadId || '');
  if (/^[a-f0-9]{16,64}$/.test(id)) {
    try { fs.rmSync(path.join(CHUNK_DIR, id), { recursive: true, force: true }); } catch {}
  }
  res.json({ ok: true });
});

sweepChunks();

// upload dari URL (server yang download) — STREAM ke disk, jangan buffer di RAM
app.post('/api/upload-url', async (req, res) => {
  const url = (req.body?.url || '').trim();
  const folderId = req.body?.folderId ? parseInt(req.body.folderId, 10) : null;
  if (folderId && !db.prepare('SELECT id FROM folders WHERE id=?').get(folderId)) {
    return res.status(400).json({ error: 'Folder tidak ditemukan' });
  }
  // tolak URL ke alamat internal / metadata (SSRF); redirect divalidasi per-hop di safeFetch
  try { await assertPublicUrl(url); }
  catch (e) { return res.status(400).json({ error: 'URL ditolak: ' + e.message }); }
  const job = createJob(url.slice(0, 60));
  if (folderId) job.folderId = folderId;
  const filePath = path.join(TMP_DIR, 'url-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'));
  (async () => {
    let ws = null;
    try {
      const r = await safeFetch(url);
      if (!r.ok) throw new Error('Gagal download: HTTP ' + r.status);
      if (!r.body) throw new Error('Respons tidak berisi body');
      const declared = parseInt(r.headers.get('content-length') || '0', 10);
      if (declared > MAX_UPLOAD_BYTES) throw new Error('File melebihi batas 2GB');
      ws = fs.createWriteStream(filePath);
      // cap saat streaming (Content-Length bisa kosong/ngawur) → putus kalau lewat
      let received = 0;
      const cap = new Transform({
        transform(chunk, _enc, cb) {
          received += chunk.length;
          if (received > MAX_UPLOAD_BYTES) {
            return cb(Object.assign(new Error('File melebihi batas 2GB'), { code: 'EntityTooLarge' }));
          }
          cb(null, chunk);
        },
      });
      await new Promise((resolve, reject) => {
        Readable.fromWeb(r.body).pipe(cap).pipe(ws)
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
  // buang job lama (> 1 jam) biar Map tidak tumbuh tanpa batas; jangan bocorkan
  // path absolut server (tmpPath) ke client
  const cutoff = Date.now() - 3600 * 1000;
  for (const [id, j] of jobs) if (j.createdAt < cutoff && j.status !== 'running') jobs.delete(id);
  const out = [...jobs.values()].slice(-30).map(({ tmpPath, ...j }) => ({ ...j, message: stripPaths(j.message) }));
  res.json({ jobs: out });
});

app.get('/api/download/:id', async (req, res) => {
  const id = req.params.id;
  const prof = profileFromQuery(req);
  const outPath = path.join(DL_DIR, 'dl-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'));
  try {
    const rec = await findRecord(id, prof);
    if (!rec) return res.status(404).json({ error: 'File tidak ditemukan' });
    const lk = evaluateLock(req, rec.hash, lockProfileId(prof));
    if (lk.locked && !lk.unlocked) {
      try { fs.unlinkSync(outPath); } catch {}
      return res.status(423).json({ error: 'File terkunci — masukkan password dulu', locked: true, hint: lk.hint || '' });
    }
    // pull pakai rec.hash (bukan param mentah) — cegah argumen tampak-flag ke CLI
    await runTas(['pull', rec.hash, outPath], 900000, prof);
    logActivity('download', rec.filename);
    res.download(outPath, rec.filename, () => { try { fs.unlinkSync(outPath); } catch {} });
  } catch (e) {
    try { fs.unlinkSync(outPath); } catch {}
    res.status(500).json({ error: publicErrorMessage(e) });
  }
});

app.post('/api/delete/:id', (req, res) => {
  // --hard: hapus dari index DAN dari chat Telegram (sync penuh)
  if (!tasArgSafe(req.params.id)) return res.status(400).json({ error: 'ID tidak valid' });
  const prof = profileFromQuery(req);
  const pid = prof ? prof.id : (activeProfile ? activeProfile.id : null);
  const child = spawn('tas', ['delete', req.params.id, '--hard'], { env: tasEnv(prof) });
  let out = '';
  child.stdout.on('data', (d) => { out = (out + d).slice(-600); });
  child.stderr.on('data', (d) => { out = (out + d).slice(-600); });
  child.on('error', (err) => { if (!res.headersSent) res.status(500).json({ error: err.message }); });
  child.stdin.write('y\n');
  child.stdin.end();
  child.on('close', (code) => {
    if (res.headersSent) return; // error sudah dikirim (cegah ERR_HTTP_HEADERS_SENT)
    if (code === 0) {
      logActivity('delete', req.params.id.slice(0, 16));
      invalidateTasCache();
      // bersihkan mapping folder & status hidden (per bot; id = hash)
      if (pid) {
        db.prepare('DELETE FROM folder_files WHERE profile_id=? AND file_hash=?').run(pid, req.params.id);
        db.prepare('DELETE FROM hidden_files WHERE profile_id=? AND file_hash=?').run(pid, req.params.id);
      } else {
        db.prepare('DELETE FROM folder_files WHERE file_hash=?').run(req.params.id);
        db.prepare('DELETE FROM hidden_files WHERE file_hash=?').run(req.params.id);
      }
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
      res.status(500).json({ error: publicErrorMessage(out || ('exit ' + code)) });
    }
  });
});

// ---------------- streaming ----------------
const pullPromises = new Map();

function ensureCached(id, cachePath, profile = null) {
  if (fs.existsSync(cachePath)) return Promise.resolve(cachePath);
  if (pullPromises.has(cachePath)) return pullPromises.get(cachePath);
  // tulis ke .part dulu lalu rename → crash di tengah pull tidak menyisakan
  // cache parsial yang tetap disajikan selamanya
  const partPath = cachePath + '.part';
  const p = runTas(['pull', id, partPath], 1200000, profile)
    .then(() => { fs.renameSync(partPath, cachePath); return cachePath; })
    .catch((e) => { try { fs.unlinkSync(partPath); } catch {} throw e; })
    .finally(() => pullPromises.delete(cachePath));
  pullPromises.set(cachePath, p);
  return p;
}

app.get('/api/stream/:id', async (req, res) => {
  const id = req.params.id;
  const ctx = als.getStore() || {};
  const authed = !!ctx.user;
  // /api/stream publik = capability URL by HASH saja. Pencarian by NAMA file dan
  // ?profileId hanya utk request terautentikasi (cegah enumerasi file lintas-bot).
  if (!authed && !/^[a-f0-9]{64}$/i.test(id)) {
    return res.status(404).json({ error: 'File tidak ditemukan' });
  }
  const prof = authed ? profileFromQuery(req) : activeProfile;
  try {
    const rec = await findRecord(id, prof);
    if (!rec) return res.status(404).json({ error: 'File tidak ditemukan' });
    const lk = evaluateLock(req, rec.hash, lockProfileId(prof));
    if (lk.locked && !lk.unlocked) {
      return res.status(423).json({ error: 'File terkunci — masukkan password dulu', locked: true, hint: lk.hint || '' });
    }
    const ext = path.extname(rec.filename || '') || '.bin';
    // cache per profile — hash bisa sama di dua bot berbeda
    const cachePath = path.join(CACHE_DIR, `${rec.hash}-${prof ? prof.id : 'x'}${ext}`);
    await ensureCached(rec.hash, cachePath, prof);
    const disp = `inline; filename*=UTF-8''${encodeURIComponent(rec.filename)}`;
    res.sendFile(cachePath, { headers: { 'Content-Disposition': disp } }, (err) => {
      if (err && !res.headersSent) res.status(500).json({ error: publicErrorMessage(err) });
    });
  } catch (e) {
    res.status(500).json({ error: publicErrorMessage(e) });
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
  try {
    const id = req.params.id;
    const prof = profileFromQuery(req) || activeProfile; // share dari bot yang benar (bukan selalu bot aktif)
    const expireH = Math.min(Math.max(parseInt(req.body?.expire) || 24, 1), 720);
    const maxDl = Math.min(Math.max(parseInt(req.body?.maxDownloads) || 1, 1), 100);
    const rec = await findRecord(id, prof);
    if (!rec) return res.status(404).json({ error: 'File tidak ditemukan' });
    const token = crypto.randomBytes(8).toString('hex');
    db.prepare('INSERT INTO shares (token, file_hash, filename, size, expires_at, max_downloads, profile_id, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(token, rec.hash, rec.filename, rec.original_size, Date.now() + expireH * 3600 * 1000, maxDl, prof ? prof.id : null, Date.now());
    logActivity('share', `${rec.filename} (${expireH}h, max ${maxDl}x)`);
    res.json({ token, url: `/s/${token}`, filename: rec.filename, expiresAt: Date.now() + expireH * 3600 * 1000, maxDownloads: maxDl });
  } catch (e) {
    res.status(500).json({ error: publicErrorMessage(e) });
  }
});

// kirim file share (dipakai GET /s/:token setelah kunci—kalau ada—terbuka)
async function serveShareDownload(s, res) {
  try {
    const ext = path.extname(s.filename) || '.bin';
    const prof = s.profile_id ? db.prepare('SELECT * FROM profiles WHERE id=?').get(s.profile_id) : null;
    // cache ber-discriminator profile — dua bot dgn hash sama tidak saling tumpuk
    const cachePath = path.join(CACHE_DIR, `${s.file_hash}-${s.profile_id || 'x'}${ext}`);
    await ensureCached(s.file_hash, cachePath, prof);
    // increment atomik: cegah request paralel melewati max_downloads (TOCTOU)
    const upd = db.prepare('UPDATE shares SET downloads = downloads + 1 WHERE token=? AND downloads < max_downloads').run(s.token);
    if (!upd.changes) return res.status(410).send('Batas download tercapai');
    res.download(cachePath, s.filename, (err) => {
      // gagal kirim → kembalikan kuota (jangan hangus sebelum file benar-benar terkirim)
      if (err) db.prepare('UPDATE shares SET downloads = downloads - 1 WHERE token=? AND downloads > 0').run(s.token);
    });
  } catch (e) {
    res.status(500).send('Gagal memuat file');
  }
}

// halaman minta password utk share file terkunci (tanpa login)
function renderShareUnlockPage(s, errMsg) {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>File terkunci — ${htmlEscape(s.filename)}</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#F7F7F5;color:#191919;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:20px}
@media(prefers-color-scheme:dark){body{background:#191919;color:#EDEDEC}}
.card{width:100%;max-width:360px;background:#fff;border:1px solid #E9E9E7;border-radius:14px;padding:22px;box-shadow:0 10px 40px rgba(15,15,15,.10)}
@media(prefers-color-scheme:dark){.card{background:#262626;border-color:#3A3A3A;box-shadow:none}}
.icon{font-size:34px;line-height:1}
h1{font-size:16px;margin:10px 0 4px}
.name{font-size:12px;color:#787774;word-break:break-all}
p{font-size:12.5px;color:#787774}
input{width:100%;box-sizing:border-box;margin:14px 0 10px;padding:10px 12px;border-radius:9px;
border:1px solid #E9E9E7;background:#F7F7F5;color:inherit;font-size:14px;outline:none}
input:focus{border-color:#2383E2}
@media(prefers-color-scheme:dark){input{background:#1F1F1F;border-color:#3A3A3A}}
button{width:100%;padding:10px;border:none;border-radius:9px;background:#2383E2;color:#fff;font-weight:600;font-size:13.5px;cursor:pointer}
button:hover{filter:brightness(1.1)}
.err{margin-top:10px;font-size:12.5px;color:#E03E3E}
.hint{font-size:12px;color:#787774;margin-top:2px}
</style></head><body><div class="card">
<div class="icon">🔒</div>
<h1>File terkunci</h1>
<div class="name">${htmlEscape(s.filename)}</div>
<p>File ini dilindungi password. Masukkan password untuk mengunduh.</p>
<form method="POST" action="/s/${htmlEscape(s.token)}">
<input type="password" name="password" placeholder="Password" autofocus required autocomplete="off">
<button type="submit">Buka &amp; Download</button>
</form>
${errMsg ? `<div class="err">${htmlEscape(errMsg)}</div>` : ''}
</div></body></html>`;
}

app.get('/s/:token', async (req, res) => {
  const s = db.prepare('SELECT * FROM shares WHERE token=?').get(req.params.token);
  if (!s) return res.status(404).send('Link tidak valid');
  if (Date.now() > s.expires_at) {
    db.prepare('DELETE FROM shares WHERE token=?').run(s.token);
    return res.status(410).send('Link kadaluarsa');
  }
  if (s.downloads >= s.max_downloads) return res.status(410).send('Batas download tercapai');
  // file terkunci → wajib password sebelum file disajikan
  const pid = s.profile_id || 0;
  const lock = pid ? getLock(s.file_hash, pid) : null;
  if (lock && !verifyUnlockToken(req.query.u, s.file_hash, pid, lock.updated_at)) {
    return res.status(200).type('html').send(renderShareUnlockPage(s, ''));
  }
  return serveShareDownload(s, res);
});

// verifikasi password share terkunci → redirect dgn token unlock di query
app.post('/s/:token', (req, res) => {
  const s = db.prepare('SELECT * FROM shares WHERE token=?').get(req.params.token);
  if (!s) return res.status(404).send('Link tidak valid');
  if (Date.now() > s.expires_at) return res.status(410).send('Link kadaluarsa');
  const pid = s.profile_id || 0;
  const lock = pid ? getLock(s.file_hash, pid) : null;
  if (!lock) return res.redirect(303, `/s/${s.token}`);
  if (!lockRateOk(req)) {
    return res.status(429).type('html').send(renderShareUnlockPage(s, 'Terlalu banyak percobaan — coba lagi sebentar lagi.'));
  }
  if (!verifyLockPassword(lock, req.body?.password)) {
    bumpLockAttempt(req);
    return res.status(200).type('html').send(renderShareUnlockPage(s, 'Password salah.'));
  }
  resetLockAttempt(req);
  const { token } = makeUnlockToken(s.file_hash, pid, lock.updated_at);
  res.redirect(303, `/s/${s.token}?u=${encodeURIComponent(token)}`);
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
  const prof = profileFromQuery(req); // ZIP dari view "semua bot" dinonaktifkan di UI
  try {
    const all = await tasList(prof);
    const byHash = new Map(all.map((f) => [f.hash, f]));
    const byName = new Map(all.map((f) => [f.filename, f]));
    const picked = ids.map((id) => byHash.get(id) || byName.get(id)).filter(Boolean);
    if (!picked.length) return res.status(404).json({ error: 'File tidak ditemukan' });

    // file terkunci: butuh token unlock per file (dikirim frontend di body.unlocks)
    const pid = lockProfileId(prof);
    const unlocks = req.body?.unlocks || {};
    const lockedNames = [];
    for (const rec of picked) {
      const lock = getLock(rec.hash, pid);
      if (lock && !verifyUnlockToken(unlocks[rec.hash], rec.hash, pid, lock.updated_at)) {
        lockedNames.push(rec.filename);
      }
    }
    if (lockedNames.length) {
      return res.status(423).json({ error: 'Ada file terkunci — buka kuncinya dulu', locked: true, files: lockedNames });
    }

    const zipDir = path.join(DL_DIR, 'zip-' + crypto.randomBytes(4).toString('hex'));
    fs.mkdirSync(zipDir, { recursive: true });
    for (const rec of picked) {
      const out = path.join(zipDir, rec.filename.replace(/[^\w.\-() ]+/g, '_'));
      await runTas(['pull', rec.hash, out], 1800000, prof);
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
    res.status(500).json({ error: publicErrorMessage(e) });
  }
});

// ---------------- stats & activity ----------------
app.get('/api/stats', async (req, res) => {
  try {
    const st = await tasStatus();
    const files = await tasList();
    const byType = {};
    for (const f of (Array.isArray(files) ? files : [])) {
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
    res.status(500).json({ error: publicErrorMessage(e) });
  }
});

app.get('/api/activity', (req, res) => {
  res.json({ activity: db.prepare('SELECT * FROM activity ORDER BY ts DESC LIMIT 50').all() });
});

// ---------------- S3 gateway credentials ----------------
// Access key + secret utk klien S3 (rclone/s3cmd/aws cli). 1 bot = 1 bucket.
db.exec(`CREATE TABLE IF NOT EXISTS key_aliases (
  profile_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  hash TEXT NOT NULL,
  original_size INTEGER NOT NULL DEFAULT 0,
  stored_size INTEGER NOT NULL DEFAULT 0,
  chunks INTEGER NOT NULL DEFAULT 1,
  compressed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (profile_id, key)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS s3_creds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER UNIQUE,
  access_key TEXT UNIQUE,
  secret_key TEXT,
  created_at INTEGER
)`);
// migrasi one-time: secret S3 plaintext → enkripsi
{
  let n = 0;
  for (const c of db.prepare('SELECT * FROM s3_creds').all()) {
    if (c.secret_key && !String(c.secret_key).startsWith('v2:')) {
      db.prepare('UPDATE s3_creds SET secret_key=? WHERE id=?').run(encryptSecret(c.secret_key), c.id);
      n++;
    }
  }
  if (n) console.log(`🔐 ${n} secret S3 dienkripsi (migrasi)`);
}

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
    .run(profileId, accessKey, encryptSecret(secretKey), Date.now());
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
const S3_MAX_BYTES = MAX_UPLOAD_BYTES; // sama dgn cap upload web

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

// origin publik yang dipakai menandatangani & membentuk presigned URL.
// PUBLIC_BASE_URL (mis. https://app-storage.sebudev.space) menang; kalau tidak,
// turunkan dari X-Forwarded-Proto/Host (di balik Caddy) — jangan asal Host mentah.
function publicOrigin(req) {
  const env = (process.env.PUBLIC_BASE_URL || '').trim();
  if (env) return env.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:8001').split(',')[0].trim();
  return `${proto}://${host}`;
}

function presignUrl(req, cred, prof, key, expires) {
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z/, 'Z');
  const region = 'us-east-1';
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const origin = publicOrigin(req);
  // host yang ditandatangani HARUS sama dengan host pada URL (canonical host header)
  const host = (() => { try { return new URL(origin).host; } catch { return req.headers.host || 'localhost:8001'; } })();
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
  let k = hmac('AWS4' + decryptSecret(cred.secret_key), dateStamp);
  k = hmac(k, region);
  k = hmac(k, 's3');
  k = hmac(k, 'aws4_request');
  const signature = hmac(k, stringToSign).toString('hex');
  return `${origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
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

// CORS gateway S3 — dipakai lintas-app (dashboard lain memuat file via presigned URL).
// HARUS sebelum verifikasi SigV4: request OPTIONS (preflight) tidak membawa signature.
// Set S3_ALLOWED_ORIGINS (koma) untuk allowlist; default '*' (reflect Origin).
const S3_CORS_ORIGINS = (process.env.S3_ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
app.use('/s3', (req, res, next) => {
  const origin = req.headers.origin || '';
  const allow = S3_CORS_ORIGINS.includes('*')
    ? (origin || '*')
    : (S3_CORS_ORIGINS.includes(origin) ? origin : (S3_CORS_ORIGINS[0] || '*'));
  res.set('Access-Control-Allow-Origin', allow);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Methods', 'GET,HEAD,PUT,DELETE,OPTIONS');
  // reflect header yg diminta browser (x-amz-*, authorization, range, dst)
  res.set('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type, Range, Authorization, x-amz-*');
  res.set('Access-Control-Expose-Headers', 'ETag, Content-Length, Content-Type, Last-Modified, Content-Range, Accept-Ranges, x-amz-meta-tas-hash');
  res.set('Access-Control-Max-Age', '86400');
  // presigned URL = akses ber-signature → JANGAN di-cache CDN (Cloudflare).
  // Kalau ter-cache, respons bisa disajikan tanpa validasi signature & tanpa
  // header CORS yang benar (dan bocor lintas-origin).
  res.set('Cache-Control', 'no-store');
  res.set('CDN-Cache-Control', 'no-store');
  res.set('Cloudflare-CDN-Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

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
  const v = verifySigV4(req, decryptSecret(cred.secret_key));
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
  const rawMax = parseInt(req.query['max-keys'], 10);
  const maxKeys = Number.isFinite(rawMax) ? Math.min(1000, Math.max(1, rawMax)) : 1000;
  // v2: continuation-token (base64url); v1: marker (key mentah)
  const reqToken = listType === 2 ? String(req.query['continuation-token'] || '') : '';
  let marker = listType === 2
    ? (reqToken ? Buffer.from(reqToken, 'base64url').toString('utf8') : '')
    : String(req.query.marker || '');
  try {
    const list = await tasList(prof);
    let files = Array.isArray(list) ? list : [];
    // Merge aliased keys, preferring a real index row when both exist.
    const aliasRows = db.prepare('SELECT * FROM key_aliases WHERE profile_id=?').all(effProfileId(prof))
      .map((a) => ({ filename: a.key, hash: a.hash, original_size: a.original_size, stored_size: a.stored_size, chunks: a.chunks, compressed: a.compressed, created_at: a.created_at }));
    if (aliasRows.length) {
      const seen = new Set(files.map((f) => f.filename));
      for (const a of aliasRows) if (!seen.has(a.filename)) files.push(a);
    }
    if (prefix) files = files.filter((f) => (f.filename || '').startsWith(prefix));
    files.sort((a, b) => (a.filename || '').localeCompare(b.filename || ''));
    // gabung Contents + CommonPrefixes lalu urut by key — S3 menghitung KEDUANYA
    // dalam MaxKeys, jadi pagination harus atas daftar gabungan.
    const items = [];
    const seenPrefix = new Set();
    for (const f of files) {
      const key = f.filename || '';
      if (delimiter) {
        const rest = key.slice(prefix.length);
        const idx = rest.indexOf(delimiter);
        if (idx >= 0) {
          const p = prefix + rest.slice(0, idx + delimiter.length);
          if (!seenPrefix.has(p)) { seenPrefix.add(p); items.push({ key: p, prefix: true }); }
          continue;
        }
      }
      items.push({ key, prefix: false, f });
    }
    items.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    let start = 0;
    if (marker) {
      const i = items.findIndex((it) => it.key > marker);
      start = i < 0 ? items.length : i;
    }
    const page = items.slice(start, start + maxKeys);
    const truncated = start + maxKeys < items.length;
    const lastKey = page.length ? page[page.length - 1].key : marker;
    const contents = page.filter((it) => !it.prefix).map((it) => {
      const f = it.f;
      return `<Contents><Key>${xmlEscape(it.key)}</Key><LastModified>${new Date(f.created_at || Date.now()).toISOString()}</LastModified><ETag>&quot;${xmlEscape(f.hash || '')}&quot;</ETag><Size>${f.original_size || 0}</Size><StorageClass>STANDARD</StorageClass></Contents>`;
    }).join('');
    const common = page.filter((it) => it.prefix)
      .map((it) => `<CommonPrefixes><Prefix>${xmlEscape(it.key)}</Prefix></CommonPrefixes>`).join('');
    const name = xmlEscape(req.params.bucket);
    const body = listType === 2
      ? `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${name}</Name><Prefix>${xmlEscape(prefix)}</Prefix><Delimiter>${xmlEscape(delimiter)}</Delimiter><MaxKeys>${maxKeys}</MaxKeys><KeyCount>${page.length}</KeyCount><IsTruncated>${truncated}</IsTruncated>${reqToken ? `<ContinuationToken>${xmlEscape(reqToken)}</ContinuationToken>` : ''}${truncated ? `<NextContinuationToken>${xmlEscape(Buffer.from(lastKey).toString('base64url'))}</NextContinuationToken>` : ''}${contents}${common}</ListBucketResult>`
      : `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${name}</Name><Prefix>${xmlEscape(prefix)}</Prefix><Marker>${xmlEscape(String(req.query.marker || ''))}</Marker><MaxKeys>${maxKeys}</MaxKeys><IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextMarker>${xmlEscape(lastKey)}</NextMarker>` : ''}${contents}${common}</ListBucketResult>`;
    s3Xml(res, 200, body);
  } catch (e) {
    s3Err(res, 500, 'InternalError', publicErrorMessage(e));
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
    await ensureCached(rec.hash, cachePath, prof);
    res.set(meta);
    fs.createReadStream(cachePath).pipe(res);
  } catch (e) {
    s3Err(res, 500, 'InternalError', publicErrorMessage(e));
  }
}

app.get('/s3/:bucket/*', (req, res) => getObject(req, res, false));
app.head('/s3/:bucket/*', (req, res) => getObject(req, res, true));

// hapus file lama dgn nama sama (overwrite semantics S3) — async, tidak blokir respon
function deleteByName(prof, name, callback) {
  if (!tasArgSafe(name)) { callback && callback(new Error('ID tidak valid')); return; }
  const c = spawn('tas', ['delete', name, '--hard'], { env: tasEnv(prof) });
  let out = '';
  let done = false;
  const finish = () => { if (done) return; done = true; invalidateTasCache(); callback && callback(null); };
  c.stdout.on('data', (d) => { out = (out + d).slice(-300); });
  c.stderr.on('data', (d) => { out = (out + d).slice(-300); });
  c.on('error', finish);
  c.stdin.write('y\n');
  c.stdin.end();
  c.on('close', finish);
}

// cari object by key (nama file) — kalau duplikat nama, ambil yang TERBARU
async function findKey(prof, key) {
  const list = await tasList(prof);
  const all = (Array.isArray(list) ? list : []).filter((f) => f.filename === key);
  if (all.length) return all.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
  // TAS dedups by content hash (files.hash is UNIQUE), so a byte-identical
  // push under a new key produces no index row. Such keys are recorded in
  // key_aliases so they still resolve — S3 semantics say the same bytes
  // written to another key is another object.
  const a = db.prepare('SELECT * FROM key_aliases WHERE profile_id=? AND key=?').get(effProfileId(prof), key);
  if (a) {
    return { filename: key, hash: a.hash, original_size: a.original_size, stored_size: a.stored_size, chunks: a.chunks, compressed: a.compressed, created_at: a.created_at, __alias: true };
  }
  return null;
}

// find an indexed file by its content hash (the dedup source of truth)
async function findFileByHash(prof, hash) {
  if (!hash) return null;
  const list = await tasList(prof);
  const all = (Array.isArray(list) ? list : []).filter((f) => f.hash === hash);
  return all.length ? all.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0] : null;
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
  let bodyHash = '';
  const tmpPath = path.join(TMP_DIR, 's3-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex'));
  try {
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(tmpPath);
      const hash = crypto.createHash('sha256');
      let received = 0, aborted = false;
      req.on('data', (d) => {
        received += d.length;
        // cap juga saat Transfer-Encoding: chunked (Content-Length bisa kosong/0)
        if (received > S3_MAX_BYTES) {
          aborted = true;
          ws.destroy(); req.destroy();
          reject(Object.assign(new Error('File melebihi 2GB'), { code: 'EntityTooLarge', status: 400 }));
          return;
        }
        hash.update(d);
      });
      ws.on('finish', () => resolve(hash));
      ws.on('error', (e) => { if (!aborted) reject(e); });
      req.on('error', (e) => { if (!aborted) reject(e); });
      req.pipe(ws);
    }).then((hash) => {
      bodyHash = hash.digest('hex');
      if (expectedHash && !/^(UNSIGNED-PAYLOAD|STREAMING-)/.test(expectedHash) && bodyHash !== expectedHash) {
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
    if (existing && existing.__alias) {
      // The bytes belong to other keys too; drop only this key's alias.
      db.prepare('DELETE FROM key_aliases WHERE profile_id=? AND key=?').run(effProfileId(prof), key);
      invalidateTasCache();
    } else if (existing) {
      await new Promise((resolve) => deleteByName(prof, existing.hash, resolve));
      db.prepare('DELETE FROM folder_files WHERE profile_id=? AND file_hash=?').run(effProfileId(prof), existing.hash);
      db.prepare('DELETE FROM hidden_files WHERE profile_id=? AND file_hash=?').run(effProfileId(prof), existing.hash);
    }
    const job = createJob(key);
    job.size = fs.statSync(tmpPath).size;
    await new Promise((resolve) => {
      pushJob(job, tmpPath, key, null, () => resolve(), prof);
    });
    if (job.status !== 'done') {
      try { fs.unlinkSync(tmpPath); } catch {}
      // dedup TAS (race/sisa) = konten sama → idempotent PUT (perilaku S3: 200 OK)
      if (!/duplicate|already uploaded/i.test(job.message || '')) {
        return s3Err(res, 500, 'InternalError', job.message);
      }
    }
    // A real index row for this key makes any earlier alias redundant.
    if (job.hash) {
      db.prepare('DELETE FROM key_aliases WHERE profile_id=? AND key=?').run(effProfileId(prof), key);
    }
    let resolved = await findKey(prof, key);
    if (!resolved) {
      const src = await findFileByHash(prof, bodyHash || job.hash);
      if (src) {
        db.prepare(`INSERT INTO key_aliases (profile_id, key, hash, original_size, stored_size, chunks, compressed)
                    VALUES (?,?,?,?,?,?,?)
                    ON CONFLICT(profile_id, key) DO UPDATE SET hash=excluded.hash, original_size=excluded.original_size, stored_size=excluded.stored_size, chunks=excluded.chunks, compressed=excluded.compressed`)
          .run(effProfileId(prof), key, src.hash, src.original_size || job.size || 0, src.stored_size || 0, src.chunks || 1, src.compressed || 0);
        invalidateTasCache();
        resolved = src;
      }
    }
    // Never answer 200 for a key that cannot be read back: that is how rows
    // with no object were born.
    if (!resolved) return s3Err(res, 500, 'InternalError', 'Push selesai tetapi key tidak terindeks');
    res.status(200).set('ETag', '"' + resolved.hash + '"').end();
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch {}
    s3Err(res, e.status || 500, e.code || 'InternalError', publicErrorMessage(e));
  }
});

app.delete('/s3/:bucket/*', async (req, res) => {
  const prof = bucketAccess(req, res);
  if (!prof) return;
  const key = req.params[0];
  try {
    const rec = await findKey(prof, key);
    if (!rec) return res.status(204).end(); // delete key yang tidak ada = 204 (S3)
    if (rec.__alias) {
      // Shared content: remove this key's alias, keep the bytes for other keys.
      db.prepare('DELETE FROM key_aliases WHERE profile_id=? AND key=?').run(effProfileId(prof), key);
      invalidateTasCache();
      return res.status(204).end();
    }
    await new Promise((resolve) => deleteByName(prof, rec.hash, resolve));
    db.prepare('DELETE FROM folder_files WHERE profile_id=? AND file_hash=?').run(effProfileId(prof), rec.hash);
    db.prepare('DELETE FROM hidden_files WHERE profile_id=? AND file_hash=?').run(effProfileId(prof), rec.hash);
    res.status(204).end();
  } catch (e) {
    s3Err(res, 500, 'InternalError', publicErrorMessage(e));
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
