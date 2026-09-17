<script setup>
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { store } from './store';
import { apiGet } from './composables/useApi';
import ToastStack from './components/ToastStack.vue';
import Tip from './components/Tip.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import PromptDialog from './components/PromptDialog.vue';

const route = useRoute();
const router = useRouter();
const ready = ref(false); // gate: view baru mount setelah sesi dicek

onMounted(async () => {
 // cek sesi: kalau belum login > redirect ke /login (kecuali memang di /login)
 try {
 const me = await apiGet('/api/me');
 store.user = me;
 if (!me && route.path !== '/login') router.replace('/login');
 if (me && route.path === '/login') router.replace('/');
 } catch {
 if (route.path !== '/login') router.replace('/login');
 } finally {
 ready.value = true;
 }
});
</script>

<template>
 <ToastStack />
 <Tip />
 <ConfirmDialog />
 <PromptDialog />
 <router-view v-if="ready" />
</template>
