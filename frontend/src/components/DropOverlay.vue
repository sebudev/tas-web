<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { Upload, FilePlus2 } from '@lucide/vue';
import { enqueueUploads } from '../composables/useApp';

const dragging = ref(false);
let counter = 0;

function onDragEnter(e) { e.preventDefault(); counter++; dragging.value = true; }
function onDragOver(e) { e.preventDefault(); }
function onDragLeave(e) { e.preventDefault(); counter--; if (counter<=0) dragging.value = false; }
function onDrop(e) {
 e.preventDefault(); dragging.value = false; counter = 0;
 const files = [...(e.dataTransfer?.files || [])];
 if (files.length) enqueueUploads(files);
}

onMounted(() => {
 window.addEventListener('dragenter', onDragEnter);
 window.addEventListener('dragover', onDragOver);
 window.addEventListener('dragleave', onDragLeave);
 window.addEventListener('drop', onDrop);
});
onBeforeUnmount(() => {
 window.removeEventListener('dragenter', onDragEnter);
 window.removeEventListener('dragover', onDragOver);
 window.removeEventListener('dragleave', onDragLeave);
 window.removeEventListener('drop', onDrop);
});
</script>

<template>
 <Transition name="fade">
 <div v-if="dragging" class="fixed inset-0 z-[70] flex items-center justify-center p-6 pointer-events-none">
 <div class="absolute inset-0 bg-[rgba(35,131,226,0.08)] backdrop-blur-[2px] border-2 border-dashed border-[#2383E2] rounded-[12px] m-3"></div>
 <div class="relative bg-white dark:bg-[#1F1F1F] border rounded-[12px] shadow-xl px-8 py-6 flex flex-col items-center gap-3 pointer-events-auto" :style="{ borderColor: '#2383E2' }">
 <div class="w-12 h-12 rounded-[10px] bg-[#2383E214] flex items-center justify-center text-[#2383E2]"><Upload :size="24" /></div>
 <div class="text-[16px] font-semibold" :style="{ color: 'var(--text)' }">Drop files here</div>
 <div class="text-[12px]" :style="{ color: 'var(--text-dim)' }">Lepaskan untuk upload ke {{ 'folder saat ini' }}</div>
 <div class="text-[11px] px-2 py-1 rounded-full border bg-[#F7F7F5]" :style="{ borderColor: 'var(--border)', color: 'var(--text-dim)' }"><FilePlus2 :size="12" class="inline mr-1" /> Telegram Storage</div>
 </div>
 </div>
 </Transition>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity .15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
