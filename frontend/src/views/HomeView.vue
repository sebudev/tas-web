<script setup>
import { ref, computed, onMounted } from 'vue';
import { store, PAGE_SIZE } from '../store';
import { loadFiles, loadStatus, loadProfiles, loadApps, loadFolders, pageItems, totalPages, folderPath, folderChildren, folderById, openFolder, createFolder, clearSelection } from '../composables/useApp';
import { toast } from '../composables/useToast';
import { promptDialog } from '../composables/usePrompt';
import TopBar from '../components/TopBar.vue';
import Toolbar from '../components/Toolbar.vue';
import DropZone from '../components/DropZone.vue';
import JobsPanel from '../components/JobsPanel.vue';
import FileGrid from '../components/FileGrid.vue';
import FileTable from '../components/FileTable.vue';
import PreviewModal from '../components/PreviewModal.vue';
import FolderSidebar from '../components/FolderSidebar.vue';
import MoveDialog from '../components/MoveDialog.vue';

const showPreview = ref(false);
const showMove = ref(false);
const moveHashes = ref([]);
const showSidebar = ref(false);

const breadcrumb = computed(() => (store.currentFolder ? folderPath(store.currentFolder) : []));
const subfolders = computed(() => (store.currentFolder ? folderChildren(store.currentFolder) : []));

async function init() {
  await loadProfiles();
  await loadApps();
  await Promise.all([loadFolders(), loadFiles(), loadStatus()]);
}
onMounted(init);

// idx dari FileGrid/FileTable = index di HALAMAN ini (pageItems) —
// konversi ke index store.filtered biar preview & nav tidak salah file
function openPreview(idx) {
  store.current = store.page * PAGE_SIZE + idx;
  showPreview.value = true;
}

function pageUp() { if (store.page < totalPages.value - 1) store.page++; }
function pageDown() { if (store.page > 0) store.page--; }

function onMove(hashes) {
  moveHashes.value = hashes;
  showMove.value = true;
}
function onCloseMove() {
  showMove.value = false;
  clearSelection();
}

async function onNewFolder() {
  const name = await promptDialog({
    title: '📁 Folder baru',
    placeholder: 'Nama folder',
    okText: 'Buat',
  });
  if (!name) return;
  try {
    await createFolder(name, null);
    toast('📁 Folder "' + name + '" dibuat', 'ok');
  } catch (e) { toast('Gagal: ' + e.message, 'err'); }
}

async function doZip(ids) {
  toast('Menyiapkan ZIP ' + ids.length + ' file...', 'running');
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
}
</script>

<template>
  <div>
    <TopBar />
    <main class="px-3 md:px-6 py-5 max-w-[1600px] mx-auto">
      <div class="flex gap-4 items-start">
        <!-- backdrop mobile -->
        <div v-if="showSidebar" class="fixed inset-0 bg-black/60 z-[110] lg:hidden" @click="showSidebar = false"></div>

        <!-- sidebar folder -->
        <aside
          class="bg-card border border-line rounded-xl2 p-3 shrink-0 w-[220px] max-h-[calc(100vh-120px)] overflow-y-auto transition-transform"
          :class="showSidebar ? 'fixed left-2 top-2 bottom-2 z-[120] rounded-xl2 flex flex-col' : 'hidden lg:flex lg:flex-col sticky top-4'"
        >
          <div class="flex items-center justify-between mb-2">
            <span class="text-[11px] uppercase tracking-wide text-txt-dim font-semibold">📁 Folder</span>
            <div class="flex items-center gap-1">
              <button class="w-6 h-6 flex items-center justify-center rounded text-[12px] text-txt-dim hover:text-accent hover:bg-bg-2" title="Folder baru" @click="onNewFolder">➕</button>
              <button class="w-6 h-6 flex items-center justify-center rounded text-[12px] text-txt-dim hover:text-accent hover:bg-bg-2 lg:hidden" title="Tutup" @click="showSidebar = false">✕</button>
            </div>
          </div>

          <button
            class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[13px] text-left mb-1"
            :class="!store.currentFolder ? 'bg-accent/15 text-txt font-semibold' : 'text-txt-dim hover:text-txt hover:bg-bg-2'"
            @click="openFolder(null)"
          >🗂️ Semua File</button>

          <FolderSidebar />
        </aside>

        <div class="flex-1 min-w-0">
          <!-- breadcrumb -->
          <div v-if="breadcrumb.length" class="flex items-center gap-1.5 text-[13px] mt-2 mb-1 flex-wrap">
            <button class="text-txt-dim hover:text-accent" @click="openFolder(null)">🗂️ Semua File</button>
            <template v-for="(f, i) in breadcrumb" :key="f.id">
              <span class="text-txt-dim">/</span>
              <button
                class="hover:text-accent"
                :class="i === breadcrumb.length - 1 ? 'text-txt font-semibold' : 'text-txt-dim'"
                @click="openFolder(f.id)"
              >{{ f.name }}</button>
            </template>
          </div>

          <!-- subfolder chips -->
          <div v-if="subfolders.length" class="flex flex-wrap gap-2 mt-3">
            <button
              v-for="sf in subfolders"
              :key="sf.id"
              class="bg-bg-2 border border-line rounded-xl px-3 py-2 text-[13px] flex items-center gap-1.5 hover:border-accent hover:text-accent transition-colors"
              @click="openFolder(sf.id)"
            >
              <span>📁</span> {{ sf.name }}
              <span v-if="sf.fileCount" class="text-[10.5px] text-txt-dim">{{ sf.fileCount }}</span>
            </button>
            <button
              class="bg-bg-2 border border-dashed border-line rounded-xl px-3 py-2 text-[13px] text-txt-dim hover:border-accent hover:text-accent transition-colors"
              title="Subfolder baru"
              @click="onNewFolder"
            >➕ Subfolder</button>
          </div>

          <Toolbar @zip="doZip" @move="onMove" @toggle-folders="showSidebar = !showSidebar" />

          <DropZone />
          <JobsPanel />

          <div v-if="store.stats && !store.stats.initialized" class="bg-card border border-line rounded-xl2 p-7 text-center text-txt-dim text-sm mt-7">
            ⚠️ TAS belum di-initialize.<br><br>
            Jalankan di server: <code class="bg-black/10 border border-line rounded-md px-2 py-0.5 text-xs">docker exec -it tas-web tas init</code>
          </div>

          <div v-if="store.loading" class="text-center py-14 text-txt-dim text-[15px]">Memuat file...</div>
          <div v-else-if="!store.filtered.length" class="text-center py-14 text-txt-dim text-[15px]">
            {{ store.currentFolder ? 'Folder ini kosong. Upload file atau pindahkan file ke sini 📁' : 'Belum ada file. Upload file pertama kamu! 🚀' }}
          </div>

          <template v-else>
            <FileGrid v-if="store.view === 'grid'" :items="pageItems" @open="openPreview" />
            <FileTable v-else :items="pageItems" @open="openPreview" />

            <div v-if="store.filtered.length > 24" class="flex items-center justify-center gap-3.5 my-5 text-txt-dim text-[13px]">
              <button class="bg-bg-2 border border-line rounded-lg px-3 py-1.5 text-txt disabled:opacity-40" :disabled="store.page === 0" @click="pageDown">‹ Prev</button>
              <span>Halaman {{ store.page + 1 }} / {{ totalPages }} · {{ store.filtered.length }} file</span>
              <button class="bg-bg-2 border border-line rounded-lg px-3 py-1.5 text-txt disabled:opacity-40" :disabled="store.page >= totalPages - 1" @click="pageUp">Next ›</button>
            </div>
          </template>
        </div>
      </div>
    </main>

    <PreviewModal v-if="showPreview && store.current >= 0" @close="showPreview = false" />
    <MoveDialog v-if="showMove" :hashes="moveHashes" @close="onCloseMove" />
  </div>
</template>
