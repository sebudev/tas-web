<script setup>
import { ref } from 'vue';
import { apiPost, apiGet } from '../composables/useApi';
import { toast } from '../composables/useToast';
import { loadProfiles, switchProfile, loadFiles, loadStatus } from '../composables/useApp';

const emit = defineEmits(['close']);
const name = ref('');
const token = ref('');
const pass = ref('');
const progress = ref('');
const progressColor = ref('');
const busy = ref(false);

async function create() {
  if (!token.value.includes(':')) return toast('Token bot tidak valid', 'err');
  if (pass.value.length < 8) return toast('Password minimal 8 karakter', 'err');
  busy.value = true;
  progress.value = 'Membuat profile...';
  try {
    const prof = await apiPost('/api/profiles', { name: name.value });
    progress.value = 'Init: menghubungkan ke Telegram...';
    await apiPost('/api/profiles/' + prof.id + '/init', { token: token.value, password: pass.value });
    let tries = 0;
    const poll = setInterval(async () => {
      tries++;
      try {
        const d = await apiGet('/api/profiles/' + prof.id);
        const st = d.initState || {};
        if (st.status === 'running') {
          progress.value = '⏳ ' + (st.message || '...') +
            (tries > 3 ? '\n📩 Sekarang kirim pesan apa saja ke bot barumu di Telegram!' : '');
        } else if (st.status === 'done') {
          clearInterval(poll);
          progress.value = '✅ ' + (st.message || 'Tersambung');
          await switchProfile(prof.id);
          toast('Bot baru aktif! 🎉', 'ok');
          setTimeout(() => { emit('close'); }, 1000);
        } else if (st.status === 'error') {
          clearInterval(poll);
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
    <div class="pointer-events-auto w-full max-w-[380px] bg-card border border-line rounded-xl2 p-5 relative">
      <h3 class="text-[15px] mb-1">🤖 Tambah Storage Bot</h3>
      <div class="text-xs text-txt-dim mb-2">Buat bot baru dulu di Telegram: pesan <b>@BotFather</b> → <b>/newbot</b> → salin token-nya.</div>

      <label class="block text-xs text-txt-dim mb-1">Nama profile</label>
      <input v-model="name" class="input" placeholder="mis. Bot Cadangan">

      <label class="block text-xs text-txt-dim mb-1">Bot token</label>
      <input v-model="token" type="password" class="input" placeholder="123456:ABC-DEF..." autocomplete="off">

      <label class="block text-xs text-txt-dim mb-1">Password enkripsi (min 8 karakter)</label>
      <input v-model="pass" type="password" class="input" autocomplete="new-password">

      <div class="text-xs text-cyan-400 min-h-[34px] whitespace-pre-line mt-1" :style="{ color: progressColor }">{{ progress }}</div>

      <button class="w-full py-3 rounded-[10px] font-semibold text-white bg-accent hover:brightness-115 disabled:opacity-50" :disabled="busy" @click="create">
        🚀 Buat &amp; Init
      </button>
      <button class="modal-x" @click="emit('close')">✕</button>
    </div>
  </div>
</template>

<style scoped>
.input {
  width: 100%; padding: 10px 12px; margin-bottom: 10px; box-sizing: border-box;
  border-radius: 10px; border: 1px solid var(--border);
  background: var(--bg-2); color: var(--text); font-size: 13px; outline: none;
}
.input:focus { border-color: var(--accent); }
</style>
