import { onMounted, onBeforeUnmount } from 'vue';
import { confirmState, resolveConfirm } from './useConfirm';
import { promptState, resolvePrompt } from './usePrompt';

// Escape menutup SATU lapisan teratas saja:
// 1) confirm/prompt yang sedang tampil (prioritas tertinggi), lalu
// 2) dialog terakhir yang mendaftar (LIFO) — jadi dialog bertumpuk tidak
//    ikut tertutup semua sekaligus.
const stack = [];

export function useEscape(handler) {
  const entry = { handler };
  onMounted(() => stack.push(entry));
  onBeforeUnmount(() => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (confirmState.show) { e.preventDefault(); resolveConfirm(false); return; }
    if (promptState.show) { e.preventDefault(); resolvePrompt(null); return; }
    const top = stack[stack.length - 1];
    if (top) { e.preventDefault(); top.handler(); }
  });
}
