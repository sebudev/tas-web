const $ = (s) => document.querySelector(s);

const PAGE_SIZE = 24;
const state = {
  files: [],
  filtered: [],
  page: 0,
  search: '',
  sort: 'new',
  selectMode: false,
  selected: new Set(),
  current: -1, // index di filtered (untuk preview nav)
  jobs: [],
};
let toastTimer = null;

// ---------------- helpers ----------------
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

function fmtDateTime(ts) {
  return new Date(ts).toLocaleDateString('id-ID') + ' ' + new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
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

function isVideo(f) { return ['mp4', 'mkv', 'webm', 'mov', 'avi'].includes((f.filename || '').split('.').pop().toLowerCase()); }
function isImage(f) { return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes((f.filename || '').split('.').pop().toLowerCase()); }

// ---------------- tooltip (nama file penuh saat hover) ----------------
let tipEl = null;
function ensureTip() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'tip';
    document.body.appendChild(tipEl);
  }
  return tipEl;
}
function showTip(e, text) {
  const t = ensureTip();
  t.textContent = text;
  t.classList.add('show');
  moveTip(e);
}
function moveTip(e) {
  const t = ensureTip();
  const pad = 14;
  t.style.left = Math.max(6, Math.min(e.clientX + pad, window.innerWidth - t.offsetWidth - pad)) + 'px';
  t.style.top = Math.max(6, e.clientY + pad) + 'px';
}
function hideTip() {
  if (tipEl) tipEl.classList.remove('show');
}
function attachTip(el, text) {
  el.addEventListener('mouseenter', (e) => showTip(e, text));
  el.addEventListener('mousemove', moveTip);
  el.addEventListener('mouseleave', hideTip);
}

// ---------------- auth ----------------
async function checkAuth() {
  try {
    const res = await fetch('/api/me');
    const me = await res.json();
    if (!me || !me.username) { window.location.href = '/login.html'; return null; }
    $('#user-badge').textContent = '@' + me.username;
    return me;
  } catch {
    window.location.href = '/login.html';
    return null;
  }
}

$('#logout-btn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// ---------------- load & render ----------------
async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const st = await res.json();
    const setupBox = $('#setup');
    if (!st.initialized) {
      setupBox.classList.remove('hidden');
      setupBox.innerHTML = `⚠️ TAS belum di-initialize.<br><br>Jalankan di server: <code>docker exec -it tas-web tas init</code>`;
      return;
    }
    setupBox.classList.add('hidden');
    $('#stat-files').textContent = st.fileCount || 0;
    $('#stat-size').textContent = fmtBytes(st.totalSize);
    $('#stat-save').textContent = (st.savingsPercent || 0) + '%';
  } catch (e) { /* ignore */ }
}

async function load() {
  $('#loading').classList.remove('hidden');
  try {
    const res = await fetch('/api/files');
    const data = await res.json();
    state.files = data.files || [];
    state.page = 0;
    state.selected.clear();
    $('#sel-count').textContent = '0';
    applyFilters();
    loadStatus();
  } catch (e) {
    $('#loading').textContent = 'Gagal memuat data.';
  }
  $('#loading').classList.add('hidden');
}

function applyFilters() {
  const q = state.search.toLowerCase();
  state.filtered = state.files.filter((f) => !q || (f.filename || '').toLowerCase().includes(q));
  const arr = state.filtered;
  if (state.sort === 'new') arr.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  else if (state.sort === 'old') arr.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  else if (state.sort === 'name') arr.sort((a, b) => (a.filename || '').localeCompare(b.filename || ''));
  else if (state.sort === 'size-d') arr.sort((a, b) => (b.original_size || 0) - (a.original_size || 0));
  else if (state.sort === 'size-a') arr.sort((a, b) => (a.original_size || 0) - (b.original_size || 0));
  render();
}

function pageItems() {
  const start = state.page * PAGE_SIZE;
  return state.filtered.slice(start, start + PAGE_SIZE);
}

function renderPager() {
  const pager = $('#pager');
  const totalPages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
  if (state.filtered.length <= PAGE_SIZE) { pager.classList.add('hidden'); return; }
  pager.classList.remove('hidden');
  pager.innerHTML =
    `<button id="pg-prev" ${state.page === 0 ? 'disabled' : ''}>‹ Prev</button>` +
    `<span>Halaman ${state.page + 1} / ${totalPages} · ${state.filtered.length} file</span>` +
    `<button id="pg-next" ${state.page >= totalPages - 1 ? 'disabled' : ''}>Next ›</button>`;
  $('#pg-prev').addEventListener('click', () => { state.page--; render(); renderPager(); });
  $('#pg-next').addEventListener('click', () => { state.page++; render(); renderPager(); });
}

function render() {
  const grid = $('#grid');
  grid.innerHTML = '';
  const items = pageItems();
  $('#empty').classList.toggle('hidden', items.length > 0);
  document.body.classList.toggle('select-mode', state.selectMode);

  items.forEach((f, i) => {
    const card = document.createElement('div');
    card.className = 'fcard' + (state.selected.has(f.hash) ? ' selected' : '');
    const tags = (f.tags || []).length
      ? `<div class="ftags">${f.tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}</div>` : '';
    card.innerHTML =
      `<div class="sel-box">✓</div>` +
      `<div class="ficon">${iconFor(f.filename || '')}</div>` +
      `<div class="fname">${escapeHtml(f.filename || f.hash)}</div>` +
      `<div class="fmeta"><span>${fmtBytes(f.original_size)}</span><span>${fmtDate(f.created_at)}</span></div>` +
      tags;
    card.addEventListener('click', () => {
      if (state.selectMode) {
        if (state.selected.has(f.hash)) state.selected.delete(f.hash);
        else state.selected.add(f.hash);
        $('#sel-count').textContent = state.selected.size;
        $('#zip-btn').disabled = state.selected.size === 0;
        card.classList.toggle('selected', state.selected.has(f.hash));
      } else {
        openPreview(i);
      }
    });
    attachTip(card.querySelector('.fname'), f.filename || f.hash);
    grid.appendChild(card);
  });
  renderPager();
}

// ---------------- preview modal ----------------
function openPreview(i) {
  state.current = i;
  const f = state.filtered[i];
  if (!f) return;
  const content = $('#preview-content');
  content.innerHTML = '';
  if (isVideo(f)) {
    const v = document.createElement('video');
    v.src = `/api/stream/${encodeURIComponent(f.hash)}`;
    v.controls = true;
    v.autoplay = true;
    v.className = 'preview-media video';
    content.appendChild(v);
  } else if (isImage(f)) {
    const img = document.createElement('img');
    img.src = `/api/stream/${encodeURIComponent(f.hash)}`;
    img.className = 'preview-media';
    content.appendChild(img);
  } else {
    content.innerHTML = `<div style="font-size:52px;text-align:center;padding:30px">${iconFor(f.filename)}</div>`;
  }
  $('#preview-meta').innerHTML =
    `<span class="handle">${escapeHtml(f.filename)}</span>` +
    `<br>${fmtBytes(f.original_size)} · ${fmtDate(f.created_at)} · hash ${escapeHtml((f.hash || '').slice(0, 12))}…`;
  $('#preview-actions').innerHTML =
    `<button class="btn" id="pv-download">⬇ Download</button>` +
    `<button class="btn ghost" id="pv-share">🔗 Share</button>` +
    `<button class="btn danger" id="pv-delete">🗑 Hapus</button>`;
  $('#preview').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  $('#pv-download').onclick = () => { window.location.href = `/api/download/${encodeURIComponent(f.hash)}`; };
  $('#pv-share').onclick = () => openShare(f);
  $('#pv-delete').onclick = async () => {
    if (!confirm(`Hapus "${f.filename}" permanen dari Telegram?`)) return;
    try {
      const res = await fetch(`/api/delete/${encodeURIComponent(f.hash)}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'gagal');
      toast('File dihapus', 'ok');
      closePreview();
      load();
    } catch (e) { toast('Gagal hapus: ' + e.message, 'err'); }
  };
}

function closePreview() {
  $('#preview').classList.add('hidden');
  const v = $('#preview-content video');
  if (v) v.pause();
  document.body.style.overflow = '';
  state.current = -1;
}

function navPreview(dir) {
  const n = state.filtered.length;
  if (!n) return;
  state.current = (state.current + dir + n) % n;
  openPreview(state.current);
}

$('#preview-close').addEventListener('click', closePreview);
$('#preview-x').addEventListener('click', closePreview);
$('#p-prev').addEventListener('click', () => navPreview(-1));
$('#p-next').addEventListener('click', () => navPreview(1));
document.addEventListener('keydown', (e) => {
  if (!$('#preview').classList.contains('hidden')) {
    if (e.key === 'Escape') closePreview();
    if (e.key === 'ArrowLeft') navPreview(-1);
    if (e.key === 'ArrowRight') navPreview(1);
  }
});

// ---------------- upload (multi, queue, progress) ----------------
const uploadQueue = [];
let uploading = false;

function enqueueUploads(fileList) {
  for (const f of fileList) uploadQueue.push(f);
  processQueue();
  toast(`${fileList.length} file masuk antrian`, 'running');
  pollJobs();
}

async function processQueue() {
  if (uploading || !uploadQueue.length) return;
  uploading = true;
  const file = uploadQueue.shift();
  try {
    await uploadOne(file);
  } catch (e) {
    toast('Upload gagal: ' + e.message, 'err');
  }
  uploading = false;
  if (uploadQueue.length) processQueue();
}

function uploadOne(file) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('files', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) toast(`⬆ ${file.name} — ${Math.round((e.loaded / e.total) * 100)}%`, 'running');
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (data.jobs && data.jobs.length) {
          toast(`⏳ ${file.name} diproses (encrypt + upload ke Telegram)...`, 'running');
          pollJobs(); // pastikan polling jalan — job server baru ada setelah upload selesai
        } else {
          throw new Error(data.error || 'Gagal');
        }
        resolve();
      } catch (err) { reject(err); }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(fd);
  });
}

// ---------------- jobs ----------------
async function pollJobs() {
  try {
    const res = await fetch('/api/jobs');
    const { jobs } = await res.json();
    state.jobs = jobs || [];
    const wrap = $('#jobs');
    wrap.innerHTML = '';
    const active = state.jobs.filter((j) => j.status === 'running');

    state.jobs.slice().reverse().slice(0, 6).forEach((j) => {
      const line = document.createElement('div');
      line.className = 'job-line ' + j.status;
      const icon = j.status === 'running' ? '⏳' : j.status === 'done' ? '✅' : '❌';
      let retry = '';
      if (j.status === 'error' && j.tmpPath) {
        retry = `<button class="btn small retry-btn" data-retry="${j.id}">Ulang</button>`;
      }
      line.innerHTML = `<span>${icon}</span><span class="job-name">${escapeHtml(j.name)} — ${escapeHtml(j.message)}</span>${retry}`;
      wrap.appendChild(line);
    });

    wrap.querySelectorAll('[data-retry]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await fetch('/api/upload/retry/' + btn.dataset.retry, { method: 'POST' });
        pollJobs();
      });
    });

    if (active.length || uploading || uploadQueue.length) {
      // lanjut polling selama masih ada job aktif ATAU upload dalam antrian
      setTimeout(pollJobs, 2500);
    } else if (state.jobs.length) {
      const last = state.jobs[state.jobs.length - 1];
      if (last && last.status === 'done') { toast(last.message, 'ok'); load(); }
      if (last && last.status === 'error') toast(last.message, 'err');
    }
  } catch (e) { /* ignore */ }
}

// ---------------- share ----------------
let shareFile = null;

function openShare(f) {
  shareFile = f;
  $('#share-file').textContent = f.filename;
  $('#share-url').classList.add('hidden');
  $('#share-expire').value = '24';
  $('#share-max').value = '1';
  $('#share-dlg').classList.remove('hidden');
}

$('#share-close').addEventListener('click', () => $('#share-dlg').classList.add('hidden'));
$('#share-x').addEventListener('click', () => $('#share-dlg').classList.add('hidden'));

$('#share-create').addEventListener('click', async () => {
  if (!shareFile) return;
  try {
    const res = await fetch(`/api/share/${encodeURIComponent(shareFile.hash)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expire: $('#share-expire').value, maxDownloads: $('#share-max').value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal');
    const url = location.origin + data.url;
    $('#share-url').classList.remove('hidden');
    $('#share-url').textContent = url;
    navigator.clipboard?.writeText(url).catch(() => {});
    toast('Link share dibuat & disalin', 'ok');
  } catch (e) { toast('Gagal: ' + e.message, 'err'); }
});

// ---------------- dashboard ----------------
$('#dash-btn').addEventListener('click', async () => {
  $('#dash-dlg').classList.remove('hidden');
  try {
    const [statsRes, actRes, shareRes] = await Promise.all([
      fetch('/api/stats'), fetch('/api/activity'), fetch('/api/shares'),
    ]);
    const st = await statsRes.json();
    const act = await actRes.json();
    const shares = await shareRes.json();

    const cards = [
      ['File', st.fileCount || 0],
      ['Total', fmtBytes(st.totalSize)],
      ['Tersimpan', fmtBytes(st.storedSize)],
      ['Hemat', (st.savingsPercent || 0) + '%'],
      ['Cache', fmtBytes(st.cacheBytes)],
      ['Share aktif', st.activeShares || 0],
    ];
    const b = st.byType || {};
    for (const [k, v] of Object.entries(b)) cards.push([k, v]);
    $('#dash-stats').innerHTML = cards.map(([l, n]) =>
      `<div class="stat-box"><div class="num">${n}</div><div class="lbl">${l}</div></div>`).join('');

    $('#dash-act').innerHTML = (act.activity || []).length
      ? act.activity.map((a) =>
        `<div><span class="a-time">${fmtDateTime(a.ts)}</span><span>${escapeHtml(a.action)} — ${escapeHtml(a.detail)}</span></div>`).join('')
      : '<div>Belum ada aktivitas</div>';

    $('#dash-shares').innerHTML = (shares.shares || []).length
      ? shares.shares.map((s) =>
        `<div><span class="a-time">${fmtDateTime(s.created_at)}</span><span>${escapeHtml(s.filename)} · ${s.downloads}/${s.max_downloads}x · ${Math.round((s.expires_at - Date.now()) / 3600000)}j lagi</span></div>`).join('')
      : '<div>Tidak ada share link</div>';
  } catch (e) {
    $('#dash-stats').innerHTML = `<div class="lbl">Gagal: ${escapeHtml(e.message)}</div>`;
  }
});

$('#dash-close').addEventListener('click', () => $('#dash-dlg').classList.add('hidden'));
$('#dash-x').addEventListener('click', () => $('#dash-dlg').classList.add('hidden'));

// ---------------- events ----------------
$('#refresh-btn').addEventListener('click', load);
$('#search').addEventListener('input', (e) => { state.search = e.target.value.trim(); state.page = 0; applyFilters(); });
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; applyFilters(); });

$('#upload-btn').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', (e) => {
  if (e.target.files.length) enqueueUploads([...e.target.files]);
  e.target.value = '';
});

$('#url-btn').addEventListener('click', async () => {
  const url = prompt('URL file yang mau di-upload (server yang download):');
  if (!url) return;
  try {
    const res = await fetch('/api/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal');
    toast('Download dari URL dimulai: ' + (data.name || ''), 'running');
    pollJobs();
  } catch (e) { toast('Gagal: ' + e.message, 'err'); }
});

$('#select-btn').addEventListener('click', () => {
  state.selectMode = !state.selectMode;
  if (!state.selectMode) {
    state.selected.clear();
    $('#sel-count').textContent = '0';
    $('#zip-btn').disabled = true;
  }
  $('#select-btn').classList.toggle('active-sel', state.selectMode);
  render();
});

$('#zip-btn').addEventListener('click', async () => {
  if (!state.selected.size) return;
  const ids = [...state.selected];
  toast(`Menyiapkan ZIP ${ids.length} file...`, 'running');
  try {
    const res = await fetch('/api/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Gagal ZIP');
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tas-' + Date.now() + '.zip';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('ZIP siap', 'ok');
  } catch (e) { toast('Gagal: ' + e.message, 'err'); }
});

const dz = $('#dropzone');
dz.addEventListener('click', () => $('#file-input').click());
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', (e) => {
  e.preventDefault();
  dz.classList.remove('over');
  if (e.dataTransfer.files.length) enqueueUploads([...e.dataTransfer.files]);
});

// ---------------- theme toggle ----------------
function applyThemeBtn() {
  const th = document.documentElement.dataset.theme;
  $('#theme-btn').textContent = th === 'light' ? '🌙' : '☀️';
}
$('#theme-btn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('tasTheme', next);
  applyThemeBtn();
});

// ---------------- multi-bot (switch storage bot) ----------------
let profiles = [];

async function loadProfiles() {
  try {
    const res = await fetch('/api/profiles');
    const data = await res.json();
    profiles = data.profiles || [];
    const sel = $('#bot-select');
    sel.innerHTML = profiles.map((p) =>
      `<option value="${p.id}" ${p.isActive ? 'selected' : ''}>${p.initialized ? '🤖' : '📦'} ${escapeHtml(p.name)}${p.botUsername ? ' (@' + escapeHtml(p.botUsername) + ')' : ''}${p.isActive ? ' ✓' : ''}</option>`).join('');
    $('#bot-del-btn').classList.toggle('hidden', profiles.length <= 1);
  } catch (e) { /* ignore */ }
}

$('#bot-select').addEventListener('change', async (e) => {
  const id = e.target.value;
  if (!id) return;
  try {
    const res = await fetch('/api/profiles/' + id + '/switch', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal switch');
    toast('Storage bot diganti: ' + data.active.name, 'ok');
    load();
    loadStatus();
  } catch (err) { toast('Gagal switch: ' + err.message, 'err'); }
});

$('#add-bot-btn').addEventListener('click', () => {
  $('#bot-progress').textContent = '';
  $('#bot-progress').style.color = '';
  $('#bot-dlg').classList.remove('hidden');
});
$('#bot-close').addEventListener('click', () => $('#bot-dlg').classList.add('hidden'));
$('#bot-x').addEventListener('click', () => $('#bot-dlg').classList.add('hidden'));

$('#bot-create').addEventListener('click', async () => {
  const btn = $('#bot-create');
  const name = $('#bot-name').value.trim();
  const token = $('#bot-token').value.trim();
  const pass = $('#bot-pass').value;
  if (!token.includes(':')) return toast('Token bot tidak valid', 'err');
  if (pass.length < 8) return toast('Password minimal 8 karakter', 'err');
  btn.disabled = true;
  $('#bot-progress').textContent = 'Membuat profile...';
  try {
    const cre = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const prof = await cre.json();
    if (!cre.ok) throw new Error(prof.error || 'gagal buat profile');
    $('#bot-progress').textContent = 'Init: menghubungkan ke Telegram...';
    const ini = await fetch('/api/profiles/' + prof.id + '/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: pass }),
    });
    const iniData = await ini.json();
    if (!ini.ok) throw new Error(iniData.error || 'gagal init');
    let tries = 0;
    const poll = setInterval(async () => {
      tries++;
      try {
        const r = await fetch('/api/profiles/' + prof.id);
        const d = await r.json();
        const st = d.initState || {};
        if (st.status === 'running') {
          $('#bot-progress').textContent = '⏳ ' + (st.message || '...') +
            (tries > 3 ? '\n📩 Sekarang kirim pesan apa saja ke bot barumu di Telegram!' : '');
        } else if (st.status === 'done') {
          clearInterval(poll);
          $('#bot-progress').textContent = '✅ ' + (st.message || 'Tersambung');
          await fetch('/api/profiles/' + prof.id + '/switch', { method: 'POST' });
          loadProfiles();
          load();
          loadStatus();
          toast('Bot baru aktif! 🎉', 'ok');
          setTimeout(() => { $('#bot-dlg').classList.add('hidden'); btn.disabled = false; }, 1200);
        } else if (st.status === 'error') {
          clearInterval(poll);
          $('#bot-progress').style.color = '#e74c3c';
          $('#bot-progress').textContent = '❌ ' + (st.message || 'gagal init');
          btn.disabled = false;
        }
      } catch (e) { /* lanjut polling */ }
    }, 2500);
  } catch (e) {
    $('#bot-progress').style.color = '#e74c3c';
    $('#bot-progress').textContent = '❌ ' + e.message;
    btn.disabled = false;
  }
});

$('#bot-del-btn').addEventListener('click', async () => {
  const active = profiles.find((p) => p.isActive);
  if (!active) return;
  if (!confirm(`Hapus bot "${active.name}"? File di Telegram TIDAK dihapus (cuma profile-nya dilepas).`)) return;
  try {
    const res = await fetch('/api/profiles/' + active.id, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'gagal hapus');
    toast('Bot dihapus, switch ke profile lain', 'ok');
    loadProfiles();
    load();
    loadStatus();
  } catch (e) { toast('Gagal: ' + e.message, 'err'); }
});

// ---------------- init ----------------
(async () => {
  const me = await checkAuth();
  if (!me) return;
  loadProfiles();
  load();
})();
