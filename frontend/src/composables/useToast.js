import { reactive } from 'vue';

// Toast global (component ToastStack merender daftar ini)
export const toasts = reactive([]);

let seq = 0;

export function toast(msg, cls = '') {
  const id = ++seq;
  toasts.push({ id, msg, cls });
  if (!cls.includes('running')) {
    setTimeout(() => dismiss(id), 5000);
  }
}

export function dismiss(id) {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}
