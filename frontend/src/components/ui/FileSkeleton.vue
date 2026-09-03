<script setup>
</script>

<template>
 <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
 <div v-for="i in 8" :key="i" class="rounded-[6px] border bg-white dark:bg-[#1F1F1F] overflow-hidden animate-pulse" :style="{ borderColor: 'var(--border)' }">
 <div class="h-[86px]" style="background:#F7F7F5"></div>
 <div class="p-2.5 space-y-2">
 <div class="h-3 rounded" style="background:#E9E9E7; width:85%"></div>
 <div class="h-2 rounded" style="background:#E9E9E7; width:60%"></div>
 <div class="h-2 rounded-full" style="background:#F7F7F5; width:50%"></div>
 </div>
 </div>
 </div>
</template>
