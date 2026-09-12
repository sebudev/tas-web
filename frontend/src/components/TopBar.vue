<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { store } from '../store';
import { fmtBytes } from '../store';
import { apiPost } from '../composables/useApi';
import { KeyRound, Moon, Sun, LayoutDashboard, LogOut, Settings } from '@lucide/vue';
import BotDialog from './BotDialog.vue';
import AppDialog from './AppDialog.vue';
import DashboardModal from './DashboardModal.vue';

const router = useRouter();
const showBotDlg = ref(false);
const showAppDlg = ref(false);
const showDash = ref(false);
const isLight = computed(() => document.documentElement.dataset.theme === 'light');

function toggleTheme() {
 const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
 document.documentElement.dataset.theme = next;
 localStorage.setItem('tasTheme', next);
}
async function logout() { await apiPost('/api/logout'); router.replace('/login'); }
</script>

<template>
 <header class="h-[45px] shrink-0 flex items-center gap-1.5 px-3 border-b bg-white dark:bg-[#191919]" :style="{ borderColor: 'var(--border)' }">
 <div class="hidden sm:flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full border bg-[var(--bg)] dark:bg-[#1F1F1F]" :style="{ borderColor: 'var(--border)', color: 'var(--text-dim)' }">
 <span class="w-1.5 h-1.5 rounded-full bg-[#2383E2] animate-pulse"></span>
 {{ store.stats?.fileCount || 0 }} file · {{ fmtBytes(store.stats?.totalSize) }}
 </div>

 <div class="ml-auto flex items-center gap-1">
 <button class="w-7 h-7 rounded-[6px] inline-flex items-center justify-center border bg-white dark:bg-[#262626] hover:bg-[var(--bg)] dark:hover:bg-[#333]" :style="{ borderColor: 'var(--border)', color: 'var(--text)' }" title="API tokens" @click="router.push('/api')"><KeyRound :size="14" /></button>
 <button class="w-7 h-7 rounded-[6px] inline-flex items-center justify-center border bg-white dark:bg-[#262626] hover:bg-[var(--bg)] dark:hover:bg-[#333]" :style="{ borderColor: 'var(--border)', color: 'var(--text)' }" title="Model AI settings" @click="router.push('/settings')"><Settings :size="14" /></button>
 <button class="w-7 h-7 rounded-[6px] inline-flex items-center justify-center border bg-white dark:bg-[#262626] hover:bg-[var(--bg)]" :style="{ borderColor: 'var(--border)', color: 'var(--text)' }" title="Ganti tema" @click="toggleTheme"><Moon v-if="isLight" :size="14" /><Sun v-else :size="14" /></button>
 <button class="w-7 h-7 rounded-[6px] inline-flex items-center justify-center border bg-white dark:bg-[#262626] hover:bg-[var(--bg)]" :style="{ borderColor: 'var(--border)', color: 'var(--text)' }" title="Dashboard" @click="showDash = true"><LayoutDashboard :size="14" /></button>
 <span class="hidden sm:inline text-[12px] font-medium px-2" :style="{ color: 'var(--text)' }">{{ store.user ? '@' + store.user.username : '' }}</span>
 <button class="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-[6px] border bg-white dark:bg-[#262626] hover:bg-[var(--bg)] dark:hover:bg-[#333]" :style="{ borderColor: 'var(--border)', color: 'var(--text-dim)' }" @click="logout"><LogOut :size="12" /> Keluar</button>
 </div>
 </header>

 <BotDialog v-if="showBotDlg" @close="showBotDlg = false" />
 <AppDialog v-if="showAppDlg" @close="showAppDlg = false" />
 <DashboardModal v-if="showDash" @close="showDash = false" />
</template>
