<script setup>
import { store } from '../store';
import { toggleSelectWithShift } from '../composables/useApp';
import FileCard from './FileCard.vue';

defineProps({ items: { type: Array, default: () => [] } });
const emit = defineEmits(['open', 'context']);

function onCardClick(f, idx, e) {
 if (store.selectMode || e.shiftKey) {
 toggleSelectWithShift(f, store.page * 24 + idx, e);
 } else emit('open', idx);
}
function onContext(payload) { emit('context', payload); }
</script>

<template>
 <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mt-2">
 <FileCard
 v-for="(f, i) in items"
 :key="f.hash"
 :file="f"
 :selected="store.selected.has(f.hash)"
 @click="onCardClick(f, i, $event)"
 @context="onContext"
 />
 </div>
</template>
