import { createRouter, createWebHashHistory } from 'vue-router';
import HomeView from './views/HomeView.vue';
import ApiView from './views/ApiView.vue';
import LoginView from './views/LoginView.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    { path: '/', name: 'home', component: HomeView },
    { path: '/api', name: 'api', component: ApiView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

export default router;
