<script setup>
import { confirmState, resolveConfirm } from '../composables/useConfirm';
import { TriangleAlert } from '@lucide/vue';
// Escape di-handle terpusat oleh composable useEscape (prioritas confirm/prompt)
</script>

<template>
 <div v-if="confirmState.show" class="fixed inset-0 z-[150]">
 <div class="modal-backdrop" @click="resolveConfirm(false)"></div>
 <div class="fixed inset-0 z-[100] flex items-center justify-center p-5 pointer-events-none">
 <div v-focus-trap role="alertdialog" aria-modal="true" class="pointer-events-auto w-full max-w-[360px] bg-card border border-line rounded-xl2 p-5 shadow-2xl">
 <h3 class="text-[15px] font-semibold mb-2 flex items-center gap-2" :style="{ color: 'var(--text)' }">
 <TriangleAlert v-if="confirmState.danger !== false" :size="16" class="text-amber-500 shrink-0" /> {{ confirmState.title }}
 </h3>
 <p class="text-[13px] text-txt-dim whitespace-pre-line leading-relaxed mb-5">{{ confirmState.message }}</p>
 <div class="flex gap-2.5 justify-end">
 <button class="btn-secondary" @click="resolveConfirm(false)">Batal</button>
 <button :class="confirmState.danger ? 'btn-danger' : 'btn-primary'" @click="resolveConfirm(true)">
 {{ confirmState.confirmText }}
 </button>
 </div>
 </div>
 </div>
 </div>
</template>
