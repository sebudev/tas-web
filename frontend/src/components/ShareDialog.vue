<script setup>
import { ref } from 'vue';
import { createShare } from '../composables/useApp';
import { toast } from '../composables/useToast';
import { useEscape } from '../composables/useEscape';
import { X, Share2 } from '@lucide/vue';

const props = defineProps({ file: { type: Object, required: true } });
const emit = defineEmits(['close']);
useEscape(() => emit('close'));

const expire = ref(24);
const maxDl = ref(1);
const shareUrl = ref('');
const busy = ref(false);

async function create() {
 busy.value = true;
 try {
 const data = await createShare(props.file, expire.value, maxDl.value);
 shareUrl.value = location.origin + data.url;
 navigator.clipboard?.writeText(shareUrl.value).catch(() => {});
 toast('Link share dibuat & disalin', 'ok');
 } catch (e) { toast('Gagal: ' + e.message, 'err'); }
 busy.value = false;
}
</script>

<template>
 <div class="modal-backdrop" @click="emit('close')"></div>
 <div class="fixed inset-0 z-[110] flex items-center justify-center p-5 pointer-events-none">
 <div v-focus-trap role="dialog" aria-modal="true" aria-label="Buat share link" class="pointer-events-auto w-full max-w-[380px] bg-card border border-line rounded-xl2 p-5 relative">
 <h3 class="text-[15px] font-semibold mb-1 flex items-center gap-2" :style="{ color: 'var(--text)' }"><Share2 :size="16" class="shrink-0" /> Share link</h3>
 <div class="text-xs text-txt-dim mb-2">File: <span class="text-txt">{{ file.filename }}</span></div>

 <div class="flex gap-2 mb-2.5">
 <div class="flex-1">
 <div class="text-xs text-txt-dim mb-1">Kadaluarsa (jam)</div>
 <input v-model.number="expire" type="number" min="1" max="720" class="input" />
 </div>
 <div class="flex-1">
 <div class="text-xs text-txt-dim mb-1">Max download</div>
 <input v-model.number="maxDl" type="number" min="1" max="100" class="input" />
 </div>
 </div>

 <button class="btn-primary w-full justify-center py-2.5 disabled:opacity-50" :disabled="busy" @click="create">{{ busy ? 'Membuat…' : 'Buat Link' }}</button>

 <div v-if="shareUrl" class="mt-2 bg-[var(--bg)] border border-line rounded-[6px] px-2.5 py-2 text-xs break-all select-all" :style="{ color: 'var(--text)' }">{{ shareUrl }}</div>

 <button class="dialog-close" @click="emit('close')" aria-label="Tutup"><X :size="16" /></button>
 </div>
 </div>
</template>
