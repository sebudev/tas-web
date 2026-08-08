<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiPost } from '../composables/useApi';
import { store } from '../store';
import { toast } from '../composables/useToast';

const router = useRouter();
const username = ref('');
const password = ref('');
const busy = ref(false);

async function login() {
  busy.value = true;
  try {
    const data = await apiPost('/api/login', { username: username.value, password: password.value });
    store.user = data;
    router.replace('/');
  } catch (e) {
    toast(e.message, 'err');
  }
  busy.value = false;
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="bg-card border border-line rounded-2xl p-8 w-full max-w-[340px]">
      <div class="text-center text-2xl mb-1.5"><span class="text-accent-two">✦</span> tas</div>
      <div class="text-center text-txt-dim text-[13px] mb-5">Telegram as Storage — masuk untuk melanjutkan</div>

      <input v-model="username" class="input" placeholder="Username" autocomplete="username" @keydown.enter="$refs.pw.focus()" />
      <input ref="pw" v-model="password" type="password" class="input" placeholder="Password" autocomplete="current-password" @keydown.enter="login" />

      <button class="w-full py-3 rounded-[10px] font-semibold text-white bg-gradient-to-r from-accent to-accent-two disabled:opacity-50" :disabled="busy" @click="login">
        🔐 Masuk
      </button>
    </div>
  </div>
</template>

<style scoped>
.input {
  width: 100%; padding: 11px 14px; margin-bottom: 12px; box-sizing: border-box;
  border-radius: 10px; border: 1px solid var(--border);
  background: var(--bg-2); color: var(--text); font-size: 14px; outline: none;
}
.input:focus { border-color: var(--accent); }
</style>
