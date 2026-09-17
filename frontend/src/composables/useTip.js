import { reactive } from 'vue';

// Tooltip global — dipakai komponen Tip.vue
export const tip = reactive({ show: false, text: '', x: 0, y: 0 });

let moveHandler = null;
let tipEl = null;   // cache elemen .tip-el (hindari querySelector tiap mousemove)
let rafId = 0;
let lastEv = null;

function getTipEl() {
  if (!tipEl || !document.contains(tipEl)) tipEl = document.querySelector('.tip-el');
  return tipEl;
}

function moveTip(e) {
  const pad = 14;
  const el = getTipEl();
  const maxX = window.innerWidth - (el ? el.offsetWidth : 320) - pad;
  tip.x = Math.max(6, Math.min(e.clientX + pad, maxX));
  tip.y = Math.max(6, e.clientY + pad);
}

// throttle ke 1 frame — mousemove bisa ratusan kali/detik
function onMove(e) {
  lastEv = e;
  if (rafId) return;
  rafId = requestAnimationFrame(() => { rafId = 0; if (lastEv) moveTip(lastEv); });
}

export function showTip(e, text) {
  tip.text = text;
  tip.show = true;
  moveTip(e);
  if (moveHandler) document.removeEventListener('mousemove', moveHandler);
  moveHandler = onMove;
  document.addEventListener('mousemove', moveHandler, { passive: true });
}

export function hideTip() {
  tip.show = false;
  if (moveHandler) { document.removeEventListener('mousemove', moveHandler); moveHandler = null; }
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  lastEv = null;
}
