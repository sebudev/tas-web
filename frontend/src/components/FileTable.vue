<script setup>
import { store } from '../store';
import { fmtBytes, fmtDate, iconFor, escapeHtml } from '../store';
import { toggleSelect } from '../composables/useApp';
import { showTip, hideTip } from '../composables/useTip';

defineProps({ items: { type: Array, default: () => [] } });
const emit = defineEmits(['open']);

function onRowClick(f, idx, e) {
  if (e.target.type === 'checkbox') return;
  if (store.selectMode) {
    toggleSelect(f);
    e.target.closest('tr').querySelector('input').checked = store.selected.has(f.hash);
  } else {
    emit('open', idx);
  }
}
function onCheck(f, e) {
  e.stopPropagation();
  toggleSelect(f);
  e.target.checked = store.selected.has(f.hash);
}
</script>

<template>
  <div class="overflow-x-auto mt-3.5 border border-line rounded-xl2 bg-card">
    <table class="w-full border-collapse text-[13px] min-w-[560px]">
      <thead>
        <tr class="text-left">
          <th class="px-3.5 py-3 text-[11px] uppercase tracking-wide text-txt-dim border-b border-line whitespace-nowrap">✓</th>
          <th class="px-3.5 py-3 text-[11px] uppercase tracking-wide text-txt-dim border-b border-line">File</th>
          <th class="px-3.5 py-3 text-[11px] uppercase tracking-wide text-txt-dim border-b border-line">Ukuran</th>
          <th class="px-3.5 py-3 text-[11px] uppercase tracking-wide text-txt-dim border-b border-line">Tanggal</th>
          <th class="px-3.5 py-3 text-[11px] uppercase tracking-wide text-txt-dim border-b border-line">Tag</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(f, i) in items"
          :key="f.hash"
          class="cursor-pointer transition-colors hover:bg-accent/10"
          :class="{ 'bg-cyan-400/10': store.selected.has(f.hash) }"
          @click="onRowClick(f, i, $event)"
        >
          <td class="px-3.5 py-2.5 border-b border-line align-middle">
            <input type="checkbox" class="w-[15px] h-[15px] cursor-pointer accent-[var(--accent-2)]" :checked="store.selected.has(f.hash)" @click="onCheck(f, $event)" />
          </td>
          <td class="px-3.5 py-2.5 border-b border-line align-middle">
            <div class="flex items-center gap-2.5">
              <span class="text-lg shrink-0">{{ iconFor(f.filename || '') }}</span>
              <span class="whitespace-nowrap overflow-hidden text-ellipsis max-w-[460px]" @mouseenter="(e) => showTip(e, f.filename || f.hash)" @mouseleave="hideTip">
                {{ f.filename || f.hash }}
              </span>
            </div>
          </td>
          <td class="px-3.5 py-2.5 border-b border-line align-middle">{{ fmtBytes(f.original_size) }}</td>
          <td class="px-3.5 py-2.5 border-b border-line align-middle">{{ fmtDate(f.created_at) }}</td>
          <td class="px-3.5 py-2.5 border-b border-line align-middle">
            <span v-for="t in (f.tags || [])" :key="t" class="inline-block mr-1 text-[10px] bg-black/5 border border-line rounded-full px-2 py-0.5 text-txt-dim whitespace-nowrap">#{{ t }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
