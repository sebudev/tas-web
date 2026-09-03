<script setup>
defineProps({ lines: { type: Number, default: 3 }, w: { type: String, default: '100%' } });
</script>

<template>
 <div class="animate-pulse space-y-2">
 <div v-for="i in lines" :key="i" class="h-3 rounded" :style="{ width: i===1 ? w : (i===lines? '60%' : '85%'), background: 'var(--border)' }"></div>
 </div>
</template>
