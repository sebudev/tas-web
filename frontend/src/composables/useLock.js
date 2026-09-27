// Kunci file (password) — sisi klien.
// File terkunci tidak bisa di-preview/download/stream tanpa token "unlock".
// Token disimpan di store.unlocks (memori sesi browser) & dititipkan ke
// request lewat query `?unlock=` (tag video/img & navigasi download).
import { store } from '../store';
import { apiPost } from './useApi';
import { toast } from './useToast';
import { promptDialog } from './usePrompt';

function profileQ(file) {
  return file && file.profileId ? `?profileId=${file.profileId}` : '';
}

// token valid (belum kadaluarsa) utk file ini, atau '' kalau tidak ada.
// (tidak menghapus entri di sini — dipanggil dari computed, hindari side-effect)
export function unlockTokenFor(file) {
  if (!file || !file.locked) return '';
  const u = store.unlocks[file.hash];
  if (!u) return '';
  if (u.expiresAt && Date.now() > u.expiresAt) return '';
  return u.token || '';
}

export function isUnlocked(file) {
  return !file || !file.locked || !!unlockTokenFor(file);
}

export async function unlockFile(file, password) {
  const data = await apiPost('/api/files/' + encodeURIComponent(file.hash) + '/unlock' + profileQ(file), { password });
  if (data.locked && data.token) {
    store.unlocks[file.hash] = { token: data.token, expiresAt: data.expiresAt || 0 };
  }
  return data;
}

// minta password ke user, sampai 3x percobaan. balikin token (string) atau null.
export async function promptUnlock(file) {
  for (let i = 0; i < 3; i++) {
    const pw = await promptDialog({
      title: '🔒 File terkunci',
      message: file.hint ? `Hint: ${file.hint}` : 'Masukkan password untuk membuka file ini.',
      placeholder: 'Password',
      okText: 'Buka',
      type: 'password',
    });
    if (pw == null) return null;
    try {
      const d = await unlockFile(file, pw);
      if (!d.locked || d.token) { toast('🔓 ' + (file.filename || 'File') + ' dibuka', 'ok'); return d.token || ''; }
      return '';
    } catch (e) {
      if (e.status === 429) { toast(e.message, 'err'); return null; }
      if (i < 2) toast('Password salah, coba lagi', 'err');
      else toast('Gagal membuka file: password salah', 'err');
    }
  }
  return null;
}

// pastikan file boleh diakses; balikin true kalau (sudah) terbuka
export async function ensureUnlocked(file) {
  if (!file || !file.locked) return true;
  if (unlockTokenFor(file)) return true;
  const t = await promptUnlock(file);
  return !!t;
}

export async function setFileLock(file, { password, hint, currentPassword } = {}) {
  await apiPost('/api/files/' + encodeURIComponent(file.hash) + '/lock' + profileQ(file), { password, hint, currentPassword });
  file.locked = true;
  file.hint = hint || '';
  delete store.unlocks[file.hash];
}

export async function removeFileLock(file, password) {
  await apiPost('/api/files/' + encodeURIComponent(file.hash) + '/lock/remove' + profileQ(file), { password });
  file.locked = false;
  file.hint = '';
  delete store.unlocks[file.hash];
}

// URL stream (preview) dengan token unlock kalau sudah dibuka
export function streamUrl(file) {
  const parts = [];
  if (file.profileId) parts.push('profileId=' + file.profileId);
  const t = unlockTokenFor(file);
  if (t) parts.push('unlock=' + encodeURIComponent(t));
  return '/api/stream/' + encodeURIComponent(file.hash) + (parts.length ? '?' + parts.join('&') : '');
}

// URL download dengan token unlock kalau sudah dibuka
export function downloadUrl(file) {
  const parts = [];
  if (file.profileId) parts.push('profileId=' + file.profileId);
  const t = unlockTokenFor(file);
  if (t) parts.push('unlock=' + encodeURIComponent(t));
  return '/api/download/' + encodeURIComponent(file.hash) + (parts.length ? '?' + parts.join('&') : '');
}
