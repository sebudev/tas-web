<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { store, fmtDateTime } from '../store';
import { apiGet, apiPost, apiDelete } from '../composables/useApi';
import { loadProfiles, loadApps, switchApp, currentAppBots } from '../composables/useApp';
import { toast } from '../composables/useToast';
import { confirmDialog } from '../composables/useConfirm';
import SelectRadix from '../components/ui/SelectRadix.vue';
import { KeyRound, Copy, Check, Trash2, Plus, HardDrive, Link2, FileKey, ArrowLeft, Bot } from '@lucide/vue';

const router = useRouter();
const tokens = ref([]);
const tokName = ref('');
const newToken = ref('');
const copiedId = ref(null);
const botTarget = ref(null);
const s3Creds = ref([]);
const s3BotTarget = ref(null);
const s3New = ref(null);

const appBots = computed(() => currentAppBots());
const selApp = computed(() => store.apps.find((a) => a.id === store.currentApp));
const locationOrigin = location.origin;

const appOptions = computed(() => store.apps.map((a) => ({ value: String(a.id), label: `📦 ${a.name} (${a.botCount || 0})` })));
const botOpts = computed(() => appBots.value.map((p) => ({ value: String(p.id), label: `${p.name}${p.botUsername ? ' (@' + p.botUsername + ')' : ''}` })));

async function loadTokens() {
  try {
    const q = store.currentApp ? `?appId=${store.currentApp}` : '';
    const data = await apiGet('/api/tokens' + q);
    tokens.value = data.tokens || [];
  } catch {}
}
async function onSwitchApp(v) {
  if (v) { await switchApp(Number(v)); botTarget.value = null; loadTokens(); }
}
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch {}
  const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch {}
  ta.remove(); return ok;
}
async function create() {
  const profileId = botTarget.value;
  if (!profileId) return toast('Pilih bot target dulu', 'err');
  try {
    const data = await apiPost('/api/tokens', { appId: store.currentApp || null, profileId: Number(profileId), name: tokName.value });
    newToken.value = data.token;
    await copyText(data.token);
    toast('Token dibuat & disalin!', 'ok');
    tokName.value = '';
    loadTokens();
  } catch (e) { toast('Gagal: ' + e.message, 'err'); }
}
async function copyToken(t) {
  const ok = await copyText(t.token);
  if (!ok) return toast('Gagal menyalin', 'err');
  copiedId.value = t.id;
  setTimeout(() => { if (copiedId.value === t.id) copiedId.value = null; }, 1500);
  toast('Token disalin!', 'ok');
}
async function del(id) {
  const ok = await confirmDialog({ title: 'Hapus token?', message: 'Hapus token ini? Service yang memakainya langsung 401.', confirmText: 'Hapus Token' });
  if (!ok) return;
  try { await apiDelete('/api/tokens/' + id); toast('Token dihapus', 'ok'); loadTokens(); } catch (e) { toast('Gagal: ' + e.message, 'err'); }
}
async function loadS3() {
  try { const data = await apiGet('/api/s3'); s3Creds.value = data.creds || []; } catch {}
}
async function createS3() {
  const pid = s3BotTarget.value;
  if (!pid) return toast('Pilih bot dulu', 'err');
  try {
    const data = await apiPost('/api/s3/creds', { profileId: Number(pid) });
    s3New.value = data;
    await copyText(data.secretKey);
    toast('Kredensial S3 dibuat & secret disalin!', 'ok');
    loadS3();
  } catch (e) { toast('Gagal: ' + e.message, 'err'); }
}
async function delS3(id) {
  const ok = await confirmDialog({ title: 'Hapus kredensial S3?', message: 'Hapus kredensial ini? Klien S3 langsung 403.', confirmText: 'Hapus' });
  if (!ok) return;
  try { await apiDelete('/api/s3/creds/' + id); if (s3New.value && s3New.value.id === id) s3New.value = null; toast('Kredensial dihapus', 'ok'); loadS3(); } catch (e) { toast('Gagal: ' + e.message, 'err'); }
}
function rcloneConfig(c) {
  return `[tas-${c.profile_name || 'bot'}]\ntype = s3\nprovider = Other\nendpoint = ${location.origin}/s3\naccess_key = ${c.access_key}\nsecret_key = ${c.secret_key}\nforce_path_style = true`;
}
function s3Bucket(c) { return c.bucket || ('bot-' + c.profile_id); }

onMounted(async () => {
  await Promise.all([loadProfiles(), loadApps()]);
  if (!botTarget.value && appBots.value.length) botTarget.value = String(appBots.value[0].id);
  if (!s3BotTarget.value && appBots.value.length) s3BotTarget.value = String(appBots.value[0].id);
  loadTokens(); loadS3();
});
</script>

<template>
  <div class="min-h-screen" :style="{ background: 'var(--bg)' }">
    <header class="h-[45px] shrink-0 flex items-center gap-2 px-3 border-b bg-white dark:bg-[#191919] sticky top-0 z-20" :style="{ borderColor: 'var(--border)' }">
      <div class="flex items-center gap-2">
        <span class="w-7 h-7 rounded-[8px] bg-[#37352F] dark:bg-[#E9E9E7] flex items-center justify-center text-white dark:text-[#37352F] text-[12px] font-bold">T</span>
        <span class="font-bold text-[14px]" :style="{ color: 'var(--text)' }">Telegram Storage</span>
        <span class="hidden sm:inline text-[12px] px-1.5 py-0.5 rounded border bg-[var(--bg)]" :style="{ borderColor: 'var(--border)', color: 'var(--text-dim)' }">/ api</span>
      </div>
      <button class="ml-auto inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-[6px] border bg-white dark:bg-[#262626] hover:bg-[var(--bg)]" :style="{ borderColor: 'var(--border)', color: 'var(--text)' }" @click="router.push('/')"><ArrowLeft :size="14" /> Beranda</button>
    </header>

    <main class="max-w-[900px] mx-auto px-3 sm:px-6 py-6 space-y-6">
      <!-- API keys -->
      <div class="rounded-[8px] border bg-white dark:bg-[#1F1F1F] overflow-hidden" :style="{ borderColor: 'var(--border)' }">
        <div class="px-4 py-3 border-b flex items-center gap-2" :style="{ borderColor: 'var(--border)', background: 'var(--bg)' }">
          <div class="w-7 h-7 rounded-[6px] bg-[#37352F] dark:bg-[#E9E9E7] flex items-center justify-center text-white dark:text-[#37352F]"><KeyRound :size="14" /></div>
          <div>
            <div class="text-[13px] font-semibold" :style="{ color: 'var(--text)' }">API keys</div>
            <div class="text-[11px]" :style="{ color: 'var(--text-dim)' }">App: <b :style="{ color: 'var(--text)' }">{{ selApp?.name || '—' }}</b> · {{ tokens.length }} keys</div>
          </div>
        </div>

        <div class="p-4 space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <SelectRadix :model-value="store.currentApp ? String(store.currentApp) : ''" :options="appOptions" placeholder="Pilih app" @update:model-value="onSwitchApp" />
            <SelectRadix v-model="botTarget" :options="botOpts" placeholder="Pilih bot target" />
            <input v-model="tokName" class="flex-1 min-w-[160px] px-3 py-1.5 rounded-[6px] border bg-[var(--bg)] dark:bg-[#1F1F1F] text-[13px] outline-none focus:bg-white dark:focus:bg-[#262626] focus:border-[#2383E2]" :style="{ borderColor: 'var(--border)', color: 'var(--text)' }" placeholder="Nama token (mis. xbook-web)" />
            <button class="btn-primary" @click="create"><Plus :size="14" /> Buat Token</button>
          </div>

          <div v-if="newToken" class="rounded-[6px] border p-3 text-[12px] break-all font-mono flex items-start gap-2" :style="{ background: '#E6F4EA', borderColor: '#A7E0B5', color: '#1A7F37' }">
            <Check :size="14" class="shrink-0 mt-0.5" />
            <div>Token baru (disalin): <b>{{ newToken }}</b></div>
          </div>

          <div v-if="!tokens.length" class="text-center py-8 rounded-[6px] border-2 border-dashed" :style="{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-dim)' }">
            <KeyRound :size="20" class="mx-auto mb-2 opacity-40" />
            <div class="text-[13px] font-medium" :style="{ color: 'var(--text)' }">Belum ada API key</div>
            <div class="text-[12px]">Pilih bot & buat token di atas</div>
          </div>

          <div v-for="t in tokens" :key="t.id" class="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-[6px] border hover:bg-[var(--bg)] transition-colors" :style="{ borderColor: 'var(--border)', background: 'var(--card)' }">
            <button @click="copyToken(t)" :title="'Klik untuk salin token'" class="font-mono text-[11px] border rounded-[6px] px-2.5 py-1.5 break-all text-left flex items-center gap-1.5 shrink-0 sm:max-w-[320px] hover:border-[#2383E2]" :style="{ background: 'var(--bg)', borderColor: copiedId===t.id ? '#2383E2' : 'var(--border)', color: copiedId===t.id ? '#2383E2' : 'var(--text-dim)' }">
              <component :is="copiedId===t.id ? Check : Copy" :size="12" /> {{ copiedId===t.id ? 'Disalin' : t.token.slice(0,16) + '…' }}
            </button>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-[13px] flex items-center gap-1.5" :style="{ color: 'var(--text)' }">{{ t.name }} <span v-if="!t.active" class="text-[11px] px-1.5 py-0.5 rounded bg-[#FFF1F1] text-[#E03E3E] border border-[#FFD0D0]">revoked</span></div>
              <div class="text-[11px] flex flex-wrap items-center gap-1" :style="{ color: 'var(--text-dim)' }"><Bot :size="10" /> {{ t.profile_name || '—' }} · {{ t.app_name || '—' }} · {{ fmtDateTime(t.created_at) }}</div>
            </div>
            <button class="btn-danger self-start sm:self-auto" @click="del(t.id)"><Trash2 :size="14" /> Hapus</button>
          </div>
        </div>
      </div>

      <!-- S3 -->
      <div class="rounded-[8px] border bg-white dark:bg-[#1F1F1F] overflow-hidden" :style="{ borderColor: 'var(--border)' }">
        <div class="px-4 py-3 border-b flex items-center gap-2" :style="{ borderColor: 'var(--border)', background: 'var(--bg)' }">
          <div class="w-7 h-7 rounded-[6px] bg-[#2383E2] flex items-center justify-center text-white"><HardDrive :size="14" /></div>
          <div>
            <div class="text-[13px] font-semibold" :style="{ color: 'var(--text)' }">S3 gateway credentials</div>
            <div class="text-[11px]" :style="{ color: 'var(--text-dim)' }">1 bot = 1 bucket · Endpoint: <code class="px-1 py-0.5 rounded border text-[11px] font-mono" :style="{ background: 'var(--bg)', borderColor: 'var(--border)' }">{{ locationOrigin }}/s3</code></div>
          </div>
        </div>

        <div class="p-4 space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <SelectRadix v-model="s3BotTarget" :options="botOpts" placeholder="Pilih bot" />
            <button class="btn-primary" @click="createS3"><KeyRound :size="14" /> Buat Kredensial</button>
          </div>

          <div v-if="s3New" class="rounded-[6px] border p-3 text-[12px] font-mono break-all" :style="{ background: '#E6F4EA', borderColor: '#A7E0B5', color: '#1A7F37' }">
            <div class="flex items-center gap-1.5 font-semibold"><Check :size="14" /> Kredensial baru (secret disalin — simpan sekarang):</div>
            <div class="mt-1">bucket: <b>{{ s3New.bucket }}</b> · access: <b>{{ s3New.accessKey }}</b> · secret: <b>{{ s3New.secretKey }}</b></div>
            <pre class="mt-2 p-2.5 rounded-[6px] border overflow-x-auto text-[11px]" :style="{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text)' }">{{ rcloneConfig(s3New) }}</pre>
          </div>

          <div v-if="!s3Creds.length" class="text-center py-6 rounded-[6px] border-2 border-dashed" :style="{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-dim)' }">
            <HardDrive :size="20" class="mx-auto mb-2 opacity-40" />
            <div class="text-[13px]">Belum ada kredensial S3</div>
          </div>

          <div v-for="c in s3Creds" :key="c.id" class="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-[6px] border" :style="{ borderColor: 'var(--border)', background: 'var(--card)' }">
            <div class="flex-1 min-w-0">
              <div class="font-medium text-[13px] flex items-center gap-1.5" :style="{ color: 'var(--text)' }"><Bot :size="14" /> {{ c.profile_name || '—' }} <span class="text-[11px] px-1.5 py-0.5 rounded border font-mono" :style="{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text-dim)' }">{{ s3Bucket(c) }}</span></div>
              <div class="text-[11px] font-mono" :style="{ color: 'var(--text-dim)' }">access: {{ c.access_key }}</div>
            </div>
            <button class="btn-secondary self-start sm:self-auto" @click="copyText(c.access_key)"><Copy :size="14" /> Salin Key</button>
            <button class="btn-danger self-start sm:self-auto" @click="delS3(c.id)"><Trash2 :size="14" /> Hapus</button>
          </div>
        </div>
      </div>

      <div class="rounded-[6px] border p-4 text-[12px] leading-relaxed" :style="{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text-dim)' }">
        <div class="font-semibold flex items-center gap-1.5" :style="{ color: 'var(--text)' }"><Link2 :size="14" /> Cara pakai untuk integrasi</div>
        <div class="mt-2">Kirim header <code class="px-1.5 py-0.5 rounded border font-mono text-[11px]" :style="{ background: 'var(--card)', borderColor: 'var(--border)' }">Authorization: Bearer &lt;token&gt;</code> pada request API. API key <b :style="{ color: 'var(--text)' }">milik app</b> dan <b>terikat ke bot target</b> — semua operasi memakai storage bot itu.</div>
        <div class="mt-2 font-mono text-[11px] p-2 rounded border overflow-x-auto" :style="{ background: 'var(--card)', borderColor: 'var(--border)' }">curl -H "Authorization: Bearer ***" {{ locationOrigin }}/api/files</div>
        <div class="mt-1"><code class="px-1 py-0.5 rounded border font-mono text-[11px]" :style="{ background: 'var(--card)', borderColor: 'var(--border)' }">/api/stream</code> dan <code class="px-1 py-0.5 rounded border font-mono text-[11px]" :style="{ background: 'var(--card)', borderColor: 'var(--border)' }">/s/&lt;token&gt;</code> tetap publik (capability URL by hash).</div>
      </div>
    </main>
  </div>
</template>
