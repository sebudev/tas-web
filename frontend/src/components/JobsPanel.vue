<script setup>
import { store } from '../store';
import { retryJob } from '../composables/useApp';

const shown = () => store.jobs.slice().reverse().slice(0, 6);
</script>

<template>
  <div>
    <div v-for="j in shown()" :key="j.id" class="text-xs py-1 flex items-center gap-2"
      :class="{ 'text-accent': j.status === 'running', 'text-red-500': j.status === 'error', 'text-emerald-500': j.status === 'done' }">
      <span>{{ j.status === 'running' ? '⏳' : j.status === 'done' ? '✅' : '❌' }}</span>
      <span class="flex-1 min-w-0 truncate">{{ j.name }} — {{ j.message }}</span>
      <button v-if="j.status === 'error' && j.tmpPath" class="text-[11px] px-2 py-0.5 rounded-md border border-line text-txt-dim hover:text-accent" @click="retryJob(j.id)">Ulang</button>
    </div>
  </div>
</template>
