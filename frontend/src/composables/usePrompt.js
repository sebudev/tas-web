import { reactive } from 'vue';

// Prompt dialog global — dipakai komponen PromptDialog.vue
// Pengganti window.prompt() yang di-styling.
export const promptState = reactive({
  show: false,
  title: '',
  message: '',
  placeholder: '',
  initial: '',
  okText: 'OK',
  resolve: null,
});

/**
 * Ganti prompt() native dengan dialog custom.
 * Resolve: string nilai input kalau OK, null kalau dibatalkan.
 * Contoh:
 *   const name = await promptDialog({ title: 'Folder baru', placeholder: 'Nama' });
 *   if (name) { ... }
 */
export function promptDialog(opts = {}) {
  promptState.title = opts.title || 'Input';
  promptState.message = opts.message || '';
  promptState.placeholder = opts.placeholder || '';
  promptState.initial = opts.initial ?? '';
  promptState.okText = opts.okText || 'OK';
  promptState.show = true;
  return new Promise((resolve) => {
    promptState.resolve = resolve;
  });
}

export function resolvePrompt(val) {
  promptState.show = false;
  if (promptState.resolve) promptState.resolve(val);
  promptState.resolve = null;
}
