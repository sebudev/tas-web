import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { vFocusTrap } from './directives/focusTrap';
import './style.css';

const app = createApp(App);
app.directive('focus-trap', vFocusTrap);
app.use(router);
app.mount('#app');
