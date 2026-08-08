const $ = (s) => document.querySelector(s);

let files = [];
let query = '';
let current = null;
let toastTimer = null;

function toast(msg, cls = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + cls;
  clearTimeout(toastTimer);
  if (!cls.includes('running')) toastTimer = setTimeout(() => t.classList.add('hidden'), 5000);
}

function fmtBytes(b) {
  if (b == null) return '–';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

function fmtDate(s) {
  if (!s) return '–';
  const d = new Date(s);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function iconFor(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(ext)) return '🎬';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return '🖼️';
  if (['mp3', 'wav', 'flac', 'ogg'].includes(ext)) return '🎵';
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) return '🗜️';
  if (['pdf'].includes(ext)) return '📄';
  if (['doc', 'docx', 'txt', 'md'].includes(ext)) return '📝';
  return '📦';
}

// ---------------- status & setup ----------------
async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const st = await res.json();
    const setupBox = $('#setup');
    if (!st.initialized) {
      setupBox.classList.remove('hidden');
      setupBox.innerHTML = `⚠️ TAS belum di-initialize.<br><br>
        Jalankan di server: <code>docker exec -it tas-web tas init</code><br>
        (butuh bot token dari @BotFather + kirim pesan ke bot)`;
      return;
    }
    setupBox.classList.add('hidden');
    $('#stat-files').textContent = st.fileCount || 0;
    $('#stat-size').textContent = fmtBytes(st.totalSize);
    $('#stat-save').textContent = (st.savingsPercent || 0) + '%';
  } catch (e) { /* ignore */ }
}

// ---------------- list ----------------
async function load() {
  $('#loading').classList.remove('hidden');
  try {
    const res = await fetch('/api/files');
    const data = await res.json();
    files = data.files || [];
    render();
    loadStatus();
  } catch (e) {
    $('#loading').textContent = 'Gagal memuat data.';
  }
  $('#loading').classList.add('hidden');
}

function render() {
  const grid = $('#grid');
  grid.innerHTML = '';
  const q = query.toLowerCase();
  const filtered = files.filter((f) => !q || (f.filename || '').toLowerCase().includes(q));
  $('#empty').classList.toggle('hidden', filtered.length > 0);

  filtered.forEach((f) => {
    const card = document.createElement('div');
    card.className = 'fcard';
    const tags = (f.tags || []).length
      ? `<div class="ftags">${f.tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}</div>`
      : '';
    card.innerHTML =
      `<div class="ficon">${iconFor(f.filename || '')}</div>` +
      `<div class="fname">${escapeHtml(f.filename || f.hash)}</div>` +
      `<div class="fmeta"><span>${fmtBytes(f.original_size)}</span><span>${fmtDate(f.created_at)}</span></div>` +
      tags;
    card.addEventListener('click', () => open(f));
    grid.appendChild(card);
  });
}

function open(f) {
  current = f;
  $('#modal-content').innerHTML = `<div style="font-size:38px;text-align:center;padding:18px">${iconFor(f.filename || '')}</div>`;
  const tags = (f.tags || []).length ? `<br>🏷 ${f.tags.map((t) => '#' + escapeHtml(t)).join(' ')}` : '';
  $('#modal-meta').innerHTML =
    `<span class="handle">${escapeHtml(f.filename || f.hash)}</span>` +
    `<br>${fmtBytes(f.original_size)} · ${fmtDate(f.created_at)} · ${f.chunks || 1} chunk(s) · hash ${escapeHtml((f.hash || '').slice(0, 12))}…` + tags;
  $('#modal-actions').innerHTML =
    `<button class="btn" id="act-download">⬇ Download</button>` +
    `<button class="btn danger" id="act-delete">🗑 Hapus</button>`;
  $('#modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  $('#act-download').addEventListener('click', () => {
    toast('Menyiapkan download...', 'running');
    window.location.href = `/api/download/${encodeURIComponent(f.hash || f.filename)}`;
  });
  $('#act-delete').addEventListener('click', async () => {
    if (!confirm(`Hapus "${f.filename}" dari Telegram storage?`)) return;
    try {
      const res = await fetch(`/api/delete/${encodeURIComponent(f.hash || f.filename)}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'gagal');
      toast('File dihapus', 'ok');
      closeModal();
      load();
    } catch (e) {
      toast('Gagal hapus: ' + e.message, 'err');
    }
  });
}

function closeModal() {
  $('#modal').classList.add('hidden');
  document.body.style.overflow = '';
  current = null;
}

// ---------------- upload ----------------
function startUpload(file) {
  const fd = new FormData();
  fd.append('file', file);
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) toast(`Upload ${Math.round((e.loaded / e.total) * 100)}%...`, 'running');
  };
  xhr.onload = () => {
    try {
      const data = JSON.parse(xhr.responseText);
      toast(`Upload dimulai: ${data.name || file.name}`, 'running');
    } catch { toast('Upload dimulai', 'running'); }
    pollJobs();
  };
  xhr.onerror = () => toast('Upload gagal (network)', 'err');
  xhr.send(fd);
}

// ---------------- jobs ----------------
async function pollJobs() {
  try {
    const res = await fetch('/api/jobs');
    const { jobs } = await res.json();
    const wrap = $('#jobs');
    wrap.innerHTML = '';
    const active = jobs.filter((j) => j.status === 'running');
    jobs.slice().reverse().forEach((j) => {
      const line = document.createElement('div');
      line.className = 'job-line ' + j.status;
      line.textContent = `${j.status === 'running' ? '⏳' : j.status === 'done' ? '✅' : '❌'} ${j.name} — ${j.message}`;
      wrap.appendChild(line);
    });
    if (active.length) {
      setTimeout(pollJobs, 3000);
    } else if (jobs.length) {
      const last = jobs[jobs.length - 1];
      if (last && last.status === 'done') { toast(last.message, 'ok'); load(); }
      if (last && last.status === 'error') { toast(last.message, 'err'); }
    }
  } catch (e) { /* ignore */ }
}

// ---------------- events ----------------
$('#refresh-btn').addEventListener('click', load);
$('#search').addEventListener('input', (e) => { query = e.target.value.trim(); render(); });

$('#upload-btn').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', (e) => {
  if (e.target.files.length) startUpload(e.target.files[0]);
  e.target.value = '';
});

const dz = $('#dropzone');
dz.addEventListener('click', () => $('#file-input').click());
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', (e) => {
  e.preventDefault();
  dz.classList.remove('over');
  if (e.dataTransfer.files.length) startUpload(e.dataTransfer.files[0]);
});

$('#modal-close').addEventListener('click', closeModal);
$('#modal-x').addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => {
  if (!$('#modal').classList.contains('hidden') && e.key === 'Escape') closeModal();
});

load();
