<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent } from 'radix-vue';
import { Search, Folder, FileText, LayoutDashboard, Upload, Settings, Bot } from '@lucide/vue';
import { store } from '../store';
import { openFolder, applyFilters } from '../composables/useApp';

const router = useRouter();
const open = ref(false);
const query = ref('');
const active = ref(0); // item terpilih utk navigasi keyboard

const filteredFiles = computed(() => {
 const q = query.value.toLowerCase().trim();
 if (!q) return store.files.slice(0, 8);
 return store.files.filter(f => (f.filename || '').toLowerCase().includes(q)).slice(0, 8);
});
const filteredFolders = computed(() => {
 const q = query.value.toLowerCase().trim();
 if (!q) return store.folders.slice(0, 5);
 return store.folders.filter(f => f.name.toLowerCase().includes(q)).slice(0, 5);
});
// daftar gabungan (folder dulu, lalu file) supaya ↑↓ pindah antar-semua hasil
const results = computed(() => [
 ...filteredFolders.value.map((f) => ({ type: 'folder', ref: f })),
 ...filteredFiles.value.map((f) => ({ type: 'file', ref: f })),
]);
watch([query, open], () => { active.value = 0; });

function choose(item) {
 if (!item) return;
 if (item.type === 'folder') selectFolder(item.ref);
 else selectFile(item.ref);
}
function onKey(e) {
 if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open.value = !open.value; return; }
 if (e.key === '/' && !open.value && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); open.value = true; return; }
 if (!open.value || !results.value.length) return;
 if (e.key === 'ArrowDown') { e.preventDefault(); active.value = Math.min(active.value + 1, results.value.length - 1); }
 else if (e.key === 'ArrowUp') { e.preventDefault(); active.value = Math.max(active.value - 1, 0); }
 else if (e.key === 'Enter') { e.preventDefault(); choose(results.value[active.value]); }
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

function selectFile(f) { open.value = false; query.value = ''; store.search = f.filename || ''; store.page = 0; applyFilters(); }
function selectFolder(f) { open.value = false; query.value = ''; openFolder(f.id); }
function actionUpload() { open.value = false; document.querySelector('input[type=\"file\"]')?.click(); }
function actionDashboard() { open.value = false; document.querySelector('[title=\"Dashboard\"]')?.click(); }
</script>

<template>
 <DialogRoot :open="open" @update:open="(v) => open = v">
 <DialogPortal>
 <DialogOverlay class="fixed inset-0 z-[80] bg-[rgba(55,53,47,0.24)] backdrop-blur-[1px]" />
 <DialogContent class="fixed left-1/2 top-[22%] -translate-x-1/2 z-[81] w-[560px] max-w-[92vw] bg-white dark:bg-[#1F1F1F] border rounded-[10px] shadow-xl overflow-hidden flex flex-col max-h-[68vh]" :style="{ borderColor: 'var(--border)' }">
 <div class="flex items-center gap-2 px-3 py-2 border-b" :style="{ borderColor: 'var(--border)', background: 'var(--bg)' }">
 <Search :size="16" class="opacity-40 shrink-0" />
 <input v-model="query" placeholder="Cari file & folder…" class="flex-1 bg-transparent outline-none text-[13px] placeholder:text-[#9B9A97]" :style="{ color: 'var(--text)' }" autofocus />
 <span class="text-[11px] px-1.5 py-0.5 rounded border bg-white dark:bg-[#262626]" :style="{ borderColor: 'var(--border)', color: 'var(--text-dim)' }">ESC</span>
 </div>

 <div class="flex-1 overflow-y-auto p-1.5 space-y-3">
 <!-- quick actions -->
 <div>
 <div class="text-[11px] font-semibold tracking-wide uppercase px-2 py-1" :style="{ color: 'var(--text-dim)' }">Actions</div>
 <button class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-[13px] hover:bg-[#F7F7F5] dark:hover:bg-[#262626] text-left" @click="actionUpload"><Upload :size="14" /> Upload file</button>
 <button class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-[13px] hover:bg-[#F7F7F5] dark:hover:bg-[#262626] text-left" @click="actionDashboard"><LayoutDashboard :size="14" /> Open dashboard</button>
 <button class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-[13px] hover:bg-[#F7F7F5] dark:hover:bg-[#262626] text-left" @click="open=false; router.push('/api')"><Settings :size="14" /> API tokens</button>
 <button class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-[13px] hover:bg-[#F7F7F5] dark:hover:bg-[#262626] text-left" @click="open=false; router.push('/settings')"><Bot :size="14" /> Model AI settings</button>
 </div>

 <div v-if="filteredFolders.length">
 <div class="text-[11px] font-semibold tracking-wide uppercase px-2 py-1" :style="{ color: 'var(--text-dim)' }">Folders · {{ filteredFolders.length }}</div>
 <button v-for="(f, i) in filteredFolders" :key="f.id" class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-[13px] text-left" :class="active === i ? 'bg-[#F7F7F5] dark:bg-[#333]' : 'hover:bg-[#F7F7F5] dark:hover:bg-[#262626]'" @mouseenter="active = i" @click="selectFolder(f)"><Folder :size="14" class="text-[#706F6C]" /> {{ f.name }}</button>
 </div>

 <div v-if="filteredFiles.length">
 <div class="text-[11px] font-semibold tracking-wide uppercase px-2 py-1" :style="{ color: 'var(--text-dim)' }">Files · {{ filteredFiles.length }}</div>
 <button v-for="(f, i) in filteredFiles" :key="f.hash" class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-[13px] text-left truncate" :class="active === filteredFolders.length + i ? 'bg-[#F7F7F5] dark:bg-[#333]' : 'hover:bg-[#F7F7F5] dark:hover:bg-[#262626]'" @mouseenter="active = filteredFolders.length + i" @click="selectFile(f)"><FileText :size="14" class="opacity-60 shrink-0" /> <span class="truncate">{{ f.filename || f.hash }}</span><span class="ml-auto text-[11px] opacity-50 shrink-0">{{ f.profileName || '' }}</span></button>
 </div>

 <div v-if="!filteredFiles.length && !filteredFolders.length" class="text-center py-6 text-[13px]" :style="{ color: 'var(--text-dim)' }">No results for “{{ query }}”</div>
 </div>

 <div class="px-3 py-2 border-t flex items-center gap-2 text-[11px]" :style="{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-dim)' }">
 <span><kbd class="px-1 py-0.5 rounded border bg-white">↑↓</kbd> navigate</span>
 <span><kbd class="px-1 py-0.5 rounded border bg-white">↵</kbd> select</span>
 <span class="ml-auto">⌘K to toggle</span>
 </div>
 </DialogContent>
 </DialogPortal>
 </DialogRoot>
</template>
