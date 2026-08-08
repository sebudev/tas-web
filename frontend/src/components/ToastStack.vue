<script setup>
import { toasts, dismiss } from '../composables/useToast';
</script>

<template>
  <div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex flex-col items-center gap-2 pointer-events-none">
    <transition-group name="fade">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="max-w-[90vw] px-5 py-3 rounded-xl text-[13px] bg-card border pointer-events-auto shadow-lg cursor-pointer"
        :class="{
          'border-emerald-500': t.cls === 'ok',
          'border-red-500': t.cls === 'err',
          'border-cyan-400': t.cls === 'running' || t.cls === '',
          'border-line': !['ok','err','running'].includes(t.cls) && t.cls !== '',
        }"
        @click="dismiss(t.id)"
      >
        {{ t.msg }}
      </div>
    </transition-group>
  </div>
</template>
