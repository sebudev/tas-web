// v-focus-trap — tahan fokus (Tab/Shift+Tab) di dalam elemen dialog,
// fokuskan elemen pertama saat muncul, dan kembalikan fokus saat ditutup.
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled])', 'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusables(el) {
  return [...el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
}

export const vFocusTrap = {
  mounted(el) {
    el.setAttribute('tabindex', el.getAttribute('tabindex') || '-1');
    el.__trapRestore = document.activeElement;

    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const f = focusables(el);
      if (!f.length) { e.preventDefault(); el.focus(); return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    el.addEventListener('keydown', onKey);
    el.__trapKey = onKey;

    requestAnimationFrame(() => {
      const f = focusables(el);
      (f[0] || el).focus();
    });
  },
  unmounted(el) {
    if (el.__trapKey) el.removeEventListener('keydown', el.__trapKey);
    const restore = el.__trapRestore;
    if (restore && typeof restore.focus === 'function' && document.contains(restore)) restore.focus();
  },
};
