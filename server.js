#!/usr/bin/env node
/**
 * tas-web — web wrapper untuk TAS (Telegram as Storage) CLI.
 * Design system: xbook. Backend: Express + subprocess `tas`.
 */
const express = require('express');
const multer = require('multer');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8001;
const TAS_PASSWORD = process.env.TAS_PASSWORD || '';
const TAS_DATA_DIR = process.env.TAS_DATA_DIR || '/data';
const TMP_DIR = path.join(TAS_DATA_DIR, 'tmp', 'uploads');
const DL_DIR = path.join(TAS_DATA_DIR, 'tmp', 'downloads');

fs.mkdirSync(TMP_DIR, { recursive: true });
fs.mkdirSync(DL_DIR, { recursive: true });

const app = express();
app.use(express.json());

// CORS: buat integrasi API dari app lain (mis. xbook-web) — API-only
app.use('/api', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Range');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

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

// tas status/init mencetak banner ASCII sebelum JSON → strip bagian non-JSON.
// list bisa berupa array (mulai '[') atau object (mulai '{')
function parseTasJson(stdout) {
  const s = stdout.toString();
  const i = s.search(/[[{]/);
  return JSON.parse(i >= 0 ? s.slice(i) : s);
}

// ---------------- jobs (upload/pull async) ----------------
const jobs = new Map();

function createJob(name) {
  const job = {
    id: crypto.randomBytes(4).toString('hex'),
    name,
    status: 'running',
    message: 'Diproses...',
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

function finishJob(job, err, message) {
  job.status = err ? 'error' : 'done';
  job.message = err ? (err.message || String(err)) : (message || 'Selesai');
}

// ---------------- API ----------------
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
    const files = parseTasJson(stdout);
    res.json({ files });
  } catch (e) {
    // kalau belum init, list akan error — kirim empty biar UI tetap jalan
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
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB cap (Telegram bot limit 50MB/chunk)
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Tidak ada file' });
  const filePath = req.file.path;
  const job = createJob(req.file.originalname);

  const child = spawn('tas', ['push', filePath, '--name', req.file.originalname], { env: tasEnv() });
  let outTail = '';
  child.stdout.on('data', (d) => { outTail = (outTail + d).slice(-800); });
  child.stderr.on('data', (d) => { outTail = (outTail + d).slice(-800); });
  child.on('error', (err) => finishJob(job, err));
  child.on('close', (code) => {
    try { fs.unlinkSync(filePath); } catch {}
    if (code === 0) finishJob(job, null, `Upload selesai: ${req.file.originalname}`);
    else finishJob(job, new Error(`tas push gagal (exit ${code}): ${outTail.slice(-300)}`));
  });

  res.json({ jobId: job.id, name: req.file.originalname });
});

app.get('/api/jobs', (req, res) => {
  res.json({ jobs: [...jobs.values()].slice(-20) });
});

app.get('/api/download/:id', async (req, res) => {
  const id = req.params.id;
  const outPath = path.join(DL_DIR, 'dl-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'));
  try {
    const { stdout } = await runTas(['pull', id, outPath]);
    // cari nama asli dari output / list
    let filename = id;
    try {
      const { stdout: lsOut } = await runTas(['list', '--json']);
      const files = parseTasJson(lsOut);
      const rec = files.find((f) => f.hash === id || f.filename === id);
      if (rec) filename = rec.filename;
    } catch {}
    res.download(outPath, filename, () => {
      try { fs.unlinkSync(outPath); } catch {}
    });
  } catch (e) {
    try { fs.unlinkSync(outPath); } catch {}
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/delete/:id', (req, res) => {
  // --hard: hapus dari index DAN hapus chunk dari chat Telegram (sync penuh).
  // tas delete pakai prompt konfirmasi inquirer → jawab "y" via stdin
  const child = spawn('tas', ['delete', req.params.id, '--hard'], { env: tasEnv() });
  let out = '';
  child.stdout.on('data', (d) => { out = (out + d).slice(-600); });
  child.stderr.on('data', (d) => { out = (out + d).slice(-600); });
  child.on('error', (err) => res.status(500).json({ error: err.message }));
  child.stdin.write('y\n');
  child.stdin.end();
  child.on('close', (code) => {
    if (code === 0) res.json({ ok: true });
    else res.status(500).json({ error: out.slice(-300) || `exit ${code}` });
  });
});

// ---------------- streaming (video) ----------------
// Pola: pull file dari Telegram → cache di disk → serve dengan HTTP Range
// (video player bisa seek/jump). Cache per-hash, dipakai ulang antar request.
const CACHE_DIR = path.join(TAS_DATA_DIR, 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const pullPromises = new Map(); // id -> Promise (anti double-pull saat video minta banyak range)

async function findRecord(id) {
  const { stdout } = await runTas(['list', '--json']);
  const files = parseTasJson(stdout);
  return files.find((f) => f.hash === id || f.filename === id) || null;
}

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

// ---------------- static ----------------
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`tas-web listening on :${PORT} (data: ${TAS_DATA_DIR})`);
});
