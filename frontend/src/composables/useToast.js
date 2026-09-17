import { reactive } from 'vue';

// Toast global (component ToastStack merender daftar ini)
export const toasts = reactive([]);

let seq = 0;

// key (opsional): toast dengan key sama akan di-update, bukan ditumpuk —
// dipakai utk progress upload biar tidak menumpuk ratusan toast.
export function toast(msg, cls = '', key = null) {
  if (key) {
    const ex = toasts.find((t) => t.key === key);
    if (ex) { ex.msg = msg; ex.cls = cls; return ex.id; }
  }
  const id = ++seq;
  toasts.push({ id, msg, cls, key });
  if (!cls.includes('running')) {
    setTimeout(() => dismiss(id), 5000);
  } else if (!key) {
    // status "running" tanpa key jangan menggantung selamanya di layar
    setTimeout(() => dismiss(id), 6000);
  }
  return id;
}

export function dismissKey(key) {
  const i = toasts.findIndex((t) => t.key === key);
  if (i >= 0) toasts.splice(i, 1);
}

export function dismiss(id) {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}
