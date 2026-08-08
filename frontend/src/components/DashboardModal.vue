<script setup>
import { onMounted } from 'vue';
import { store } from '../store';
import { fmtBytes, fmtDateTime } from '../store';
import { loadDashboard } from '../composables/useApp';

const emit = defineEmits(['close']);

onMounted(async () => {
  try { await loadDashboard(); } catch { /* ignore */ }
});
</script>

<template>
  <div class="modal-backdrop" @click="emit('close')"></div>
  <div class="fixed inset-0 z-[100] flex items-center justify-center p-5 pointer-events-none">
    <div class="pointer-events-auto w-full max-w-[520px] max-h-[82vh] overflow-y-auto bg-card border border-line rounded-xl2 p-5 relative">
      <h3 class="text-[15px] mb-3">📊 Dashboard</h3>

      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-4">
        <template v-if="store.stats">
          <div class="bg-bg-2 border border-line rounded-[10px] p-3">
            <div class="text-xl font-bold">{{ store.stats.fileCount || 0 }}</div>
            <div class="text-[11px] text-txt-dim">File</div>
          </div>
          <div class="bg-bg-2 border border-line rounded-[10px] p-3">
            <div class="text-xl font-bold">{{ fmtBytes(store.stats.totalSize) }}</div>
            <div class="text-[11px] text-txt-dim">Total</div>
          </div>
          <div class="bg-bg-2 border border-line rounded-[10px] p-3">
            <div class="text-xl font-bold">{{ fmtBytes(store.stats.storedSize) }}</div>
            <div class="text-[11px] text-txt-dim">Tersimpan</div>
          </div>
          <div class="bg-bg-2 border border-line rounded-[10px] p-3">
            <div class="text-xl font-bold">{{ store.stats.savingsPercent || 0 }}%</div>
            <div class="text-[11px] text-txt-dim">Hemat</div>
          </div>
          <div class="bg-bg-2 border border-line rounded-[10px] p-3">
            <div class="text-xl font-bold">{{ fmtBytes(store.stats.cacheBytes) }}</div>
            <div class="text-[11px] text-txt-dim">Cache</div>
          </div>
          <div class="bg-bg-2 border border-line rounded-[10px] p-3">
            <div class="text-xl font-bold">{{ store.stats.activeShares || 0 }}</div>
            <div class="text-[11px] text-txt-dim">Share aktif</div>
          </div>
          <div v-for="(v, k) in (store.stats.byType || {})" :key="k" class="bg-bg-2 border border-line rounded-[10px] p-3">
            <div class="text-xl font-bold">{{ v }}</div>
            <div class="text-[11px] text-txt-dim">{{ k }}</div>
          </div>
        </template>
      </div>

      <div class="text-xs text-txt-dim mb-1">Aktivitas terakhir</div>
      <div class="max-h-60 overflow-y-auto text-xs text-txt-dim border border-line rounded-lg">
        <div v-if="!store.activity.length" class="p-2.5">Belum ada aktivitas</div>
        <div v-for="a in store.activity" :key="a.id" class="px-3 py-2 border-b border-line last:border-0 flex gap-2">
          <span class="opacity-70 whitespace-nowrap">{{ fmtDateTime(a.ts) }}</span>
          <span>{{ a.action }} — {{ a.detail }}</span>
        </div>
      </div>

      <div class="text-xs text-txt-dim mb-1 mt-3">Share link aktif</div>
      <div class="max-h-40 overflow-y-auto text-xs text-txt-dim border border-line rounded-lg">
        <div v-if="!store.shares.length" class="p-2.5">Tidak ada share link</div>
        <div v-for="s in store.shares" :key="s.token" class="px-3 py-2 border-b border-line last:border-0 flex gap-2">
          <span class="opacity-70 whitespace-nowrap">{{ fmtDateTime(s.created_at) }}</span>
          <span>{{ s.filename }} · {{ s.downloads }}/{{ s.max_downloads }}x · {{ Math.round((s.expires_at - Date.now()) / 3600000) }}j lagi</span>
        </div>
      </div>

      <button class="modal-x" @click="emit('close')">✕</button>
    </div>
  </div>
</template>
