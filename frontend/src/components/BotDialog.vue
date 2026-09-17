<script setup>
import { ref, onBeforeUnmount } from 'vue';
import { apiPost, apiGet } from '../composables/useApi';
import { toast } from '../composables/useToast';
import { store } from '../store';
import { loadProfiles, loadApps, switchProfile, loadFiles, loadStatus } from '../composables/useApp';
import { useEscape } from '../composables/useEscape';
import { X, Bot } from '@lucide/vue';

const emit = defineEmits(['close']);
useEscape(() => { if (!busy.value) emit('close'); });
const name = ref('');
const token = ref('');
const pass = ref('');
const progress = ref('');
const progressColor = ref('');
const busy = ref(false);
let poll = null;
let unmounted = false;
onBeforeUnmount(() => { unmounted = true; if (poll) { clearInterval(poll); poll = null; } });

async function create() {
 if (!token.value.includes(':')) return toast('Token bot tidak valid', 'err');
 if (pass.value.length < 8) return toast('Password minimal 8 karakter', 'err');
 busy.value = true;
 progress.value = 'Membuat profile...';
 try {
 const prof = await apiPost('/api/profiles', { name: name.value, appId: store.currentApp || undefined });
 progress.value = 'Init: menghubungkan ke Telegram...';
 await apiPost('/api/profiles/' + prof.id + '/init', { token: token.value, password: pass.value });
 let tries = 0;
 poll = setInterval(async () => {
 tries++;
 try {
 const d = await apiGet('/api/profiles/' + prof.id);
 const st = d.initState || {};
 if (st.status === 'running') {
 progress.value = '⏳ ' + (st.message || '...') +
 (tries > 3 ? '\n📩 Sekarang kirim pesan apa saja ke bot barumu di Telegram!' : '');
 } else if (st.status === 'done') {
 clearInterval(poll); poll = null;
 progress.value = '✅ ' + (st.message || 'Tersambung');
 await loadApps(); // refresh app (bot baru sudah ter-attach)
 await switchProfile(prof.id);
 toast('Bot baru aktif! 🎉', 'ok');
 setTimeout(() => { if (!unmounted) emit('close'); }, 1000);
 } else if (st.status === 'error') {
 clearInterval(poll); poll = null;
 progressColor.value = 'red';
 progress.value = '❌ ' + (st.message || 'gagal init');
 busy.value = false;
 }
 } catch { /* keep polling */ }
 }, 2500);
 } catch (e) {
 progressColor.value = 'red';
 progress.value = '❌ ' + e.message;
 busy.value = false;
 }
}
</script>

<template>
 <div class="modal-backdrop" @click="emit('close')"></div>
 <div class="fixed inset-0 z-[100] flex items-center justify-center p-5 pointer-events-none">
 <div v-focus-trap role="dialog" aria-modal="true" aria-label="Tambah storage bot" class="pointer-events-auto w-full max-w-[380px] bg-card border border-line rounded-xl2 p-5 relative">
 <h3 class="text-[15px] font-semibold mb-1 flex items-center gap-2" :style="{ color: 'var(--text)' }"><Bot :size="16" class="shrink-0" /> Tambah Storage Bot</h3>
 <div class="text-xs text-txt-dim mb-2">Buat bot baru dulu di Telegram: pesan <b>@BotFather</b> &gt; <b>/newbot</b> &gt; salin token-nya.</div>

 <label class="block text-xs text-txt-dim mb-1">Nama profile</label>
 <input v-model="name" class="input mb-2.5" placeholder="mis. Bot Cadangan">

 <label class="block text-xs text-txt-dim mb-1">Bot token</label>
 <input v-model="token" type="password" class="input mb-2.5" placeholder="123456:ABC-DEF..." autocomplete="off">

 <label class="block text-xs text-txt-dim mb-1">Password enkripsi (min 8 karakter)</label>
 <input v-model="pass" type="password" class="input mb-2.5" autocomplete="new-password">

 <div class="text-xs min-h-[34px] whitespace-pre-line mt-1" :style="{ color: progressColor || 'var(--text-dim)' }">{{ progress }}</div>

 <button class="btn-primary w-full justify-center py-2.5 disabled:opacity-50" :disabled="busy" @click="create">
 {{ busy ? 'Memproses…' : 'Buat & Init' }}
 </button>
 <button class="dialog-close" @click="emit('close')" aria-label="Tutup"><X :size="16" /></button>
 </div>
 </div>
</template>
