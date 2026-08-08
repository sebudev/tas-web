<script setup>
import { tip } from '../composables/useTip';
</script>

<template>
  <div
    v-if="tip.show"
    class="tip-el fixed z-[300] max-w-[320px] pointer-events-none bg-card border border-line rounded-[10px] px-3 py-2 text-xs text-txt leading-snug shadow-[0_10px_30px_rgba(0,0,0,.4)] break-words transition-opacity duration-150"
    :style="{ left: tip.x + 'px', top: tip.y + 'px' }"
  >
    {{ tip.text }}
  </div>
</template>
