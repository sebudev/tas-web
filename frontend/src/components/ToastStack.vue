<script setup>
import { toasts, dismiss } from '../composables/useToast';
</script>

<template>
 <div class="fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] flex flex-col items-center gap-1.5 pointer-events-none px-3">
 <transition-group name="toast">
 <div
 v-for="t in toasts"
 :key="t.id"
 class="max-w-[420px] w-full px-3 py-2.5 rounded-[6px] text-[13px] border pointer-events-auto shadow-[0_4px_12px_rgba(0,0,0,0.08)] cursor-pointer flex items-center gap-2"
 :style="{
 background: t.cls==='err' ? '#FFF1F1' : t.cls==='ok' ? '#E6F4EA' : 'var(--card)',
 borderColor: t.cls==='err' ? '#FFD0D0' : t.cls==='ok' ? '#A7E0B5' : 'var(--border)',
 color: 'var(--text)',
 boxShadow: '0 2px 8px rgba(15,15,15,0.08), 0 0 0 1px rgba(15,15,15,0.04)'
 }"
 @click="dismiss(t.id)"
 >
 <span class="shrink-0 w-1.5 h-1.5 rounded-full" :style="{ background: t.cls==='err' ? '#E03E3E' : t.cls==='ok' ? '#1A7F37' : '#2383E2' }"></span>
 <span class="flex-1 leading-snug">{{ t.msg }}</span>
 <span class="text-[11px] opacity-40 shrink-0">X</span>
 </div>
 </transition-group>
 </div>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: all .2s ease; }
.toast-enter-from { opacity: 0; transform: translateY(8px) scale(0.98); }
.toast-leave-to { opacity: 0; transform: translateY(-4px) scale(0.98); }
.toast-move { transition: transform .2s ease; }
</style>
