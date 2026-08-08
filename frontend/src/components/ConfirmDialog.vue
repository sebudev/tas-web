<script setup>
import { confirmState, resolveConfirm } from '../composables/useConfirm';
</script>

<template>
  <div v-if="confirmState.show" class="fixed inset-0 z-[150]">
    <div class="modal-backdrop" @click="resolveConfirm(false)"></div>
    <div class="fixed inset-0 z-[100] flex items-center justify-center p-5 pointer-events-none">
      <div class="pointer-events-auto w-full max-w-[360px] bg-card border border-line rounded-xl2 p-5 shadow-2xl">
        <h3 class="text-[15px] mb-2 flex items-center gap-2">
          <span class="text-amber-400">⚠️</span> {{ confirmState.title }}
        </h3>
        <p class="text-[13px] text-txt-dim whitespace-pre-line leading-relaxed mb-5">{{ confirmState.message }}</p>
        <div class="flex gap-2.5 justify-end">
          <button class="px-4 py-2.5 rounded-[10px] text-[13px] font-semibold border border-line text-txt bg-transparent hover:border-accent hover:text-accent transition-colors" @click="resolveConfirm(false)">
            Batal
          </button>
          <button
            class="px-4 py-2.5 rounded-[10px] text-[13px] font-semibold text-white transition-all"
            :class="confirmState.danger ? 'bg-red-500 hover:bg-red-600' : 'bg-accent hover:brightness-115'"
            @click="resolveConfirm(true)"
          >
            {{ confirmState.confirmText }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
