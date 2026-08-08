<script setup>
import { ref, onMounted } from 'vue';
import { store } from '../store';
import { loadFiles, loadStatus, loadProfiles, pageItems, totalPages } from '../composables/useApp';
import { toast } from '../composables/useToast';
import TopBar from '../components/TopBar.vue';
import Toolbar from '../components/Toolbar.vue';
import DropZone from '../components/DropZone.vue';
import JobsPanel from '../components/JobsPanel.vue';
import FileGrid from '../components/FileGrid.vue';
import FileTable from '../components/FileTable.vue';
import PreviewModal from '../components/PreviewModal.vue';

const showPreview = ref(false);

async function init() {
  await Promise.all([loadProfiles(), loadFiles(), loadStatus()]);
}
onMounted(init);

function openPreview(idx) { store.current = idx; showPreview.value = true; }

function pageUp() { if (store.page < totalPages.value - 1) store.page++; }
function pageDown() { if (store.page > 0) store.page--; }

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
      <Toolbar @zip="doZip" />

      <DropZone />
      <JobsPanel />

      <div v-if="store.stats && !store.stats.initialized" class="bg-card border border-line rounded-xl2 p-7 text-center text-txt-dim text-sm mt-7">
        ⚠️ TAS belum di-initialize.<br><br>
        Jalankan di server: <code class="bg-black/10 border border-line rounded-md px-2 py-0.5 text-xs">docker exec -it tas-web tas init</code>
      </div>

      <div v-if="store.loading" class="text-center py-14 text-txt-dim text-[15px]">Memuat file...</div>
      <div v-else-if="!store.filtered.length" class="text-center py-14 text-txt-dim text-[15px]">Belum ada file. Upload file pertama kamu! 🚀</div>

      <template v-else>
        <FileGrid v-if="store.view === 'grid'" :items="pageItems" @open="openPreview" />
        <FileTable v-else :items="pageItems" @open="openPreview" />

        <div v-if="store.filtered.length > 24" class="flex items-center justify-center gap-3.5 my-5 text-txt-dim text-[13px]">
          <button class="bg-bg-2 border border-line rounded-lg px-3 py-1.5 text-txt disabled:opacity-40" :disabled="store.page === 0" @click="pageDown">‹ Prev</button>
          <span>Halaman {{ store.page + 1 }} / {{ totalPages }} · {{ store.filtered.length }} file</span>
          <button class="bg-bg-2 border border-line rounded-lg px-3 py-1.5 text-txt disabled:opacity-40" :disabled="store.page >= totalPages - 1" @click="pageUp">Next ›</button>
        </div>
      </template>
    </main>

    <PreviewModal v-if="showPreview && store.current >= 0" @close="showPreview = false" />
  </div>
</template>
