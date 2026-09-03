<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { store, PAGE_SIZE } from '../store';
import { loadFiles, loadStatus, loadProfiles, loadApps, loadFolders, pageItems, totalPages, folderPath, folderChildren, openFolder, createFolder, clearSelection, toggleSelect, moveFiles, deleteFiles, selectAllFiltered } from '../composables/useApp';
import { toast } from '../composables/useToast';
import { promptDialog } from '../composables/usePrompt';
import TopBar from '../components/TopBar.vue';
import Toolbar from '../components/Toolbar.vue';
import DropZone from '../components/DropZone.vue';
import JobsPanel from '../components/JobsPanel.vue';
import FileGrid from '../components/FileGrid.vue';
import FileTable from '../components/FileTable.vue';
import PreviewModal from '../components/PreviewModal.vue';
import MoveDialog from '../components/MoveDialog.vue';
import ExplorerSidebar from '../components/ExplorerSidebar.vue';
import Breadcrumb from '../components/Breadcrumb.vue';
import DetailsPane from '../components/DetailsPane.vue';
import ContextMenu from '../components/ContextMenu.vue';
import { Folder } from '@lucide/vue';
import FileSkeleton from '../components/ui/FileSkeleton.vue';
import DropOverlay from '../components/DropOverlay.vue';
import CommandPalette from '../components/CommandPalette.vue';

const showPreview = ref(false);
const showMove = ref(false);
const moveHashes = ref([]);
const sidebarCollapsed = ref(false);
const showMobileSidebar = ref(false);

const detailsFile = computed(() => {
 if (store.selected.size === 1) {
 const h = [...store.selected][0];
 return store.filtered.find(f => f.hash === h) || store.files.find(f => f.hash === h) || null;
 }
 return null;
});
const showDetails = ref(true);

const ctx = ref({ visible: false, x: 0, y: 0, file: null });
const ctxItems = computed(() => [
 { key: 'preview', icon: 'Eye', label: 'Preview' },
 { key: 'download', icon: 'Download', label: 'Download' },
 { key: 'copy', icon: 'Copy', label: 'Copy hash' },
 { key: 'share', icon: 'Share2', label: 'Share link' },
 { key: 'move', icon: 'FolderInput', label: 'Move to...' },
 { key: 'info', icon: 'Info', label: 'Details' },
 { key: 'delete', icon: 'Trash2', label: 'Delete', danger: true },
]);

const breadcrumb = computed(() => (store.currentFolder ? folderPath(store.currentFolder) : []));
const subfolders = computed(() => (store.currentFolder ? folderChildren(store.currentFolder) : []));

async function init() {
 await loadProfiles();
 await loadApps();
 await Promise.all([loadFolders(), loadFiles(), loadStatus()]);
}
function onGlobalKey(e) {
 if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
 e.preventDefault();
 selectAllFiltered();
 }
 if (e.key === 'Escape' && store.selected.size) clearSelection();
}
onMounted(() => {
 init();
 window.addEventListener('keydown', onGlobalKey);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKey));

function openPreview(idx) {
 store.current = store.page * PAGE_SIZE + idx;
 showPreview.value = true;
}
function pageUp() { if (store.page < totalPages.value - 1) store.page++; }
function pageDown() { if (store.page > 0) store.page--; }

function onMove(hashes) { moveHashes.value = hashes; showMove.value = true; }
function onCloseMove() { showMove.value = false; clearSelection(); }

async function onNewFolder() {
 const name = await promptDialog({ title: 'Folder baru', placeholder: 'Nama folder', okText: 'Buat' });
 if (!name) return;
 try { await createFolder(name, store.currentFolder || null); toast('Folder "' + name + '" dibuat', 'ok'); }
 catch (e) { toast('Gagal: ' + e.message, 'err'); }
}
async function doZip(ids) {
 toast('Menyiapkan ZIP ' + ids.length + ' file...', 'running');
 try {
 const res = await fetch('/api/zip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
 if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || 'Gagal ZIP'); }
 const blob = await res.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tas-' + Date.now() + '.zip'; a.click(); URL.revokeObjectURL(a.href); toast('ZIP siap', 'ok');
 } catch (e) { toast('Gagal: ' + e.message, 'err'); }
}

function onFileContext({ file, x, y }) {
 ctx.value = { visible: true, x: Math.min(x, window.innerWidth - 200), y: Math.min(y, window.innerHeight - 200), file };
}
function onCtxAction(key) {
 const f = ctx.value.file; if (!f) return;
 if (key === 'preview') { const idx = pageItems.value.findIndex(p => p.hash === f.hash); if (idx >= 0) openPreview(idx); }
 if (key === 'download') window.location.href = '/api/download/' + encodeURIComponent(f.hash) + (f.profileId ? `?profileId=${f.profileId}` : '');
 if (key === 'share') { const idx = pageItems.value.findIndex(p => p.hash === f.hash); if (idx >= 0) { store.current = store.page * PAGE_SIZE + idx; showPreview.value = true; } }
 if (key === 'copy') { navigator.clipboard.writeText(f.hash); toast('Hash disalin', 'ok'); }
 if (key === 'move') onMove([f.hash]);
 if (key === 'info') { store.selected.clear(); store.selected.add(f.hash); showDetails.value = true; }
 if (key === 'delete') doDelete([f.hash]);
 ctx.value.visible = false;
}
async function doDelete(hashes) {
 const ok = await deleteFiles(hashes); clearSelection(); toast('' + ok + '/' + hashes.length + ' dihapus', ok === hashes.length ? 'ok' : 'err'); loadFiles();
}
function onDetailsDelete(file) { doDelete([file.hash]); }
function onDetailsMove(file) { onMove([file.hash]); }
function onDetailsDownload(file) { window.location.href = '/api/download/' + encodeURIComponent(file.hash) + (file.profileId ? `?profileId=${file.profileId}` : ''); }
function onDetailsShare(file) { const idx = store.filtered.findIndex(p => p.hash === file.hash); if (idx >= 0) { store.current = idx; showPreview.value = true; } }
</script>

<template>
 <div class="h-screen flex flex-col overflow-hidden" :style="{ background: 'var(--bg)' }">
 <DropOverlay />
 <CommandPalette />
 <div v-if="showMobileSidebar" class="fixed inset-0 bg-black/40 z-[40] lg:hidden" @click="showMobileSidebar = false"></div>

 <div class="flex flex-1 min-h-0">
 <ExplorerSidebar
 :collapsed="sidebarCollapsed"
 class="hidden lg:flex"
 @toggle="sidebarCollapsed = !sidebarCollapsed"
 @new-folder="onNewFolder"
 @open-folder="openFolder"
 />
 <div v-if="showMobileSidebar" class="fixed left-0 top-0 bottom-0 w-[280px] z-[45] lg:hidden shadow-xl overflow-hidden" :style="{ background: 'var(--bg)' }">
 <ExplorerSidebar :collapsed="false" @toggle="showMobileSidebar = false" @new-folder="onNewFolder" />
 </div>

 <div class="flex-1 min-w-0 flex flex-col bg-white dark:bg-[#191919] min-h-0">
 <TopBar />

 <div class="flex flex-1 min-h-0">
 <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
 <div class="px-3 py-2 border-b flex items-center gap-2" :style="{ borderColor: 'var(--border)', background: 'var(--bg)' }">
 <button class="lg:hidden w-7 h-7 rounded border flex items-center justify-center" :style="{ borderColor: 'var(--border)', background: 'var(--card)', color: 'var(--text)' }" @click="showMobileSidebar = true">Menu</button>
 <Breadcrumb class="flex-1 min-w-0" />
 <button
 v-if="detailsFile"
 class="hidden sm:flex items-center gap-1 text-[12px] px-2 py-1 rounded border bg-white dark:bg-[#262626] hover:bg-[var(--bg)]"
 :style="{ borderColor: 'var(--border)', color: 'var(--text)' }"
 @click="showDetails = !showDetails"
 :title="showDetails ? 'Hide details' : 'Show details'"
 >{{ showDetails ? '◧ Hide' : '◨ Details' }}</button>
 </div>

 <div class="flex-1 overflow-y-auto px-3 sm:px-4 py-3">
 <div v-if="subfolders.length" class="flex flex-wrap gap-2 mb-3">
 <button
 v-for="sf in subfolders"
 :key="sf.id"
 class="group flex items-center gap-2 px-3 py-2 rounded-[6px] border bg-white dark:bg-[#262626] hover:border-[#2383E2] hover:bg-[#2383E20D] transition-colors"
 :style="{ borderColor: 'var(--border)' }"
 @click="openFolder(sf.id)"
 @contextmenu.prevent="ctx = { visible: true, x: $event.clientX, y: $event.clientY, file: null }"
 >
 <span class="text-[16px]"><Folder :size="14" /></span>
 <span class="text-[13px] font-medium" :style="{ color: 'var(--text)' }">{{ sf.name }}</span>
 <span v-if="sf.fileCount" class="text-[11px] px-1.5 py-0.5 rounded-full" :style="{ background: 'var(--bg)', color: 'var(--text-dim)', border: '1px solid var(--border)' }">{{ sf.fileCount }}</span>
 </button>
 <button
 class="flex items-center gap-1.5 px-3 py-2 rounded-[6px] border border-dashed bg-[var(--bg)]/50 dark:bg-[#1F1F1F] hover:border-[#2383E2] hover:text-[#2383E2]"
 :style="{ borderColor: 'var(--border)', color: 'var(--text-dim)' }"
 @click="onNewFolder"
 >New Folder</button>
 </div>

 <Toolbar @zip="doZip" @move="onMove" @toggle-folders="showMobileSidebar = !showMobileSidebar" />
 <DropZone />
 <JobsPanel />

 <div v-if="store.stats && !store.stats.initialized" class="rounded-[6px] border p-6 text-center text-sm mt-4" :style="{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text-dim)' }">
 TAS belum di-initialize.<br><br>
 Jalankan di server: <code class="px-2 py-1 rounded border text-xs font-mono" :style="{ background: 'var(--bg)', borderColor: 'var(--border)' }">docker exec -it tas-web tas init</code>
 </div>

 <FileSkeleton v-if="store.loading" />
 <div v-else-if="!store.filtered.length" class="text-center py-12 rounded-[8px] border-2 border-dashed bg-[var(--bg)]/40 dark:bg-[#1F1F1F] px-6" :style="{ borderColor: 'var(--border)' }">
 <div class="w-14 h-14 rounded-[12px] bg-white dark:bg-[#262626] border flex items-center justify-center mx-auto text-[24px] shadow-sm" :style="{ borderColor: 'var(--border)' }"></div>
 <div class="text-[14px] font-semibold mt-3" :style="{ color: 'var(--text)' }">{{ store.currentFolder ? 'Folder ini kosong' : 'Belum ada file' }}</div>
 <div class="text-[12px] mt-1 max-w-[360px] mx-auto" :style="{ color: 'var(--text-dim)' }">{{ store.currentFolder ? 'Upload file atau pindahkan file ke sini. Drag & drop dari desktop juga bisa.' : 'Upload file pertama kamu! Drag & drop atau klik Upload. File terenkripsi & tersimpan di Telegram.' }}</div>
 <div class="mt-4 flex items-center justify-center gap-2">
 <button class="text-[12px] px-3 py-1.5 rounded-[6px] bg-[var(--text)] text-white hover:bg-[#2F2F2F] dark:bg-[var(--border)] dark:text-[#191919]" @click="document.querySelector('input[type=file]')?.click()">⬆ Upload file</button>
 <button v-if="store.currentFolder" class="text-[12px] px-3 py-1.5 rounded-[6px] border bg-white dark:bg-[#262626] hover:bg-[var(--bg)]" :style="{ borderColor: 'var(--border)', color: 'var(--text)' }" @click="openFolder(null)">← Semua File</button>
 </div>
 <div class="mt-3 text-[11px]" :style="{ color: '#9B9A97' }">Tip: tekan <kbd class="px-1 py-0.5 rounded border bg-white text-[10px]">⌘K</kbd> untuk search, <kbd class="px-1 py-0.5 rounded border bg-white text-[10px]">Ctrl+A</kbd> pilih semua, <kbd class="px-1 py-0.5 rounded border bg-white text-[10px]">Shift+klik</kbd> range select</div>
 </div>

 <template v-else>
 <FileGrid v-if="store.view === 'grid'" :items="pageItems" @open="openPreview" @context="onFileContext" />
 <FileTable v-else :items="pageItems" @open="openPreview" @context="onFileContext" />

 <div v-if="store.filtered.length > 24" class="flex items-center justify-center gap-3 mt-6 text-[13px]" :style="{ color: 'var(--text-dim)' }">
 <button class="px-3 py-1.5 rounded-[6px] border bg-white dark:bg-[#262626] disabled:opacity-40" :style="{ borderColor: 'var(--border)' }" :disabled="store.page === 0" @click="pageDown">< Prev</button>
 <span>Halaman {{ store.page + 1 }} / {{ totalPages }} · {{ store.filtered.length }} file</span>
 <button class="px-3 py-1.5 rounded-[6px] border bg-white dark:bg-[#262626] disabled:opacity-40" :style="{ borderColor: 'var(--border)' }" :disabled="store.page >= totalPages - 1" @click="pageUp">Next ></button>
 </div>
 </template>
 </div>
 </div>

 <div v-if="showDetails && detailsFile" class="fixed inset-0 z-30 lg:static lg:inset-auto flex justify-end pointer-events-none">
 <div class="absolute inset-0 bg-black/20 backdrop-blur-[1px] lg:hidden pointer-events-auto" @click="store.selected.clear()"></div>
 <div class="relative pointer-events-auto h-full shadow-xl lg:shadow-none border-l bg-white dark:bg-[#1F1F1F] flex flex-col w-[360px] max-w-[85vw] lg:w-[320px] shrink-0" :style="{ borderColor: 'var(--border)' }">
 <DetailsPane
 :file="detailsFile"
 @close="store.selected.clear()"
 @download="onDetailsDownload"
 @share="onDetailsShare"
 @move="onDetailsMove"
 @delete="onDetailsDelete"
 />
 </div>
 </div>
 </div>
 </div>
 </div>

 <PreviewModal v-if="showPreview && store.current >= 0" @close="showPreview = false" />
 <MoveDialog v-if="showMove" :hashes="moveHashes" @close="onCloseMove" />
 <ContextMenu :visible="ctx.visible" :x="ctx.x" :y="ctx.y" :items="ctxItems" @action="onCtxAction" @close="ctx.visible = false" />
 </div>
</template>
