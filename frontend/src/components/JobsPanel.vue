<script setup>
import { computed } from 'vue';
import { store } from '../store';
import { retryJob } from '../composables/useApp';
import { LoaderCircle, CircleCheck, CircleX, RotateCw } from '@lucide/vue';

const shown = computed(() => store.jobs.slice(-6).reverse());
</script>

<template>
 <div v-if="shown.length" class="mt-2 rounded-[6px] border overflow-hidden" :style="{ borderColor: 'var(--border)', background: 'var(--card)' }">
 <div v-for="j in shown" :key="j.id" class="px-3 py-2 border-b last:border-0 text-[12px]" :style="{ borderColor: 'var(--border)' }">
 <div class="flex items-center gap-2">
 <LoaderCircle v-if="j.status === 'running'" :size="14" class="animate-spin shrink-0 text-[#2383E2]" />
 <CircleCheck v-else-if="j.status === 'done'" :size="14" class="shrink-0 text-[#1A7F37]" />
 <CircleX v-else :size="14" class="shrink-0 text-[#E03E3E]" />
 <span class="flex-1 min-w-0 truncate font-medium" :style="{ color: 'var(--text)' }">{{ j.name }}</span>
 <span v-if="j.status === 'done'" class="shrink-0 text-[11px]" :style="{ color: '#1A7F37' }">Selesai</span>
 <button v-else-if="j.status === 'error' && j.tmpPath" class="btn-secondary !px-2 !py-0.5 text-[11px] shrink-0" @click="retryJob(j.id)"><RotateCw :size="11" /> Ulang</button>
 </div>
 <div class="mt-1 pl-6 truncate" :style="{ color: 'var(--text-dim)' }">{{ j.message }}</div>
 <div v-if="j.status === 'running'" class="mt-1.5 ml-6 h-1 rounded-full overflow-hidden" :style="{ background: 'var(--border)' }">
 <div class="h-full bar-indeterminate"></div>
 </div>
 </div>
 </div>
</template>
