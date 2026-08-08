<script setup>
import { computed } from 'vue';
import { store } from '../store';
import { fmtBytes, fmtDate, iconFor, escapeHtml } from '../store';
import { showTip, hideTip } from '../composables/useTip';

const props = defineProps({
  file: { type: Object, required: true },
  selected: { type: Boolean, default: false },
});
const emit = defineEmits(['click']);

const tags = computed(() => (props.file.tags || []).map((t) => '#' + escapeHtml(t)).join(' '));
const name = computed(() => props.file.filename || props.file.hash);
</script>

<template>
  <div
    class="bg-card border border-line rounded-xl2 p-3 cursor-pointer flex flex-col gap-2 relative transition-colors"
    :class="{ 'border-accent-two shadow-[0_0_0_1px_var(--accent-2)]': selected }"
    @click="emit('click')"
  >
    <div v-if="store.selectMode"
      class="absolute top-2 right-2 w-5 h-5 rounded-md flex items-center justify-center text-xs text-white"
      :class="selected ? 'bg-accent-two border-accent-two' : 'bg-black/30 border-2 border-line'">
      {{ selected ? '✓' : '' }}
    </div>

    <div class="text-2xl">{{ iconFor(file.filename || '') }}</div>

    <div
      class="font-semibold text-[12.5px] leading-snug line-clamp-2 break-all"
      @mouseenter="(e) => showTip(e, name)"
      @mouseleave="hideTip"
    >{{ name }}</div>

    <div class="text-[11.5px] text-txt-dim flex justify-between gap-2 flex-wrap">
      <span>{{ fmtBytes(file.original_size) }}</span>
      <span>{{ fmtDate(file.created_at) }}</span>
    </div>

    <div v-if="tags" class="flex flex-wrap gap-1 text-[10px] text-txt-dim">
      <span v-for="t in file.tags" :key="t" class="bg-black/5 border border-line rounded-full px-2 py-0.5">#{{ t }}</span>
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
