<script setup>
import { computed, ref } from 'vue';
import { store } from '../store';
import { fmtBytes, fmtDate, iconFor, isImage, escapeHtml } from '../store';
import { showTip, hideTip } from '../composables/useTip';
import { Folder, Bot, Check } from '@lucide/vue';
import { folderById } from '../composables/useApp';

const props = defineProps({
 file: { type: Object, required: true },
 selected: { type: Boolean, default: false },
});
const emit = defineEmits(['click', 'context']);

const name = computed(() => props.file.filename || props.file.hash);
const folder = computed(() => (store.fileFolder[props.file.hash] ? folderById(store.fileFolder[props.file.hash]) : null));
const isSel = computed(() => props.selected);
const imgError = ref(false);
const isImg = computed(() => isImage(props.file) && !imgError.value);
const thumbUrl = computed(() => {
 const q = props.file.profileId ? `?profileId=${props.file.profileId}` : '';
 return `/api/stream/${encodeURIComponent(props.file.hash)}${q}`;
});

function onContext(e) { e.preventDefault(); emit('context', { file: props.file, x: e.clientX, y: e.clientY }); }
</script>

<template>
 <div
 tabindex="0"
 role="button"
 :aria-selected="isSel"
 :aria-label="name"
 class="group relative flex flex-col rounded-[6px] border cursor-pointer overflow-hidden transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2383E2] focus-visible:ring-offset-1"
 :class="isSel ? 'shadow-sm' : 'hover:shadow-sm'"
 :style="isSel ? { borderColor: '#2383E2', background: '#2383E20D', boxShadow: '0 0 0 1px #2383E2' } : { borderColor: 'var(--border)', background: 'var(--card)' }"
 @click="emit('click')"
 @keydown.enter.prevent="emit('click')"
 @keydown.space.prevent="emit('click')"
 @contextmenu="onContext"
 >
 <!-- selection checkbox -->
 <div
 class="absolute top-2 right-2 w-5 h-5 rounded-[4px] flex items-center justify-center text-[11px] font-bold border transition-all"
 :style="isSel ? { background: '#2383E2', color: '#fff', borderColor: '#2383E2' } : { background: 'rgba(255,255,255,0.9)', color: 'transparent', borderColor: 'var(--border)' }"
 :class="!isSel ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'"
 ><Check :size="12" v-if="isSel" /></div>

 <!-- thumbnail / icon area -->
 <div class="h-[86px] flex items-center justify-center border-b overflow-hidden" :style="{ background: 'var(--bg)', borderColor: 'var(--border)' }">
 <img v-if="isImg" :src="thumbUrl" class="w-full h-full object-cover" loading="lazy" @error="imgError = true" :alt="name" />
 <span v-else class="text-[28px]">{{ iconFor(file.filename || '') }}</span>
 </div>

 <div class="p-2.5 flex flex-col gap-1.5">
 <div
 class="font-medium text-[13px] leading-[1.35] line-clamp-2 break-all"
 :style="{ color: 'var(--text)' }"
 @mouseenter="(e) => showTip(e, name)"
 @mouseleave="hideTip"
 >{{ name }}</div>

 <div class="flex items-center gap-1.5 text-[11px]" :style="{ color: 'var(--text-dim)' }">
 <span class="truncate">{{ fmtBytes(file.original_size) }}</span>
 <span class="opacity-30">·</span>
 <span class="truncate">{{ fmtDate(file.created_at).split(' ').slice(1,3).join(' ') }}</span>
 </div>

 <div v-if="folder" class="inline-flex">
 <span class="text-[11px] px-1.5 py-0.5 rounded border truncate max-w-full" :style="{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text-dim)' }"><Folder :size="12" /> {{ folder.name }}</span>
 </div>
 <div v-else-if="file.profileName" class="inline-flex">
 <span class="text-[11px] px-1.5 py-0.5 rounded border truncate max-w-full" :style="{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text-dim)' }"><Bot :size="12" /> {{ file.profileName }}</span>
 </div>

 <div v-if="file.tags && file.tags.length" class="flex flex-wrap gap-1">
 <span v-for="t in file.tags" :key="t" class="text-[10px] px-1.5 py-0.5 rounded-full border" :style="{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text-dim)' }">#{{ t }}</span>
 </div>
 </div>
 </div>
</template>

<style scoped>
.line-clamp-2 {
 display: -webkit-box;
 -webkit-line-clamp: 2;
 -webkit-box-orient: vertical;
 overflow: hidden;
}
</style>
