<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { store } from '../store';
import { fmtBytes } from '../store';
import { loadProfiles, loadApps, switchApp, selectBot, deleteProfile, currentAppBots, createApp, loadStatus } from '../composables/useApp';
import { apiPost } from '../composables/useApi';
import { toast } from '../composables/useToast';
import { confirmDialog } from '../composables/useConfirm';
import { promptDialog } from '../composables/usePrompt';
import BotDialog from './BotDialog.vue';
import AppDialog from './AppDialog.vue';
import DashboardModal from './DashboardModal.vue';

const router = useRouter();
const showBotDlg = ref(false);
const showAppDlg = ref(false);
const showDash = ref(false);
const themeIcon = computed(() => (document.documentElement.dataset.theme === 'light' ? '🌙' : '☀️'));
const activeProfile = computed(() => store.profiles.find((p) => p.id === store.activeId));
const appBots = computed(() => currentAppBots());

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('tasTheme', next);
}

async function onSwitchApp(e) {
  if (e.target.value) await switchApp(Number(e.target.value));
}

function onSelectBot(e) {
  const v = e.target.value;
  if (v === 'all') selectBot('all');
  else if (v) selectBot(Number(v));
}

async function onNewApp() {
  const name = await promptDialog({
    title: '📦 App baru',
    placeholder: 'Nama app (mis. Produk A)',
    okText: 'Buat',
  });
  if (!name) return;
  try { await createApp(name); toast('📦 App "' + name + '" dibuat', 'ok'); }
  catch (e) { toast('Gagal: ' + e.message, 'err'); }
}

async function onDeleteBot() {
  const p = activeProfile.value;
  if (!p) return;
  const ok = await confirmDialog({
    title: 'Hapus bot?',
    message: `Hapus bot "${p.name}" (@${p.botUsername || '?'})?\n\nFile di Telegram TIDAK dihapus — cuma profile-nya dilepas dari tas-web.`,
    confirmText: 'Hapus Bot',
  });
  if (!ok) return;
  await deleteProfile(p.id);
}

async function logout() {
  await apiPost('/api/logout');
  router.replace('/login');
}
</script>

<template>
  <header class="sticky top-0 z-50 flex flex-wrap items-center gap-2 md:gap-4 px-3 md:px-6 py-3
                 bg-bg/85 backdrop-blur-xl border-b border-line">
    <div class="font-bold text-xl whitespace-nowrap">
      <span class="text-accent-two">✦</span> tas
      <span class="hidden sm:inline text-txt-dim font-normal text-sm">/ telegram storage</span>
    </div>

    <!-- App selector -->
    <select
      class="bg-bg-2 border border-line rounded-[10px] px-2.5 py-2 text-[13px] text-txt outline-none"
      :value="store.currentApp"
      @change="onSwitchApp"
      title="Pilih app"
    >
      <option v-for="a in store.apps" :key="a.id" :value="a.id">📦 {{ a.name }} ({{ a.botCount || 0 }})</option>
    </select>
    <button class="btn-ghost" title="Kelola app (rename, bot, hapus)" @click="showAppDlg = true">⚙️</button>
    <button class="btn-ghost" title="Buat app baru" @click="onNewApp">➕</button>

    <!-- Bot selector (dalam app) -->
    <select
      class="bg-bg-2 border border-line rounded-[10px] px-2.5 py-2 text-[13px] text-txt outline-none"
      :value="store.allBots ? 'all' : store.activeId"
      @change="onSelectBot"
      title="Switch storage bot"
    >
      <option v-if="appBots.length > 1" value="all">{{ store.allBots ? '✓ ' : '' }}🗂 Semua Bot</option>
      <option v-for="p in appBots" :key="p.id" :value="p.id">
        {{ p.initialized ? '🤖' : '📦' }} {{ p.name }}{{ p.botUsername ? ' (@' + p.botUsername + ')' : '' }}{{ !store.allBots && p.id === store.activeId ? ' ✓' : '' }}
      </option>
    </select>
    <button class="btn-ghost" title="Tambah bot" @click="showBotDlg = true">➕</button>
    <button v-if="store.profiles.length > 1 && !store.allBots" class="btn-ghost" title="Hapus bot" @click="onDeleteBot">🗑</button>

    <button class="btn-ghost" title="API tokens" @click="router.push('/api')">🔑</button>
    <button class="btn-ghost" title="Ganti tema" @click="toggleTheme">{{ themeIcon }}</button>
    <button class="btn-ghost" title="Dashboard" @click="showDash = true">📊</button>

    <div class="ml-auto flex items-center gap-2 text-[13px] text-txt-dim whitespace-nowrap flex-wrap">
      <span>{{ store.stats?.fileCount || 0 }} file</span>
      <span class="w-1 h-1 rounded-full bg-accent inline-block"></span>
      <span>{{ fmtBytes(store.stats?.totalSize) }}</span>
      <span class="w-1 h-1 rounded-full bg-accent inline-block"></span>
      <span>{{ store.stats?.savingsPercent || 0 }}% hemat</span>
      <span class="text-accent-two font-semibold">{{ store.user ? '@' + store.user.username : '' }}</span>
      <button class="border border-line rounded-lg px-2.5 py-1 text-xs text-txt-dim hover:text-red-500 hover:border-red-500" @click="logout">keluar</button>
    </div>
  </header>

  <BotDialog v-if="showBotDlg" @close="showBotDlg = false" />
  <AppDialog v-if="showAppDlg" @close="showAppDlg = false" />
  <DashboardModal v-if="showDash" @close="showDash = false" />
</template>

<style scoped>
.btn-ghost {
  background: transparent; border: 1px solid var(--border); color: var(--text);
  border-radius: 8px; padding: 5px 10px; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
</style>
