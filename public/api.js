const $ = (s) => document.querySelector(s);
let toastTimer = null;

function toast(msg, cls = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + cls;
  clearTimeout(toastTimer);
  if (!cls.includes('running')) toastTimer = setTimeout(() => t.classList.add('hidden'), 5000);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('id-ID') + ' ' +
    new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

async function checkAuth() {
  try {
    const res = await fetch('/api/me');
    const me = await res.json();
    if (!me || !me.username) { window.location.href = '/login.html'; return null; }
    return me;
  } catch { window.location.href = '/login.html'; return null; }
}

// theme toggle
function applyThemeBtn() {
  $('#theme-btn').textContent = document.documentElement.dataset.theme === 'light' ? '🌙' : '☀️';
}
$('#theme-btn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('tasTheme', next);
  applyThemeBtn();
});

async function loadProfiles() {
  try {
    const res = await fetch('/api/profiles');
    const data = await res.json();
    const sel = $('#prof-select');
    sel.innerHTML = (data.profiles || []).map((p) =>
      `<option value="${p.id}">${p.initialized ? '🤖' : '📦'} ${escapeHtml(p.name)}${p.botUsername ? ' (@' + escapeHtml(p.botUsername) + ')' : ''}</option>`).join('');
  } catch (e) { /* ignore */ }
}

async function loadTokens() {
  try {
    const res = await fetch('/api/tokens');
    const { tokens } = await res.json();
    const list = $('#tok-list');
    if (!tokens.length) {
      list.innerHTML = '<div class="empty-txt">Belum ada API token. Buat di atas 👆</div>';
      return;
    }
    list.innerHTML = tokens.map((t) => `
      <div class="tok-row">
        <span class="tok-badge">${t.active ? '🟢' : '⚪'} ${escapeHtml(t.token)}</span>
        <div class="tok-info">
          <div class="tok-name">${escapeHtml(t.name)} ${t.active ? '' : '<span style="color:#e74c3c">(revoked)</span>'}</div>
          <div class="tok-meta">Bot: ${escapeHtml(t.profile_name || '—')} · dibuat ${fmtDate(t.created_at)} · terakhir dipakai ${fmtDate(t.last_used_at)}</div>
        </div>
        ${t.active ? `<button class="btn danger small" data-revoke="${t.id}">Revoke</button>` : ''}
      </div>`).join('');

    list.querySelectorAll('[data-revoke]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Revoke token ini? Service yang memakainya langsung tidak bisa akses API.')) return;
        try {
          const res = await fetch('/api/tokens/' + btn.dataset.revoke, { method: 'DELETE' });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'gagal');
          toast('Token di-revoke', 'ok');
          loadTokens();
        } catch (e) { toast('Gagal: ' + e.message, 'err'); }
      });
    });
  } catch (e) { /* ignore */ }
}

$('#create-btn').addEventListener('click', async () => {
  const profileId = $('#prof-select').value;
  const name = $('#tok-name').value.trim();
  if (!profileId) return toast('Pilih bot dulu', 'err');
  try {
    const res = await fetch('/api/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: parseInt(profileId, 10), name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'gagal buat token');
    $('#new-token-box').innerHTML =
      `<div class="new-token">✅ Token baru (disalin ke clipboard):<br><b>${escapeHtml(data.token)}</b></div>`;
    navigator.clipboard?.writeText(data.token).catch(() => {});
    toast('Token dibuat & disalin!', 'ok');
    $('#tok-name').value = '';
    loadTokens();
  } catch (e) { toast('Gagal: ' + e.message, 'err'); }
});

(async () => {
  const me = await checkAuth();
  if (!me) return;
  applyThemeBtn();
  loadProfiles();
  loadTokens();
})();
