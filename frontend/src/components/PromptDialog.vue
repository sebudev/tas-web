<script setup>
import { ref, onMounted } from 'vue';
import { promptState, resolvePrompt } from '../composables/usePrompt';

const val = ref(promptState.initial);
const inputRef = ref(null);

onMounted(() => {
  val.value = promptState.initial;
  inputRef.value?.focus();
  inputRef.value?.select();
});

function submit() {
  const v = val.value.trim();
  if (!v) return;
  resolvePrompt(v);
}
</script>

<template>
  <div v-if="promptState.show" class="fixed inset-0 z-[150]">
    <div class="modal-backdrop" @click="resolvePrompt(null)"></div>
    <div class="fixed inset-0 z-[100] flex items-center justify-center p-5 pointer-events-none">
      <div class="pointer-events-auto w-full max-w-[380px] bg-card border border-line rounded-xl2 p-5 shadow-2xl">
        <h3 class="text-[15px] mb-1.5">{{ promptState.title }}</h3>
        <p v-if="promptState.message" class="text-[13px] text-txt-dim mb-3 leading-relaxed">{{ promptState.message }}</p>
        <input
          ref="inputRef"
          v-model="val"
          class="w-full px-3.5 py-2.5 rounded-[10px] border border-line bg-bg-2 text-txt text-[13px] outline-none focus:border-accent mb-4"
          :placeholder="promptState.placeholder"
          @keydown.enter="submit"
          @keydown.esc="resolvePrompt(null)"
        />
        <div class="flex gap-2.5 justify-end">
          <button
            class="px-4 py-2.5 rounded-[10px] text-[13px] font-semibold border border-line text-txt bg-transparent hover:border-accent hover:text-accent transition-colors"
            @click="resolvePrompt(null)"
          >Batal</button>
          <button
            class="px-4 py-2.5 rounded-[10px] text-[13px] font-semibold text-white bg-accent hover:brightness-115 transition-all disabled:opacity-50"
            :disabled="!val.trim()"
            @click="submit"
          >{{ promptState.okText }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
