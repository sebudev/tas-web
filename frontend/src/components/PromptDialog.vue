<script setup>
import { ref, onMounted, watch, nextTick } from 'vue';
import { promptState, resolvePrompt } from '../composables/usePrompt';

const val = ref(promptState.initial);
const inputRef = ref(null);

// dialog selalu ter-mount; reset isi tiap kali dibuka (cegah password/teks lama nyangkut)
watch(() => promptState.show, (show) => {
 if (!show) return;
 val.value = promptState.initial;
 nextTick(() => { inputRef.value?.focus(); inputRef.value?.select(); });
});

onMounted(() => {
 val.value = promptState.initial;
 inputRef.value?.focus();
 inputRef.value?.select();
});

function submit() {
 const raw = val.value;
 const v = promptState.inputType === 'password' ? raw : raw.trim();
 if (!v) return;
 resolvePrompt(v);
}
const canSubmit = () => (promptState.inputType === 'password' ? val.value.length > 0 : !!val.value.trim());
</script>

<template>
 <div v-if="promptState.show" class="fixed inset-0 z-[150]">
 <div class="modal-backdrop" @click="resolvePrompt(null)"></div>
 <div class="fixed inset-0 z-[100] flex items-center justify-center p-5 pointer-events-none">
 <div v-focus-trap role="dialog" aria-modal="true" class="pointer-events-auto w-full max-w-[380px] bg-card border border-line rounded-xl2 p-5 shadow-2xl">
 <h3 class="text-[15px] font-semibold mb-1.5" :style="{ color: 'var(--text)' }">{{ promptState.title }}</h3>
 <p v-if="promptState.message" class="text-[13px] text-txt-dim mb-3 leading-relaxed">{{ promptState.message }}</p>
 <input
 ref="inputRef"
 v-model="val"
 class="input mb-4"
 :type="promptState.inputType"
 :autocomplete="promptState.inputType === 'password' ? 'new-password' : 'off'"
 :placeholder="promptState.placeholder"
 @keydown.enter="submit"
 />
 <div class="flex gap-2.5 justify-end">
 <button class="btn-secondary" @click="resolvePrompt(null)">Batal</button>
 <button class="btn-primary disabled:opacity-50" :disabled="!canSubmit()" @click="submit">{{ promptState.okText }}</button>
 </div>
 </div>
 </div>
 </div>
</template>
