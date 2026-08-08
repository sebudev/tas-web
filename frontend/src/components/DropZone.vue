<script setup>
import { ref } from 'vue';
import { enqueueUploads } from '../composables/useApp';

const fileInput = ref(null);
const over = ref(false);

function onDrop(e) {
  over.value = false;
  if (e.dataTransfer.files.length) enqueueUploads([...e.dataTransfer.files]);
}
function onFiles(e) {
  if (e.target.files.length) enqueueUploads([...e.target.files]);
  e.target.value = '';
}
</script>

<template>
  <input ref="fileInput" type="file" multiple hidden @change="onFiles" />
  <div
    class="border-2 border-dashed border-line rounded-xl2 py-6 text-center text-txt-dim text-[13px] mb-1.5 cursor-pointer transition-colors"
    :class="over ? 'border-accent text-txt bg-white/5' : 'hover:border-accent hover:text-txt'"
    @click="fileInput.click()"
    @dragover.prevent="over = true"
    @dragleave="over = false"
    @drop.prevent="onDrop"
  >
    📁 Tarik &amp; lepas file di sini, atau klik untuk upload (bisa banyak sekaligus) — dienkripsi AES-256-GCM ke Telegram
  </div>
</template>
