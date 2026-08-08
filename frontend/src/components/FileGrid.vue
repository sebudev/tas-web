<script setup>
import { store } from '../store';
import { escapeHtml } from '../store';
import { toggleSelect } from '../composables/useApp';
import { showTip, hideTip } from '../composables/useTip';
import FileCard from './FileCard.vue';

defineProps({ items: { type: Array, default: () => [] } });
const emit = defineEmits(['open']);

function onCardClick(f, idx) {
  if (store.selectMode) toggleSelect(f);
  else emit('open', idx);
}
</script>

<template>
  <div class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 sm:gap-3 mt-3.5">
    <FileCard
      v-for="(f, i) in items"
      :key="f.hash"
      :file="f"
      :selected="store.selected.has(f.hash)"
      @click="onCardClick(f, i)"
    />
  </div>
</template>
