<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';

const props = defineProps({
 items: { type: Array, default: () => [] },
 x: { type: Number, default: 0 },
 y: { type: Number, default: 0 },
 visible: { type: Boolean, default: false },
});
const emit = defineEmits(['action', 'close']);

function onAction(key) { emit('action', key); emit('close'); }

function onDocClick() { emit('close'); }
onMounted(() => setTimeout(() => document.addEventListener('click', onDocClick), 0));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));
</script>

<template>
 <div
 v-if="visible"
 class="fixed z-[80] min-w-[180px] rounded border shadow-lg py-1 overflow-hidden bg-white dark:bg-[#262626]"
 :style="{ left: x + 'px', top: y + 'px', borderColor: 'var(--border)', boxShadow: '0 8px 24px rgba(15,15,15,0.15)' }"
 @click.stop
 >
 <button v-for="it in items" :key="it.key" class="w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2 hover:bg-[#F7F7F5] dark:hover:bg-[#333]" :style="{ color: it.danger ? '#E03E3E' : 'var(--text)' }" @click="onAction(it.key)">
 <span>{{ it.icon }}</span> {{ it.label }}
 </button>
 </div>
</template>
