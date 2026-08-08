import { reactive } from 'vue';

// Tooltip global — dipakai komponen Tip.vue
export const tip = reactive({ show: false, text: '', x: 0, y: 0 });

let moveHandler = null;

export function showTip(e, text) {
  tip.text = text;
  tip.show = true;
  moveTip(e);
  if (moveHandler) document.removeEventListener('mousemove', moveHandler);
  moveHandler = (ev) => moveTip(ev);
  document.addEventListener('mousemove', moveHandler);
}

function moveTip(e) {
  const pad = 14;
  const el = document.querySelector('.tip-el');
  const maxX = window.innerWidth - (el ? el.offsetWidth : 320) - pad;
  tip.x = Math.max(6, Math.min(e.clientX + pad, maxX));
  tip.y = Math.max(6, e.clientY + pad);
}

export function hideTip() {
  tip.show = false;
  if (moveHandler) document.removeEventListener('mousemove', moveHandler);
}
