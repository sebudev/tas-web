import { computed } from 'vue';
import { store, PAGE_SIZE } from '../store';
import { apiGet, apiPost, apiDelete } from './useApi';
import { toast } from './useToast';

// ---------- files: load/filter/sort/paginate ----------
export async function loadFiles() {
  store.loading = true;
  try {
    const data = await apiGet('/api/files');
    store.files = data.files || [];
    store.page = 0;
    store.selected.clear();
    applyFilters();
  } catch (e) { /* toast handled by caller */ }
  store.loading = false;
}

// ---------- folders ----------
export async function loadFolders() {
  try {
    const data = await apiGet('/api/folders');
    store.folders = data.folders || [];
    store.fileFolder = data.fileFolders || {};
    if (store.currentFolder && !store.folders.some((f) => f.id === store.currentFolder)) {
      store.currentFolder = null; // folder yang dibuka sudah terhapus
    }
    applyFilters();
  } catch { /* ignore */ }
}

export function folderById(id) {
  return store.folders.find((f) => f.id === id) || null;
}

export function folderChildren(parentId) {
  return store.folders
    .filter((f) => (f.parentId || null) === (parentId || null))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function folderPath(id) {
  const path = [];
  let cur = folderById(id);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = folderById(cur.parentId);
  }
  return path;
}

export function openFolder(id) {
  store.currentFolder = id || null;
  store.page = 0;
  clearSelection();
  applyFilters();
}

export function applyFilters() {
  const q = store.search.toLowerCase();
  let arr = store.files.filter((f) => !q || (f.filename || '').toLowerCase().includes(q));
  // filter folder: hanya file yang ada di folder aktif (root = semua file)
  if (store.currentFolder) {
    arr = arr.filter((f) => store.fileFolder[f.hash] === store.currentFolder);
  }
  if (store.sort === 'new') arr.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  else if (store.sort === 'old') arr.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  else if (store.sort === 'name') arr.sort((a, b) => (a.filename || '').localeCompare(b.filename || ''));
  else if (store.sort === 'size-d') arr.sort((a, b) => (b.original_size || 0) - (a.original_size || 0));
  else if (store.sort === 'size-a') arr.sort((a, b) => (a.original_size || 0) - (b.original_size || 0));
  store.filtered = arr;
}

export const pageItems = computed(() => {
  const start = store.page * PAGE_SIZE;
  return store.filtered.slice(start, start + PAGE_SIZE);
});

export const totalPages = computed(() => Math.max(1, Math.ceil(store.filtered.length / PAGE_SIZE)));

// ---------- selection ----------
export function toggleSelect(f) {
  if (store.selected.has(f.hash)) store.selected.delete(f.hash);
  else store.selected.add(f.hash);
}

export function clearSelection() {
  store.selected.clear();
  store.selectMode = false;
}

// ---------- status ----------
export async function loadStatus() {
  try {
    const st = await apiGet('/api/status');
    store.stats = st;
  } catch { store.stats = null; }
}

// ---------- profiles / multi-bot ----------
export async function loadProfiles() {
  try {
    const data = await apiGet('/api/profiles');
    store.profiles = data.profiles || [];
    store.activeId = data.activeId;
  } catch { /* ignore */ }
}

export async function switchProfile(id) {
  try {
    const data = await apiPost('/api/profiles/' + id + '/switch');
    toast('Storage bot diganti: ' + data.active.name, 'ok');
    store.activeId = id;
    await loadProfiles();
    await loadFiles();
    await loadStatus();
    return true;
  } catch (e) { toast('Gagal switch: ' + e.message, 'err'); return false; }
}

export async function deleteProfile(id) {
  try {
    await apiDelete('/api/profiles/' + id);
    toast('Bot dihapus, switch ke profile lain', 'ok');
    await loadProfiles();
    await loadFiles();
    await loadStatus();
  } catch (e) { toast('Gagal: ' + e.message, 'err'); }
}

// ---------- uploads ----------
export function enqueueUploads(fileList) {
  for (const f of fileList) store.uploadQueue.push(f);
  processQueue();
  toast(fileList.length + ' file masuk antrian', 'running');
}

async function processQueue() {
  if (store.uploading || !store.uploadQueue.length) return;
  store.uploading = true;
  const file = store.uploadQueue.shift();
  try { await uploadOne(file); } catch (e) { toast('Upload gagal: ' + e.message, 'err'); }
  store.uploading = false;
  if (store.uploadQueue.length) processQueue();
}

function uploadOne(file) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('files', file);
    if (store.currentFolder) fd.append('folderId', store.currentFolder);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) toast('⬆ ' + file.name + ' — ' + Math.round((e.loaded / e.total) * 100) + '%', 'running');
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (data.jobs && data.jobs.length) {
          toast('⏳ ' + file.name + ' diproses (encrypt + upload ke Telegram)...', 'running');
          pollJobs();
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

// ---------- jobs ----------
export async function pollJobs() {
  try {
    const { jobs } = await apiGet('/api/jobs');
    store.jobs = jobs || [];
    const active = store.jobs.filter((j) => j.status === 'running');
    if (active.length || store.uploading || store.uploadQueue.length) {
      setTimeout(pollJobs, 2500);
    } else if (store.jobs.length) {
      const last = store.jobs[store.jobs.length - 1];
      if (last.status === 'done') { toast(last.message, 'ok'); loadFiles(); loadFolders(); }
      if (last.status === 'error') toast(last.message, 'err');
    }
  } catch { /* ignore */ }
}

export async function retryJob(id) {
  try { await apiPost('/api/upload/retry/' + id); pollJobs(); } catch (e) { toast('Gagal: ' + e.message, 'err'); }
}

export async function uploadUrl(url) {
  try {
    const data = await apiPost('/api/upload-url', { url, folderId: store.currentFolder || null });
    toast('Download dari URL dimulai: ' + (data.name || ''), 'running');
    pollJobs();
  } catch (e) { toast('Gagal: ' + e.message, 'err'); }
}

// ---------- actions ----------
export async function deleteFiles(ids) {
  let ok = 0;
  for (let i = 0; i < ids.length; i++) {
    toast('🗑 Menghapus ' + (i + 1) + '/' + ids.length + '...', 'running');
    try {
      await apiPost('/api/delete/' + encodeURIComponent(ids[i]));
      ok++;
    } catch (e) { toast('Gagal hapus #' + (i + 1) + ': ' + e.message, 'err'); }
    await new Promise((r) => setTimeout(r, 500));
  }
  return ok;
}

// ---------- folder actions ----------
export async function createFolder(name, parentId) {
  const data = await apiPost('/api/folders', { name, parentId: parentId || null });
  await loadFolders();
  return data;
}

export async function renameFolder(id, name) {
  await apiPost('/api/folders/' + id + '/rename', { name });
  await loadFolders();
}

export async function deleteFolder(id) {
  const f = folderById(id);
  await apiDelete('/api/folders/' + id);
  if (store.currentFolder === id) openFolder(null);
  await loadFolders();
  toast('📁 Folder "' + (f ? f.name : '') + '" dihapus — file tetap aman', 'ok');
}

export async function moveFiles(hashes, folderId) {
  await apiPost('/api/files/folder', { hashes, folderId: folderId || null });
  await Promise.all([loadFolders(), loadFiles()]);
}

export async function createShare(file, expire, maxDl) {
  const data = await apiPost('/api/share/' + encodeURIComponent(file.hash), { expire, maxDownloads: maxDl });
  return data;
}

export async function loadDashboard() {
  const [stats, act, shares] = await Promise.all([
    apiGet('/api/stats'), apiGet('/api/activity'), apiGet('/api/shares'),
  ]);
  store.stats = stats;
  store.activity = act.activity || [];
  store.shares = shares.shares || [];
}

// ---------- api tokens ----------
export async function createToken(profileId, name) {
  const data = await apiPost('/api/tokens', { profileId, name });
  return data;
}
export async function revokeToken(id) {
  await apiDelete('/api/tokens/' + id);
}

// ---------- theme ----------
export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('tasTheme', next);
}
export const isLight = () => document.documentElement.dataset.theme === 'light';
