<script setup>
import { computed, ref } from 'vue';
import { store, fmtBytes, fmtDate } from '../store';
import { folderById } from '../composables/useApp';
import { Download, Share2, FolderInput, Trash2, Link2, Copy, Clock, Tag, Film, Image as ImageIcon, Package, Folder, Bot } from '@lucide/vue';
import { toast } from '../composables/useToast';

const props = defineProps({ file: Object });
const emit = defineEmits(['close', 'download', 'share', 'move', 'delete']);
const tab = ref('info'); // info | share | activity

const folder = computed(() => {
 const fid = store.fileFolder[props.file.hash];
 return fid ? folderById(fid) : null;
});
function copyLink() {
 const url = `${location.origin}/#/`;
 navigator.clipboard.writeText(props.file.hash);
 toast('Hash disalin', 'ok');
}
function copyHash() {
 navigator.clipboard.writeText(props.file.hash);
 toast('Hash disalin', 'ok');
}
</script>

<template>
 <aside class="flex-1 flex flex-col overflow-hidden w-full" :style="{ background: '#FFFFFF' }">
 <div class="h-[45px] flex items-center justify-between px-3 border-b shrink-0" :style="{ borderColor: 'var(--border)', background: 'var(--bg)' }">
 <div class="flex rounded-full border p-1 gap-1 bg-white dark:bg-[#262626]" :style="{ borderColor: 'var(--border)' }">
 <button class="px-2.5 py-1 rounded-full text-[11px] font-medium" :style="tab==='info' ? { background: 'var(--text)', color: '#fff' } : { color: 'var(--text-dim)' }" @click="tab='info'">Info</button>
 <button class="px-2.5 py-1 rounded-full text-[11px] font-medium" :style="tab==='share' ? { background: 'var(--text)', color: '#fff' } : { color: 'var(--text-dim)' }" @click="tab='share'">Share</button>
 <button class="px-2.5 py-1 rounded-full text-[11px] font-medium" :style="tab==='activity' ? { background: 'var(--text)', color: '#fff' } : { color: 'var(--text-dim)' }" @click="tab='activity'">Activity</button>
 </div>
 <button class="w-6 h-6 rounded hover:bg-white dark:hover:bg-[#262626] flex items-center justify-center text-[12px]" :style="{ color: 'var(--text-dim)' }" @click="emit('close')">X</button>
 </div>

 <div class="flex-1 overflow-y-auto p-4 space-y-4">
 <div v-if="tab==='info'">
 <div class="rounded border overflow-hidden flex items-center justify-center bg-[var(--bg)] dark:bg-[#1F1F1F] mb-4" :style="{ borderColor: 'var(--border)', minHeight: '140px' }">
 <component :is="file.filename?.endsWith('.mp4') ? Film : file.filename?.match(/\.(jpg|png|webp|jpeg)$/i) ? ImageIcon : Package" :size="32" class="opacity-60" :style="{ color: 'var(--text-dim)' }" />
 </div>

 <div class="font-semibold text-[13px] break-all" :style="{ color: 'var(--text)' }">{{ file.filename || file.hash }}</div>
 <div class="text-[11px] mt-1 font-mono break-all flex items-center gap-1" :style="{ color: 'var(--text-dim)' }">
 <span class="truncate">{{ file.hash }}</span>
 <button class="shrink-0 w-6 h-6 rounded hover:bg-[#F7F7F5] flex items-center justify-center" @click="copyHash" title="Copy hash"><Copy :size="12" /></button>
 </div>

 <div class="grid grid-cols-2 gap-2 text-[12px] mt-4">
 <div class="rounded border p-2.5 bg-[#F7F7F5]/50 dark:bg-[#1F1F1F]" :style="{ borderColor: 'var(--border)' }">
 <div :style="{ color: 'var(--text-dim)' }" class="text-[11px] uppercase tracking-wide flex items-center gap-1"><Tag :size="10" /> Ukuran</div>
 <div :style="{ color: 'var(--text)' }" class="font-medium">{{ fmtBytes(file.original_size) }}</div>
 </div>
 <div class="rounded border p-2.5 bg-[#F7F7F5]/50 dark:bg-[#1F1F1F]" :style="{ borderColor: 'var(--border)' }">
 <div :style="{ color: 'var(--text-dim)' }" class="text-[11px] uppercase tracking-wide flex items-center gap-1"><Clock :size="10" /> Tanggal</div>
 <div :style="{ color: 'var(--text)' }" class="font-medium text-[11px]">{{ fmtDate(file.created_at) }}</div>
 </div>
 <div class="rounded border p-2.5 bg-[var(--bg)]/50 dark:bg-[#1F1F1F] col-span-2" :style="{ borderColor: 'var(--border)' }">
 <div :style="{ color: 'var(--text-dim)' }" class="text-[11px] uppercase tracking-wide">Lokasi</div>
 <div :style="{ color: 'var(--text)' }" class="font-medium flex items-center gap-1.5">
 <span class="inline-flex items-center gap-1"><Folder :size="12" /> {{ folder ? folder.name : 'Semua File' }}</span>
 <span v-if="file.profileName" class="text-[11px] opacity-60 inline-flex items-center gap-1"><Bot :size="12" /> {{ file.profileName }}</span>
 </div>
 </div>
 </div>

 <div v-if="file.tags && file.tags.length" class="flex flex-wrap gap-1 mt-3">
 <span v-for="t in file.tags" :key="t" class="text-[11px] px-2 py-1 rounded-full border bg-white dark:bg-[#262626]" :style="{ borderColor: 'var(--border)', color: 'var(--text-dim)' }">#{{ t }}</span>
 </div>

 <div class="space-y-2 mt-4">
 <button class="w-full py-2 rounded-[6px] font-medium text-[13px] bg-[#37352F] text-white hover:bg-[#2F2F2F] dark:bg-[#E9E9E7] dark:text-[#191919] dark:hover:bg-white inline-flex items-center justify-center gap-1.5" @click="emit('download', file)"><Download :size="14" /> Download</button>
 <div class="grid grid-cols-3 gap-2">
 <button class="py-2 rounded-[6px] border bg-white dark:bg-[#262626] text-[12px] hover:bg-[#F7F7F5] dark:hover:bg-[#333] inline-flex items-center justify-center gap-1" :style="{ borderColor: 'var(--border)', color: 'var(--text)' }" @click="emit('share', file)"><Share2 :size="12" /> Share</button>
 <button class="py-2 rounded-[6px] border bg-white dark:bg-[#262626] text-[12px] hover:bg-[#F7F7F5] inline-flex items-center justify-center gap-1" :style="{ borderColor: 'var(--border)', color: 'var(--text)' }" @click="emit('move', file)"><FolderInput :size="12" /> Move</button>
 <button class="py-2 rounded-[6px] border bg-[#FFF1F1] dark:bg-[#3A2222] text-[12px] border-[#FFD0D0] dark:border-[#5A2E2E] text-[#E03E3E] hover:bg-[#FFE4E4] inline-flex items-center justify-center gap-1" @click="emit('delete', file)"><Trash2 :size="12" /> Delete</button>
 </div>
 <button class="w-full py-1.5 rounded-[6px] border bg-white dark:bg-[#262626] text-[12px] hover:bg-[#F7F7F5] inline-flex items-center justify-center gap-1" :style="{ borderColor: 'var(--border)', color: 'var(--text-dim)' }" @click="copyLink"><Link2 :size="12" /> Copy link</button>
 </div>
 </div>

 <div v-else-if="tab==='share'">
 <div class="text-[13px] font-semibold" :style="{ color: 'var(--text)' }">Share link</div>
 <div class="text-[12px] mt-1" :style="{ color: 'var(--text-dim)' }">Buat link berbagi untuk file ini. Atur kadaluarsa & batas download.</div>
 <button class="mt-3 w-full py-2 rounded-[6px] bg-[#2383E2] text-white text-[13px] font-medium hover:bg-[#1a6fc0] inline-flex items-center justify-center gap-1.5" @click="emit('share', file)"><Link2 :size="14" /> Buat share link</button>
 <div class="mt-3 text-[11px] p-2 rounded border bg-[var(--bg)] dark:bg-[#1F1F1F]" :style="{ borderColor: 'var(--border)', color: 'var(--text-dim)' }">Share link akan muncul di Dashboard > Share aktif</div>
 </div>

 <div v-else>
 <div class="text-[13px] font-semibold" :style="{ color: 'var(--text)' }">Activity</div>
 <div class="mt-2 space-y-2">
 <div class="text-[12px] p-2.5 rounded border bg-[#F7F7F5]/50" :style="{ borderColor: 'var(--border)', color: 'var(--text-dim)' }">Upload · {{ fmtDate(file.created_at) }}</div>
 <div v-for="a in store.activity.filter(x => x.detail.includes(file.filename || file.hash)).slice(0,5)" :key="a.id" class="text-[12px] p-2.5 rounded border" :style="{ borderColor: 'var(--border)' }">
 <div class="font-medium" :style="{ color: 'var(--text)' }">{{ a.action }}</div>
 <div :style="{ color: 'var(--text-dim)' }">{{ a.detail }}</div>
 </div>
 <div v-if="!store.activity.filter(x => x.detail.includes(file.filename || file.hash)).length" class="text-[12px] text-center py-4" :style="{ color: 'var(--text-dim)' }">No activity for this file</div>
 </div>
 </div>
 </div>
 </aside>
</template>
