import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useStorage } from '@vueuse/core';

export const PAGE_SIZE = 24;

export const useAppStore = defineStore('app', () => {
  // auth
  const user = ref(null);
  // files
  const files = ref([]);
  const filtered = ref([]);
  const page = ref(0);
  const search = ref('');
  const sort = ref('new');
  const view = useStorage('tasView', 'grid');
  const selectMode = ref(false);
  const selected = ref(new Set());
  const current = ref(-1);
  const loading = ref(false);
  // jobs & uploads
  const jobs = ref([]);
  const uploadQueue = ref([]);
  const uploading = ref(false);
  // bots
  const profiles = ref([]);
  const activeId = ref(null);
  // apps (workspace: grup bot + api keys)
  const apps = ref([]);
  const currentApp = ref(null);
  const allBots = ref(false);
  // folders
  const folders = ref([]);
  const fileFolder = ref({});
  const currentFolder = ref(null);
  const expandedFolders = ref(new Set());
  // dashboard
  const stats = ref(null);
  const activity = ref([]);
  const shares = ref([]);

  return {
    user, files, filtered, page, search, sort, view, selectMode, selected, current, loading,
    jobs, uploadQueue, uploading, profiles, activeId, apps, currentApp, allBots,
    folders, fileFolder, currentFolder, expandedFolders, stats, activity, shares,
  };
});

// ---- helpers (keep pure) ----
export function fmtBytes(b) {
  if (b == null) return '–';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}
export function fmtDate(s) {
  if (!s) return '–';
  const d = new Date(s);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}
export function fmtDateTime(ts) {
  return new Date(ts).toLocaleDateString('id-ID') + ' ' +
    new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>\"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;',
  }[c]));
}
export function iconFor(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  if (['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(ext)) return '🎬';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return '🖼️';
  if (['mp3', 'wav', 'flac', 'ogg'].includes(ext)) return '🎵';
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) return '🗜️';
  if (['pdf'].includes(ext)) return '📄';
  if (['doc', 'docx', 'txt', 'md'].includes(ext)) return '📝';
  return '📦';
}
export function isVideo(f) {
  return ['mp4', 'mkv', 'webm', 'mov', 'avi'].includes((f.filename || '').split('.').pop().toLowerCase());
}
export function isImage(f) {
  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes((f.filename || '').split('.').pop().toLowerCase());
}
