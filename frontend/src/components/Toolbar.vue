<script setup>
import { computed, ref } from 'vue';
import { store } from '../store';
import { applyFilters, enqueueUploads, uploadUrl, deleteFiles, clearSelection, loadFiles } from '../composables/useApp';
import { toast } from '../composables/useToast';
import { confirmDialog } from '../composables/useConfirm';
import { promptDialog } from '../composables/usePrompt';
import SelectRadix from './ui/SelectRadix.vue';
import { Upload, Link2, FolderPlus, RefreshCw, CheckSquare, Archive, FolderInput, Trash2, LayoutGrid, List } from '@lucide/vue';

const fileInput = ref(null);
const emit = defineEmits(['select', 'preview-select', 'zip', 'delete', 'move', 'toggle-folders']);
const selCount = computed(() => store.selected.size);

function onFiles(e) { if (e.target.files.length) enqueueUploads([...e.target.files]); e.target.value = ''; }
function toggleView() { store.view = store.view === 'grid' ? 'table' : 'grid'; localStorage.setItem('tasView', store.view); }
async function onUrl() {
 const url = await promptDialog({ title: 'Upload dari URL', message: 'Server yang akan mendownload filenya (bukan browser kamu).', placeholder: 'https://...', okText: 'Download' });
 if (url) await uploadUrl(url);
}
async function onDeleteMulti() {
 const n = store.selected.size; if (!n) return;
 const ok = await confirmDialog({ title: 'Hapus file?', message: `Hapus ${n} file PERMANEN dari Telegram?\n\nFile dihapus dari index DAN pesan chunk di chat bot — tidak bisa dikembalikan.`, confirmText: 'Hapus ' + n + ' File' });
 if (!ok) return;
 const ids = [...store.selected]; const okCount = await deleteFiles(ids); clearSelection(); toast('' + okCount + '/' + n + ' file dihapus', okCount === n ? 'ok' : 'err'); loadFiles();
}
function onZip() { if (store.allBots) return toast('ZIP belum didukung di view "Semua Bot" — pilih satu bot dulu', 'err'); if (store.selected.size) emit('zip', [...store.selected]); }
const sortOptions = [
 { value: 'new', label: 'Terbaru' },
 { value: 'old', label: 'Terlama' },
 { value: 'name', label: 'Nama A-Z' },
 { value: 'size-d', label: 'Terbesar' },
 { value: 'size-a', label: 'Terkecil' },
];
function onSort(v) { store.sort = v; applyFilters(); }
function toggleSelectMode() { store.selectMode = !store.selectMode; if (!store.selectMode) clearSelection(); }
</script>

<template>
 <div class="flex flex-wrap items-center gap-1.5 py-2 border-b mb-3" :style="{ borderColor: 'var(--border)' }">
 <input ref="fileInput" type="file" multiple hidden @change="onFiles" />
 <button class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-[13px] font-medium bg-[#37352F] text-white hover:bg-[#2F2F2F] dark:bg-[#E9E9E7] dark:text-[#191919] dark:hover:bg-white" @click="fileInput.click()"><Upload :size="14" /> Upload</button>
 <button class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-[13px] border bg-white dark:bg-[#262626] hover:bg-[var(--bg)] dark:hover:bg-[#333]" :style="{ borderColor: 'var(--border)', color: 'var(--text)' }" @click="onUrl"><Link2 :size="14" /> URL</button>
 <button class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-[13px] border bg-white dark:bg-[#262626] hover:bg-[var(--bg)] lg:hidden" :style="{ borderColor: 'var(--border)', color: 'var(--text-dim)' }" @click="emit('toggle-folders')"><FolderPlus :size="14" /></button>
 <button class="inline-flex items-center justify-center w-8 h-8 rounded-[6px] border bg-white dark:bg-[#262626] hover:bg-[var(--bg)]" :style="{ borderColor: 'var(--border)', color: 'var(--text)' }" @click="loadFiles" title="Refresh"><RefreshCw :size="14" /></button>

 <div class="flex items-center gap-1 ml-1">
 <button v-for="t in [{v:'all',l:'All'},{v:'image',l:'Image'},{v:'video',l:'Video'},{v:'doc',l:'Doc'},{v:'archive',l:'Archive'}]" :key="t.v" class="px-2 py-1 rounded-full text-[11px] font-medium border" :style="store.filterType===t.v ? { background: 'var(--text)', color: '#fff', borderColor: 'var(--text)' } : { background: 'var(--card)', color: 'var(--text-dim)', borderColor: 'var(--border)' }" @click="store.filterType=t.v; applyFilters();">{{t.l}}</button>
 </div>

 <div class="h-5 w-px mx-1" :style="{ background: 'var(--border)' }"></div>

 <button class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-[13px] border" :class="store.selectMode ? 'bg-[#2383E214] border-[#2383E240] text-[#2383E2]' : 'bg-white dark:bg-[#262626] hover:bg-[var(--bg)]'" :style="store.selectMode ? {} : { borderColor: 'var(--border)', color: 'var(--text)' }" @click="toggleSelectMode"><CheckSquare :size="14" /> Pilih</button>
 <button class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-[13px] border bg-white dark:bg-[#262626] hover:bg-[var(--bg)] disabled:opacity-40 disabled:cursor-not-allowed" :style="{ borderColor: 'var(--border)', color: 'var(--text)' }" :disabled="selCount === 0" @click="onZip"><Archive :size="14" /> ZIP ({{ selCount }})</button>
 <button class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-[13px] border bg-white dark:bg-[#262626] hover:bg-[var(--bg)] disabled:opacity-40" :style="{ borderColor: 'var(--border)', color: 'var(--text)' }" :disabled="selCount === 0" @click="emit('move', [...store.selected])"><FolderInput :size="14" /> Pindah</button>
 <button class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-[13px] border bg-[#FFF1F1] dark:bg-[#2A1F1F] text-[#E03E3E] border-[#FFD0D0] dark:border-[#5A2E2E] hover:bg-[#FFE4E4] disabled:opacity-40" :disabled="selCount === 0" @click="onDeleteMulti"><Trash2 :size="14" /> Hapus</button>

 <div class="ml-auto flex items-center gap-1.5">
 <button class="w-7 h-7 rounded-[6px] border inline-flex items-center justify-center bg-white dark:bg-[#262626] hover:bg-[var(--bg)]" :style="{ borderColor: 'var(--border)', color: 'var(--text-dim)' }" :title="store.view === 'grid' ? 'Tampilan tabel' : 'Tampilan kartu'" @click="toggleView">
 <LayoutGrid v-if="store.view !== 'grid'" :size="14" /><List v-else :size="14" />
 </button>
 <div class="relative">
 <input v-model="store.search" class="w-[200px] sm:w-[240px] pl-7 pr-3 py-1.5 rounded-[6px] border bg-[var(--bg)] dark:bg-[#1F1F1F] text-[13px] outline-none focus:bg-white dark:focus:bg-[#262626] focus:border-[#2383E2]" :style="{ borderColor: 'var(--border)', color: 'var(--text)' }" type="search" placeholder="Search…" @input="store.page = 0; applyFilters()" />
 <span class="absolute left-2 top-1/2 -translate-y-1/2 opacity-40 pointer-events-none">🔍</span>
 </div>
 <SelectRadix :model-value="store.sort" :options="sortOptions" title="Urutkan" @update:model-value="onSort" />
 </div>
 </div>
</template>
