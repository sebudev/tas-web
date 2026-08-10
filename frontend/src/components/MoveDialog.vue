<script setup>
import { ref, computed } from 'vue';
import { store } from '../store';
import { folderChildren, folderById, moveFiles } from '../composables/useApp';
import { toast } from '../composables/useToast';

const props = defineProps({
  hashes: { type: Array, default: () => [] },
});
const emit = defineEmits(['close']);

const selectedId = ref(null);
const busy = ref(false);

// daftar semua folder, diindent berdasarkan kedalaman (tanpa expand/collapse)
const folderList = computed(() => {
  const out = [];
  const walk = (parentId, depth) => {
    for (const f of folderChildren(parentId)) {
      out.push({ ...f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
});

async function onMove() {
  busy.value = true;
  try {
    await moveFiles(props.hashes, selectedId.value);
    const target = selectedId.value ? folderById(selectedId.value) : null;
    toast('📁 ' + props.hashes.length + ' file dipindah ke ' + (target ? '"' + target.name + '"' : 'Semua File'), 'ok');
    emit('close');
  } catch (e) {
    toast('Gagal pindah: ' + e.message, 'err');
  }
  busy.value = false;
}
</script>

<template>
  <div class="fixed inset-0 z-[150]">
    <div class="modal-backdrop" @click="emit('close')"></div>
    <div class="fixed inset-0 z-[100] flex items-center justify-center p-5 pointer-events-none">
      <div class="pointer-events-auto w-full max-w-[400px] bg-card border border-line rounded-xl2 p-5 shadow-2xl max-h-[80vh] flex flex-col">
        <h3 class="text-[15px] mb-3 flex items-center gap-2">
          <span>📁</span> Pindahkan {{ hashes.length }} file ke...
        </h3>

        <div class="overflow-y-auto flex-1 min-h-[120px] border border-line rounded-xl bg-bg-2 p-1.5 flex flex-col gap-[3px]">
          <button
            class="flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] text-left"
            :class="selectedId === null ? 'bg-accent/15 text-txt font-semibold' : 'text-txt-dim hover:text-txt hover:bg-bg'"
            @click="selectedId = null"
          >
            <span>🗂️</span> Semua File (root)
          </button>
          <button
            v-for="f in folderList"
            :key="f.id"
            class="flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] text-left"
            :style="{ paddingLeft: (f.depth * 16 + 10) + 'px' }"
            :class="selectedId === f.id ? 'bg-accent/15 text-txt font-semibold' : 'text-txt-dim hover:text-txt hover:bg-bg'"
            @click="selectedId = f.id"
          >
            <span>📁</span>
            <span class="truncate">{{ f.name }}</span>
            <span v-if="f.fileCount" class="ml-auto shrink-0 text-[10.5px] bg-black/10 border border-line rounded-full px-1.5 py-px">{{ f.fileCount }}</span>
          </button>
          <div v-if="!folderList.length" class="text-center text-[12px] text-txt-dim py-6">
            Belum ada folder — buat dulu lewat sidebar 📁
          </div>
        </div>

        <div class="flex gap-2.5 justify-end mt-4">
          <button
            class="px-4 py-2.5 rounded-[10px] text-[13px] font-semibold border border-line text-txt bg-transparent hover:border-accent hover:text-accent transition-colors"
            @click="emit('close')"
          >Batal</button>
          <button
            class="px-4 py-2.5 rounded-[10px] text-[13px] font-semibold text-white bg-accent hover:brightness-115 transition-all disabled:opacity-50"
            :disabled="busy"
            @click="onMove"
          >{{ busy ? 'Memindahkan...' : 'Pindahkan' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
