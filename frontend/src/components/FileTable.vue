<script setup>
import { store } from '../store';
import { fmtBytes, fmtDate, iconFor, escapeHtml } from '../store';
import { toggleSelectWithShift, folderById } from '../composables/useApp';
import { showTip, hideTip } from '../composables/useTip';

defineProps({ items: { type: Array, default: () => [] } });
const emit = defineEmits(['open', 'context']);
const swipeX = new Map();
function onTouchStart(e, hash) { swipeX.set(hash, e.touches[0].clientX); }
function onTouchMove(e, hash) { const start = swipeX.get(hash); if (start==null) return; const diff = e.touches[0].clientX - start; const el = document.getElementById('row-'+hash); if (el) el.style.transform = 'translateX('+Math.max(-80, Math.min(80, diff))+'px)'; }
function onTouchEnd(e, hash) { const el = document.getElementById('row-'+hash); if (el) { const m = el.style.transform.match(/translateX\((-?\d+)/); const v = m ? parseInt(m[1]) : 0; if (v<-40) emit('context', { file: { hash }, x: window.innerWidth-20, y: e.changedTouches[0].clientY }); el.style.transform=''; } swipeX.delete(hash); }

function onRowClick(f, idx, e) {
 if (e.target.type === 'checkbox') return;
 if (store.selectMode || e.shiftKey) {
 const globalIdx = store.page * 24 + idx;
 toggleSelectWithShift(f, globalIdx, e);
 } else emit('open', idx);
}
function onCheck(f, e) {
 e.stopPropagation();
 const globalIdx = store.filtered.findIndex(x => x.hash === f.hash);
 toggleSelectWithShift(f, globalIdx, e);
}
function onContext(f, e) {
 e.preventDefault();
 emit('context', { file: f, x: e.clientX, y: e.clientY });
}
const folderOf = (hash) => {
 const fid = store.fileFolder[hash];
 return fid ? folderById(fid) : null;
};
</script>

<template>
 <div class="border rounded-[6px] overflow-hidden" :style="{ borderColor: 'var(--border)', background: 'var(--card)' }">
 <div class="overflow-x-auto">
 <table class="w-full border-collapse text-[13px] min-w-[640px]">
 <thead class="sticky top-0" :style="{ background: 'var(--bg)' }">
 <tr class="text-left border-b" :style="{ borderColor: 'var(--border)' }">
 <th class="px-2 py-2 w-[36px]"><span class="text-[11px] font-medium" :style="{ color: 'var(--text-dim)' }"><Check :size="10" /></span></th>
 <th class="px-3 py-2 text-[11px] font-medium tracking-wide" :style="{ color: 'var(--text-dim)' }">Name</th>
 <th class="px-3 py-2 text-[11px] font-medium tracking-wide" :style="{ color: 'var(--text-dim)' }">Size</th>
 <th class="px-3 py-2 text-[11px] font-medium tracking-wide" :style="{ color: 'var(--text-dim)' }">Folder</th>
 <th class="px-3 py-2 text-[11px] font-medium tracking-wide" :style="{ color: 'var(--text-dim)' }">Bot</th>
 <th class="px-3 py-2 text-[11px] font-medium tracking-wide" :style="{ color: 'var(--text-dim)' }">Modified</th>
 </tr>
 </thead>
 <tbody>
 <tr
 v-for="(f, i) in items"
 :key="f.hash"
 class="cursor-pointer border-b last:border-0 transition-colors"
 :style="store.selected.has(f.hash) ? { background: '#2383E20D' } : { borderColor: 'var(--border)' }"
 :class="store.selected.has(f.hash) ? '' : 'hover:bg-[var(--bg)] dark:hover:bg-[#262626]'"
 @click="onRowClick(f, i, $event)"
 @contextmenu="onContext(f, $event)"
 >
 <td class="px-2 py-2 align-middle">
 <input type="checkbox" class="w-[14px] h-[14px] rounded-[3px] accent-[#2383E2] cursor-pointer" :checked="store.selected.has(f.hash)" @click="onCheck(f, $event)" />
 </td>
 <td class="px-3 py-2 align-middle">
 <div class="flex items-center gap-2 min-w-0">
 <span class="text-[15px] shrink-0">{{ iconFor(f.filename || '') }}</span>
 <span class="truncate max-w-[380px] font-medium" :style="{ color: 'var(--text)' }" @mouseenter="(e) => showTip(e, f.filename || f.hash)" @mouseleave="hideTip">{{ f.filename || f.hash }}</span>
 </div>
 </td>
 <td class="px-3 py-2 align-middle whitespace-nowrap" :style="{ color: 'var(--text-dim)' }">{{ fmtBytes(f.original_size) }}</td>
 <td class="px-3 py-2 align-middle">
 <span v-if="folderOf(f.hash)" class="text-[11px] px-1.5 py-0.5 rounded border" :style="{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text-dim)' }"><Folder :size="12" /> {{ folderOf(f.hash).name }}</span>
 <span v-else class="text-[11px] opacity-30">—</span>
 </td>
 <td class="px-3 py-2 align-middle">
 <span v-if="f.profileName" class="text-[11px]" :style="{ color: 'var(--text-dim)' }"><Bot :size="12" /> {{ f.profileName }}</span>
 <span v-else class="text-[11px] opacity-30">—</span>
 </td>
 <td class="px-3 py-2 align-middle text-[12px] whitespace-nowrap" :style="{ color: 'var(--text-dim)' }">{{ fmtDate(f.created_at) }}</td>
 </tr>
 </tbody>
 </table>
 </div>
 </div>
</template>
