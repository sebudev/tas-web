<script setup>
import { computed } from 'vue';
import { store } from '../store';
import { fmtBytes } from '../store';
import { folderChildren, openFolder, currentAppBots, appById, switchApp, selectBot } from '../composables/useApp';
import { Folder, FolderOpen, Package, Bot, Star, Plus, Trash2, Files } from '@lucide/vue';
import FolderSidebar from './FolderSidebar.vue';

async function onSwitchApp(id) { await switchApp(id); }
async function onSelectBot(id) { await selectBot(id); }

const props = defineProps({ collapsed: Boolean });
const emit = defineEmits(['toggle', 'new-folder', 'open-folder']);

const appBots = computed(() => currentAppBots());
const curApp = computed(() => appById(store.currentApp));
const rootChildren = computed(() => folderChildren(null));

const usagePct = computed(() => {
 const s = store.stats;
 if (!s || !s.totalSize) return 0;
 // tas tidak ada quota, pakai visual saja 0-100 dari totalSize / 2GB sebagai contoh
 return Math.min(100, Math.round((s.totalSize / (2 * 1024 * 1024 * 1024)) * 100));
});
</script>

<template>
 <aside
 class="shrink-0 flex flex-col border-r select-none transition-all duration-200"
 :class="collapsed ? 'w-[56px]' : 'w-[260px]'"
 :style="{ background: 'var(--bg)', borderColor: 'var(--border)' }"
 >
 <!-- header -->
 <div class="h-[45px] flex items-center gap-2 px-3 border-b shrink-0" :style="{ borderColor: 'var(--border)' }">
 <button
 class="w-7 h-7 rounded flex items-center justify-center text-[14px] hover:bg-white dark:hover:bg-[#262626] border border-transparent hover:border-[#E9E9E7] dark:hover:border-[#404040]"
 :style="{ color: 'var(--text)' }"
 title="Toggle sidebar"
 @click="emit('toggle')"
 >{{ collapsed ? '<ChevronRight :size="14" />' : '<Menu :size="14" />' }}</button>
 <div v-if="!collapsed" class="flex items-center gap-1.5 min-w-0">
 <span class="w-6 h-6 rounded bg-[#37352F] dark:bg-[#E9E9E7] flex items-center justify-center text-white dark:text-[#37352F] text-[11px] font-bold">T</span>
 <span class="font-semibold text-[13.5px] truncate" :style="{ color: 'var(--text)' }">Telegram Storage</span>
 </div>
 </div>

 <div v-if="!collapsed" class="flex-1 overflow-y-auto py-3 space-y-5">
 <!-- Quick access -->
 <div class="px-2">
 <div class="text-[11px] font-semibold tracking-wide uppercase px-2 mb-1.5" :style="{ color: 'var(--text-dim)' }">Quick access</div>
 <button
 class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[13px] text-left"
 :style=" !store.currentFolder ? { background: 'var(--bg-2)', color: 'var(--text)', fontWeight: 600 } : { color: 'var(--text-dim)' }"
 :class="!store.currentFolder ? 'dark:!bg-[#2A2A2A] dark:!text-[#F5F5F5]' : 'hover:bg-white dark:hover:bg-[#262626]'"
 @click="openFolder(null)"
 ><span><Files :size="14" /></span> Semua File <span v-if="store.stats" class="ml-auto text-[11px] opacity-60">{{ store.stats.fileCount || 0 }}</span></button>
 <button
 class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[13px] text-left hover:bg-white dark:hover:bg-[#262626]"
 :style="{ color: 'var(--text-dim)' }"
 @click="store.currentFolder = null"
 ><span><Star :size="14" /></span> Favorit <span class="ml-auto text-[10px] opacity-40">soon</span></button>
 </div>

 <!-- Apps -->
 <div class="px-2">
 <div class="flex items-center justify-between px-2 mb-1.5">
 <span class="text-[11px] font-semibold tracking-wide uppercase" :style="{ color: 'var(--text-dim)' }">Apps</span>
 <span class="text-[11px] px-1.5 py-0.5 rounded bg-white dark:bg-[#2A2A2A] border" :style="{ borderColor: 'var(--border)', color: 'var(--text-dim)' }">{{ store.apps.length }}</span>
 </div>
 <div class="space-y-0.5">
 <button
 v-for="a in store.apps"
 :key="a.id"
 class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[13px] text-left truncate"
 :style=" store.currentApp === a.id ? { background: 'var(--text)', color: '#FFFFFF' } : { color: 'var(--text)' }"
 :class="store.currentApp !== a.id ? 'hover:bg-white dark:hover:bg-[#262626]' : 'dark:!bg-[#E9E9E7] dark:!text-[#191919]'"
 :title="a.name"
 @click="onSwitchApp(a.id)"
 >
 <span class="shrink-0"><Package :size="14" /></span>
 <span class="truncate flex-1">{{ a.name }}</span>
 <span class="text-[10px] opacity-60 shrink-0">{{ a.botCount || 0 }} bot</span>
 </button>
 </div>
 <div v-if="curApp" class="mt-2 px-2 py-2 rounded bg-white dark:bg-[#262626] border" :style="{ borderColor: 'var(--border)' }">
 <div class="text-[11px] font-medium" :style="{ color: 'var(--text)' }">{{ curApp.name }}</div>
 <div class="text-[11px]" :style="{ color: 'var(--text-dim)' }">{{ appBots.length }} bot · {{ curApp.bots?.length || 0 }} attached</div>
 </div>
 </div>

 <!-- Bots -->
 <div class="px-2">
 <div class="text-[11px] font-semibold tracking-wide uppercase px-2 mb-1.5" :style="{ color: 'var(--text-dim)' }">Bots</div>
 <div class="space-y-0.5">
 <button
 v-for="p in appBots"
 :key="p.id"
 class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[13px] text-left"
 :style=" store.activeId === p.id && !store.allBots ? { background: '#2383E214', color: '#2383E2', border: '1px solid #2383E240' } : { color: 'var(--text-dim)' }"
 :class="store.activeId !== p.id || store.allBots ? 'hover:bg-white dark:hover:bg-[#262626] border border-transparent' : ''"
 @click="onSelectBot(p.id)"
 >
 <span class="shrink-0">{{ p.initialized ? '<Bot :size="14" />' : '<Bot :size="14" class="opacity-40" />' }}</span>
 <span class="truncate flex-1">{{ p.name }}</span>
 <span v-if="p.botUsername" class="text-[11px] opacity-60 truncate">@{{ p.botUsername }}</span>
 </button>
 <button
 v-if="appBots.length > 1"
 class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[13px] text-left border"
 :style=" store.allBots ? { background: '#2383E214', color: '#2383E2', borderColor: '#2383E240' } : { color: 'var(--text-dim)', borderColor: 'transparent' }"
 :class="!store.allBots ? 'hover:bg-white dark:hover:bg-[#262626]' : ''"
 @click="onSelectBot('all')"
 ><span><Files :size="14" /></span> Semua Bot</button>
 </div>
 </div>

 <!-- Folders tree -->
 <div class="px-2">
 <div class="flex items-center justify-between px-2 mb-1.5">
 <span class="text-[11px] font-semibold tracking-wide uppercase" :style="{ color: 'var(--text-dim)' }">Folders</span>
 <button
 class="w-6 h-6 rounded flex items-center justify-center text-[12px] hover:bg-white dark:hover:bg-[#2A2A2A] border border-transparent hover:border-[#E9E9E7]"
 :style="{ color: 'var(--text-dim)' }"
 title="Folder baru"
 @click="emit('new-folder')"
 ><Plus :size="12" /></button>
 </div>
 <div v-if="!rootChildren.length" class="px-2 py-2 text-[12px] rounded border border-dashed" :style="{ color: 'var(--text-dim)', borderColor: 'var(--border)', background: '#FFFFFF' }">
 Belum ada folder. Klik <Plus :size="12" /> untuk buat.
 </div>
 <FolderSidebar v-else />
 </div>
 </div>

 <!-- collapsed mini -->
 <div v-else class="flex-1 overflow-y-auto py-3 flex flex-col items-center gap-2">
 <button class="w-8 h-8 rounded bg-[#37352F] text-white flex items-center justify-center text-[13px]"><Files :size="14" /></button>
 <button class="w-8 h-8 rounded hover:bg-white dark:hover:bg-[#262626] flex items-center justify-center text-[14px]"><Package :size="14" /></button>
 <button class="w-8 h-8 rounded hover:bg-white dark:hover:bg-[#262626] flex items-center justify-center text-[14px]"><Bot :size="14" /></button>
 <button class="w-8 h-8 rounded hover:bg-white dark:hover:bg-[#262626] flex items-center justify-center text-[14px]"><Folder :size="14" /></button>
 </div>

 <!-- storage footer -->
 <div v-if="!collapsed" class="p-3 border-t shrink-0" :style="{ borderColor: 'var(--border)', background: '#FFFFFF' }">
 <div class="flex items-center justify-between text-[11px] mb-1.5">
 <span :style="{ color: 'var(--text-dim)' }">Storage</span>
 <span class="font-medium" :style="{ color: 'var(--text)' }">{{ fmtBytes(store.stats?.totalSize) }}</span>
 </div>
 <div class="h-1.5 rounded-full overflow-hidden" style="background:#E9E9E7">
 <div class="h-full rounded-full transition-all" :style="{ width: usagePct + '%', background: usagePct > 80 ? '#E03E3E' : '#2383E2' }"></div>
 </div>
 <div class="flex items-center justify-between text-[11px] mt-1.5" :style="{ color: 'var(--text-dim)' }">
 <span>{{ store.stats?.fileCount || 0 }} file</span>
 <span>{{ usagePct }}%</span>
 </div>
 </div>
 </aside>
</template>
