<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { store } from '../store';
import { fmtBytes, fmtDate, iconFor, isVideo, isImage } from '../store';
import { apiPost } from '../composables/useApi';
import { loadFiles, createShare } from '../composables/useApp';
import { toast } from '../composables/useToast';
import { confirmDialog } from '../composables/useConfirm';
import ShareDialog from './ShareDialog.vue';

const emit = defineEmits(['close']);
const showShare = ref(false);
const videoRef = ref(null);
const rootRef = ref(null);

onMounted(() => { rootRef.value?.focus(); });

const file = computed(() => store.filtered[store.current] || null);
// di view "Semua Bot" file punya profileId → operasi harus target bot asal
const profileQuery = computed(() => (file.value?.profileId ? `?profileId=${file.value.profileId}` : ''));

function nav(dir) {
  const n = store.filtered.length;
  if (!n) return;
  store.current = (store.current + dir + n) % n;
}
function close() {
  emit('close');
  store.current = -1;
}
async function onDelete() {
  const f = file.value;
  if (!f) return;
  const ok = await confirmDialog({
    title: 'Hapus file?',
    message: `Hapus "${f.filename}" permanen dari Telegram?\n\nFile dihapus dari index DAN pesan chunk di chat bot — tidak bisa dikembalikan.`,
    confirmText: 'Hapus',
  });
  if (!ok) return;
  try {
    await apiPost('/api/delete/' + encodeURIComponent(f.hash) + profileQuery.value);
    toast('File dihapus', 'ok');
    close();
    loadFiles();
  } catch (e) { toast('Gagal hapus: ' + e.message, 'err'); }
}
function onKey(e) {
  if (e.key === 'Escape') close();
  if (e.key === 'ArrowLeft') nav(-1);
  if (e.key === 'ArrowRight') nav(1);
}
watch(() => store.current, () => { if (videoRef.value) videoRef.value.load(); });
onBeforeUnmount(() => { if (videoRef.value) videoRef.value.pause(); });
</script>

<template>
  <div v-if="file" ref="rootRef" class="fixed inset-0 z-[100] outline-none" @keydown="onKey" tabindex="-1">
    <div class="modal-backdrop" @click="close"></div>

    <div class="absolute inset-0 z-[100] flex items-center justify-center flex-col p-2 sm:p-5 pointer-events-none">
      <button class="nav prev pointer-events-auto" @click="nav(-1)">‹</button>

      <div class="pointer-events-auto flex items-center justify-center max-w-[92vw] max-h-[70vh]">
        <video v-if="isVideo(file)" ref="videoRef" :src="'/api/stream/' + encodeURIComponent(file.hash) + profileQuery" controls autoplay class="max-w-[92vw] max-h-[68vh] rounded-[10px] shadow-2xl" />
        <img v-else-if="isImage(file)" :src="'/api/stream/' + encodeURIComponent(file.hash) + profileQuery" class="max-w-[92vw] max-h-[70vh] rounded-[10px] shadow-2xl" />
        <div v-else class="text-[52px] text-center p-8 bg-card rounded-xl2 border border-line">{{ iconFor(file.filename) }}</div>
      </div>

      <button class="nav next pointer-events-auto" @click="nav(1)">›</button>

      <div class="mt-3.5 text-center text-txt-dim text-[13px] max-w-[90vw] pointer-events-auto">
        <span class="font-semibold text-txt">{{ file.filename }}</span>
        <br>{{ fmtBytes(file.original_size) }} · {{ fmtDate(file.created_at) }} · hash {{ (file.hash || '').slice(0, 12) }}…
      </div>

      <div class="mt-3.5 flex gap-2 flex-wrap justify-center pointer-events-auto">
        <a class="btn" :href="'/api/download/' + encodeURIComponent(file.hash) + profileQuery">⬇ Download</a>
        <button class="btn-ghost" @click="showShare = true">🔗 Share</button>
        <button class="btn-danger" @click="onDelete">🗑 Hapus</button>
      </div>
    </div>

    <button class="modal-x" @click="close">✕</button>
    <ShareDialog v-if="showShare" :file="file" @close="showShare = false" />
  </div>
</template>

<style scoped>
.btn {
  background: var(--accent); border: none; color: #fff; font-weight: 600; font-size: 13px;
  padding: 9px 14px; border-radius: 10px; cursor: pointer; white-space: nowrap; text-decoration: none;
}
.btn:hover { filter: brightness(1.15); }
.btn-ghost {
  background: transparent; border: 1px solid var(--border); color: var(--text);
  padding: 9px 14px; border-radius: 10px; font-size: 13px; cursor: pointer;
}
.btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
.btn-danger {
  background: rgba(231,76,60,.12); color: #e74c3c; border: 1px solid rgba(231,76,60,.4);
  padding: 9px 14px; border-radius: 10px; font-size: 13px; cursor: pointer;
}
.btn-danger:hover { filter: brightness(1.2); }
</style>
