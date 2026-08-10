<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { store, fmtDateTime } from '../store';
import { apiGet, apiPost, apiDelete } from '../composables/useApi';
import { loadProfiles, loadApps, switchApp, currentAppBots } from '../composables/useApp';
import { toast } from '../composables/useToast';
import { confirmDialog } from '../composables/useConfirm';
import SelectMenu from '../components/SelectMenu.vue';

const router = useRouter();
const tokens = ref([]);
const tokName = ref('');
const newToken = ref('');
const copiedId = ref(null);
const botTarget = ref(null);
// S3
const s3Creds = ref([]);
const s3BotTarget = ref(null);
const s3New = ref(null); // kredensial yang baru dibuat (tampil sekali)
const s3ShowSecret = ref({});

const appBots = computed(() => currentAppBots());
const selApp = computed(() => store.apps.find((a) => a.id === store.currentApp));
const locationOrigin = location.origin;

const appOptions = computed(() => store.apps.map((a) => ({
  value: a.id,
  label: `📦 ${a.name} (${a.botCount || 0})`,
})));
const botOpts = computed(() => appBots.value.map((p) => ({
  value: p.id,
  label: `${p.initialized ? '🤖' : '📦'} ${p.name}${p.botUsername ? ' (@' + p.botUsername + ')' : ''}`,
})));

async function loadTokens() {
  try {
    const q = store.currentApp ? `?appId=${store.currentApp}` : '';
    const data = await apiGet('/api/tokens' + q);
    tokens.value = data.tokens || [];
  } catch { /* ignore */ }
}

async function onSwitchApp(v) {
  if (v) {
    await switchApp(Number(v));
    botTarget.value = null;
    loadTokens();
  }
}

async function copyText(text) {
  // clipboard API hanya jalan di secure context (https/localhost)
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* lanjut fallback */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* ignore */ }
  ta.remove();
  return ok;
}

async function create() {
  const profileId = botTarget.value;
  if (!profileId) return toast('Pilih bot target dulu', 'err');
  try {
    const data = await apiPost('/api/tokens', {
      appId: store.currentApp || null,
      profileId,
      name: tokName.value,
    });
    newToken.value = data.token;
    await copyText(data.token);
    toast('Token dibuat & disalin!', 'ok');
    tokName.value = '';
    loadTokens();
  } catch (e) { toast('Gagal: ' + e.message, 'err'); }
}

async function copyToken(t) {
  const ok = await copyText(t.token);
  if (!ok) return toast('Gagal menyalin (blokir browser)', 'err');
  copiedId.value = t.id;
  setTimeout(() => { if (copiedId.value === t.id) copiedId.value = null; }, 1500);
  toast('Token disalin!', 'ok');
}

async function del(id) {
  const ok = await confirmDialog({
    title: 'Hapus token?',
    message: 'Hapus token ini sepenuhnya?\n\nService yang memakainya langsung tidak bisa akses API (401).',
    confirmText: 'Hapus Token',
  });
  if (!ok) return;
  try {
    await apiDelete('/api/tokens/' + id);
    toast('Token dihapus', 'ok');
    loadTokens();
  } catch (e) { toast('Gagal: ' + e.message, 'err'); }
}

// ---------- S3 gateway credentials ----------
async function loadS3() {
  try {
    const data = await apiGet('/api/s3');
    s3Creds.value = data.creds || [];
  } catch { /* ignore */ }
}

async function createS3() {
  const pid = s3BotTarget.value;
  if (!pid) return toast('Pilih bot dulu', 'err');
  try {
    const data = await apiPost('/api/s3/creds', { profileId: pid });
    s3New.value = data;
    await copyText(data.secretKey);
    toast('Kredensial S3 dibuat & secret disalin!', 'ok');
    loadS3();
  } catch (e) { toast('Gagal: ' + e.message, 'err'); }
}

async function delS3(id) {
  const ok = await confirmDialog({
    title: 'Hapus kredensial S3?',
    message: 'Hapus kredensial ini?\n\nKlien S3 yang memakainya langsung tidak bisa akses (403).',
    confirmText: 'Hapus',
  });
  if (!ok) return;
  try {
    await apiDelete('/api/s3/creds/' + id);
    if (s3New.value && s3New.value.id === id) s3New.value = null;
    toast('Kredensial dihapus', 'ok');
    loadS3();
  } catch (e) { toast('Gagal: ' + e.message, 'err'); }
}

function rcloneConfig(c) {
  return `[tas-${c.profile_name || 'bot'}]
type = s3
provider = Other
endpoint = ${location.origin}/s3
access_key = ${c.access_key}
secret_key = ${c.secret_key}
force_path_style = true`;
}

function s3Bucket(c) {
  // bucket dihitung server; tampilkan dari data creds kalau ada, else "bot-<id>"
  return c.bucket || ('bot-' + c.profile_id);
}

onMounted(async () => {
  await Promise.all([loadProfiles(), loadApps()]);
  if (!botTarget.value && appBots.value.length) botTarget.value = appBots.value[0].id;
  if (!s3BotTarget.value && appBots.value.length) s3BotTarget.value = appBots.value[0].id;
  loadTokens();
  loadS3();
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
        <SelectMenu
          :model-value="store.currentApp"
          :options="appOptions"
          placeholder="Pilih app"
          title="Pilih app"
          @update:model-value="onSwitchApp"
        />
        <SelectMenu v-model="botTarget" :options="botOpts" placeholder="Pilih bot target" title="Bot target token" />
        <input v-model="tokName" class="flex-1 min-w-[140px] px-3.5 py-2.5 rounded-[10px] border border-line bg-bg-2 text-txt text-[13px] outline-none focus:border-accent" placeholder="Nama token (mis. xbook-web)" />
        <button class="btn" @click="create">➕ Buat Token</button>
      </div>

      <div v-if="newToken" class="bg-emerald-500/10 border border-emerald-500/50 text-emerald-500 rounded-[10px] p-3 text-[12.5px] break-all font-mono">
        ✅ Token baru (disalin ke clipboard):<br><b>{{ newToken }}</b>
      </div>

      <div class="bg-card border border-line rounded-xl2 p-4 mt-3.5">
        <h3 class="text-sm mb-3">🔑 API keys — app: <b>{{ selApp?.name || '—' }}</b></h3>
        <div v-if="!tokens.length" class="text-txt-dim text-[13px] py-2">Belum ada API key di app ini. Buat di atas 👆</div>
        <div v-for="t in tokens" :key="t.id" class="py-2.5 border-b border-line last:border-0 flex flex-col sm:flex-row sm:items-center gap-2">
          <button
            @click="copyToken(t)"
            :title="'Klik untuk salin token'"
            class="font-mono text-xs bg-bg-2 border border-line rounded-lg px-2.5 py-1.5 text-txt-dim break-all text-left cursor-pointer hover:border-accent hover:text-txt transition-colors shrink-0 sm:max-w-[320px]"
            :class="{ 'border-emerald-500 text-emerald-500': copiedId === t.id }"
          >
            {{ copiedId === t.id ? '✓ Disalin' : (t.active ? '🟢' : '⚪') + ' ' + t.token }}
          </button>
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-[13px]">{{ t.name }} <span v-if="!t.active" class="text-red-500">(revoked)</span></div>
            <div class="text-[11px] text-txt-dim">Bot: {{ t.profile_name || '—' }} · App: {{ t.app_name || '—' }} · dibuat {{ fmtDateTime(t.created_at) }} · terakhir dipakai {{ t.last_used_at ? fmtDateTime(t.last_used_at) : '—' }}</div>
          </div>
          <button class="text-xs px-2.5 py-1 rounded-lg bg-red-500/10 text-red-500 border border-red-500/40 hover:brightness-125 self-start sm:self-auto" @click="del(t.id)">🗑 Hapus</button>
        </div>
      </div>

      <div class="bg-card border border-line rounded-xl2 p-4 mt-3.5">
        <h3 class="text-sm mb-1">🗄 S3 gateway credentials</h3>
        <div class="text-[11.5px] text-txt-dim mb-3">Akses storage via protokol S3 (rclone / s3cmd / aws cli). 1 bot = 1 bucket. Endpoint: <code class="bg-black/10 border border-line rounded-md px-1.5 py-0.5 text-[11px]">{{ locationOrigin }}/s3</code></div>
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <SelectMenu v-model="s3BotTarget" :options="botOpts" placeholder="Pilih bot" title="Bot utk kredensial S3" />
          <button class="btn" @click="createS3">🔑 Buat Kredensial</button>
        </div>

        <div v-if="s3New" class="bg-emerald-500/10 border border-emerald-500/50 text-emerald-500 rounded-[10px] p-3 text-[12px] mb-3 font-mono break-all">
          ✅ Kredensial baru (secret sudah disalin ke clipboard — simpan sekarang, hanya tampil sekali):<br>
          bucket: <b>{{ s3New.bucket }}</b> · access: <b>{{ s3New.accessKey }}</b> · secret: <b>{{ s3New.secretKey }}</b>
          <pre class="mt-2 bg-black/30 rounded-lg p-2.5 text-[11px] overflow-x-auto">{{ rcloneConfig(s3New) }}</pre>
        </div>

        <div v-if="!s3Creds.length" class="text-txt-dim text-[13px] py-2">Belum ada kredensial S3.</div>
        <div v-for="c in s3Creds" :key="c.id" class="py-2.5 border-b border-line last:border-0 flex flex-col sm:flex-row sm:items-center gap-2">
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-[13px]">🤖 {{ c.profile_name || '—' }} <span class="text-txt-dim font-normal">· bucket <code class="text-[11px] bg-bg-2 border border-line rounded px-1">{{ s3Bucket(c) }}</code></span></div>
            <div class="text-[11px] text-txt-dim font-mono">access: {{ c.access_key }}</div>
          </div>
          <button class="text-xs px-2.5 py-1 rounded-lg bg-bg-2 border border-line text-txt-dim hover:border-accent hover:text-accent self-start sm:self-auto" @click="copyText(c.access_key)">📋 Salin Key</button>
          <button class="text-xs px-2.5 py-1 rounded-lg bg-red-500/10 text-red-500 border border-red-500/40 hover:brightness-125 self-start sm:self-auto" @click="delS3(c.id)">🗑 Hapus</button>
        </div>
      </div>

      <div class="bg-bg-2 border border-line rounded-[10px] p-3.5 text-xs text-txt-dim leading-relaxed mt-3.5">
        <b>📌 Cara pakai untuk integrasi:</b><br>
        Kirim header <code class="bg-black/10 border border-line rounded-md px-1.5 py-0.5 text-[11px]">Authorization: Bearer &lt;token&gt;</code> pada request API.<br>
        API key <b>milik app</b> dan <b>terikat ke bot target</b> yang dipilih saat dibuat — semua operasi (list/upload/download/stream) memakai storage bot itu, tidak peduli bot mana yang sedang aktif di UI.<br><br>
        Contoh: <code class="bg-black/10 border border-line rounded-md px-1.5 py-0.5 text-[11px]">curl -H "Authorization: Bearer ***" http://HOST:PORT/api/files</code><br>
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
