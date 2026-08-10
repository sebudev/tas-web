<script setup>
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { store } from './store';
import { apiGet } from './composables/useApi';
import ToastStack from './components/ToastStack.vue';
import Tip from './components/Tip.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import PromptDialog from './components/PromptDialog.vue';

const route = useRoute();
const router = useRouter();

onMounted(async () => {
  // cek sesi: kalau belum login → redirect ke /login (kecuali memang di /login)
  try {
    const me = await apiGet('/api/me');
    store.user = me;
    if (!me && route.path !== '/login') router.replace('/login');
    if (me && route.path === '/login') router.replace('/');
  } catch {
    if (route.path !== '/login') router.replace('/login');
  }
});
</script>

<template>
  <ToastStack />
  <Tip />
  <ConfirmDialog />
  <PromptDialog />
  <router-view />
</template>
