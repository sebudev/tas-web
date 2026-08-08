<script setup>
import { computed, ref } from 'vue';
import { store } from '../store';
import { applyFilters, enqueueUploads, uploadUrl, deleteFiles, clearSelection, loadFiles } from '../composables/useApp';
import { toast } from '../composables/useToast';
import { confirmDialog } from '../composables/useConfirm';

const fileInput = ref(null);
const emit = defineEmits(['select', 'preview-select', 'zip', 'delete']);

const selCount = computed(() => store.selected.size);

function onFiles(e) {
  if (e.target.files.length) enqueueUploads([...e.target.files]);
  e.target.value = '';
}

function toggleView() {
  store.view = store.view === 'grid' ? 'table' : 'grid';
  localStorage.setItem('tasView', store.view);
}

async function onUrl() {
  const url = prompt('URL file yang mau di-upload (server yang download):');
  if (url) await uploadUrl(url);
}

async function onDeleteMulti() {
  const n = store.selected.size;
  if (!n) return;
  const ok = await confirmDialog({
    title: 'Hapus file?',
    message: `Hapus ${n} file PERMANEN dari Telegram?\n\nFile dihapus dari index DAN pesan chunk di chat bot — tidak bisa dikembalikan.`,
    confirmText: 'Hapus ' + n + ' File',
  });
  if (!ok) return;
  const ids = [...store.selected];
  const okCount = await deleteFiles(ids);
  clearSelection();
  toast('🗑 ' + okCount + '/' + n + ' file dihapus', okCount === n ? 'ok' : 'err');
  loadFiles();
}

function onZip() {
  if (store.selected.size) emit('zip', [...store.selected]);
}

function toggleSelectMode() {
  store.selectMode = !store.selectMode;
  if (!store.selectMode) clearSelection();
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 my-4">
    <input ref="fileInput" type="file" multiple hidden @change="onFiles" />
    <button class="btn" @click="fileInput.click()">⬆ Upload</button>
    <button class="btn-ghost" @click="onUrl">🔗 Dari URL</button>
    <button class="btn-ghost" @click="loadFiles">↻</button>
    <button class="btn-ghost" :class="{ 'btn-active': store.selectMode }" @click="toggleSelectMode">☑ Pilih</button>
    <button class="btn-ghost" :disabled="selCount === 0" @click="onZip">🗜 ZIP ({{ selCount }})</button>
    <button class="btn-danger" :disabled="selCount === 0" @click="onDeleteMulti">🗑 Hapus ({{ selCount }})</button>
    <button class="btn-ghost" :title="store.view === 'grid' ? 'Tampilan tabel' : 'Tampilan kartu'" @click="toggleView">
      {{ store.view === 'grid' ? '☰' : '⊞' }}
    </button>

    <input v-model="store.search" class="flex-1 min-w-[160px] px-4 py-2.5 rounded-[10px] border border-line bg-bg-2 text-txt text-sm outline-none focus:border-accent" type="search" placeholder="Cari file..." @input="store.page = 0; applyFilters()" />

    <select v-model="store.sort" class="bg-bg-2 border border-line rounded-[10px] px-2.5 py-2.5 text-[13px] text-txt outline-none" @change="applyFilters">
      <option value="new">Terbaru</option>
      <option value="old">Terlama</option>
      <option value="name">Nama A-Z</option>
      <option value="size-d">Ukuran terbesar</option>
      <option value="size-a">Ukuran terkecil</option>
    </select>
  </div>
</template>

<style scoped>
.btn {
  background: var(--accent); border: none; color: #fff; font-weight: 600; font-size: 13px;
  padding: 9px 14px; border-radius: 10px; cursor: pointer; white-space: nowrap;
}
.btn:hover { filter: brightness(1.15); }
.btn-ghost {
  background: transparent; border: 1px solid var(--border); color: var(--text);
  padding: 9px 14px; border-radius: 10px; font-size: 13px; cursor: pointer; white-space: nowrap;
}
.btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
.btn-ghost:disabled { opacity: .5; cursor: not-allowed; }
.btn-active { border-color: var(--accent-2); color: var(--accent-2); }
.btn-danger {
  background: rgba(231,76,60,.12); color: #e74c3c; border: 1px solid rgba(231,76,60,.4);
  padding: 9px 14px; border-radius: 10px; font-size: 13px; cursor: pointer; white-space: nowrap;
}
.btn-danger:hover { filter: brightness(1.2); }
.btn-danger:disabled { opacity: .5; cursor: not-allowed; }
@media (max-width: 700px) {
  .btn, .btn-ghost, .btn-danger { padding: 8px 11px; font-size: 12px; }
}
</style>
