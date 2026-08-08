import { reactive } from 'vue';

// Confirm dialog global — dipakai komponen ConfirmDialog.vue
export const confirmState = reactive({
  show: false,
  title: '',
  message: '',
  confirmText: 'OK',
  danger: true,
  resolve: null,
});

/**
 * Ganti window.confirm() dengan dialog custom yang di-styling.
 * Contoh:
 *   if (!(await confirmDialog({ title: 'Hapus?', message: '...', confirmText: 'Hapus' }))) return;
 */
export function confirmDialog(opts = {}) {
  confirmState.title = opts.title || 'Konfirmasi';
  confirmState.message = opts.message || '';
  confirmState.confirmText = opts.confirmText || 'OK';
  confirmState.danger = opts.danger !== false;
  confirmState.show = true;
  return new Promise((resolve) => {
    confirmState.resolve = resolve;
  });
}

export function resolveConfirm(val) {
  confirmState.show = false;
  if (confirmState.resolve) confirmState.resolve(val);
  confirmState.resolve = null;
}
