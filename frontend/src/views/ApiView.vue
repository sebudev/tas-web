<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { store, fmtDateTime, escapeHtml } from '../store';
import { apiGet, apiPost, apiDelete } from '../composables/useApi';
import { loadProfiles, createToken, revokeToken } from '../composables/useApp';
import { toast } from '../composables/useToast';

const router = useRouter();
const tokens = ref([]);
const tokName = ref('');
const newToken = ref('');

async function loadTokens() {
  try {
    const data = await apiGet('/api/tokens');
    tokens.value = data.tokens || [];
  } catch { /* ignore */ }
}

async function create() {
  const profileId = store.activeId;
  if (!profileId) return toast('Pilih bot dulu', 'err');
  try {
    const data = await createToken(profileId, tokName.value);
    newToken.value = data.token;
    navigator.clipboard?.writeText(data.token).catch(() => {});
    toast('Token dibuat & disalin!', 'ok');
    tokName.value = '';
    loadTokens();
  } catch (e) { toast('Gagal: ' + e.message, 'err'); }
}

async function revoke(id) {
  if (!confirm('Revoke token ini? Service yang memakainya langsung tidak bisa akses API.')) return;
  try {
    await revokeToken(id);
    toast('Token di-revoke', 'ok');
    loadTokens();
  } catch (e) { toast('Gagal: ' + e.message, 'err'); }
}

onMounted(async () => {
  await Promise.all([loadProfiles(), loadTokens()]);
});
</script>

<template>
  <div>
    <header class="sticky top-0 z-50 flex items-center gap-2 md:gap-5 px-3 md:px-6 py-3 bg-bg/85 backdrop-blur-xl border-b border-line">
      <div class="font-bold text-xl whitespace-nowrap"><span class="text-accent-two">✦</span> tas <span class="hidden sm:inline text-txt-dim font-normal text-sm">/ api management</span></div>
      <button class="btn-ghost" @click="router.push('/')">← Beranda</button>
    </header>

    <main class="px-3 md:px-6 py-5 max-w-[1600px] mx-auto">
      <div class="flex flex-wrap items-center gap-2 my-4">
        <select v-model="store.activeId" class="bg-bg-2 border border-line rounded-[10px] px-2.5 py-2.5 text-[13px] text-txt outline-none">
          <option v-for="p in store.profiles" :key="p.id" :value="p.id">
            {{ p.initialized ? '🤖' : '📦' }} {{ p.name }}{{ p.botUsername ? ' (@' + p.botUsername + ')' : '' }}
          </option>
        </select>
        <input v-model="tokName" class="flex-1 min-w-[140px] px-3.5 py-2.5 rounded-[10px] border border-line bg-bg-2 text-txt text-[13px] outline-none focus:border-accent" placeholder="Nama token (mis. xbook-web)" />
        <button class="btn" @click="create">➕ Buat Token</button>
      </div>

      <div v-if="newToken" class="bg-emerald-500/10 border border-emerald-500/50 text-emerald-500 rounded-[10px] p-3 text-[12.5px] break-all font-mono">
        ✅ Token baru (disalin ke clipboard):<br><b>{{ newToken }}</b>
      </div>

      <div class="bg-card border border-line rounded-xl2 p-4 mt-3.5">
        <h3 class="text-sm mb-3">🔑 API tokens per bot</h3>
        <div v-if="!tokens.length" class="text-txt-dim text-[13px] py-2">Belum ada API token. Buat di atas 👆</div>
        <div v-for="t in tokens" :key="t.id" class="flex items-center gap-2.5 py-2.5 border-b border-line last:border-0 flex-wrap">
          <span class="font-mono text-xs bg-bg-2 border border-line rounded-lg px-2.5 py-1 text-txt-dim">{{ t.active ? '🟢' : '⚪' }} {{ t.token }}</span>
          <div class="flex-1 min-w-[140px]">
            <div class="font-semibold text-[13px]">{{ t.name }} <span v-if="!t.active" class="text-red-500">(revoked)</span></div>
            <div class="text-[11px] text-txt-dim">Bot: {{ t.profile_name || '—' }} · dibuat {{ fmtDateTime(t.created_at) }} · terakhir dipakai {{ t.last_used_at ? fmtDateTime(t.last_used_at) : '—' }}</div>
          </div>
          <button v-if="t.active" class="text-xs px-2.5 py-1 rounded-lg bg-red-500/10 text-red-500 border border-red-500/40 hover:brightness-125" @click="revoke(t.id)">Revoke</button>
        </div>
      </div>

      <div class="bg-bg-2 border border-line rounded-[10px] p-3.5 text-xs text-txt-dim leading-relaxed mt-3.5">
        <b>📌 Cara pakai untuk integrasi:</b><br>
        Kirim header <code class="bg-black/10 border border-line rounded-md px-1.5 py-0.5 text-[11px]">Authorization: Bearer &lt;token&gt;</code> pada request API.<br>
        Token ini <b>terikat ke bot tertentu</b> — semua operasi (list/upload/download/stream) otomatis memakai storage bot itu, tidak peduli bot mana yang sedang aktif di UI.<br><br>
        Contoh: <code class="bg-black/10 border border-line rounded-md px-1.5 py-0.5 text-[11px]">curl -H "Authorization: Bearer tas_xxx" http://HOST:PORT/api/files</code><br>
        <code class="bg-black/10 border border-line rounded-md px-1.5 py-0.5 text-[11px]">/api/stream</code> dan <code class="bg-black/10 border border-line rounded-md px-1.5 py-0.5 text-[11px]">/s/&lt;token&gt;</code> tetap publik (capability URL by hash).
      </div>
    </main>
  </div>
</template>

<style scoped>
.btn {
  background: var(--accent); border: none; color: #fff; font-weight: 600; font-size: 13px;
  padding: 9px 14px; border-radius: 10px; cursor: pointer; white-space: nowrap;
}
.btn:hover { filter: brightness(1.15); }
.btn-ghost {
  background: transparent; border: 1px solid var(--border); color: var(--text);
  border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer;
}
.btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
</style>
