<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

// Dropdown custom pengganti <select> native — gaya konsisten dgn design system.
// Props: modelValue, options [{value,label}] atau array string, placeholder.
// Emit: update:modelValue (bisa dipakai dgn v-model).
const props = defineProps({
  modelValue: { type: [String, Number], default: null },
  options: { type: Array, required: true },
  placeholder: { type: String, default: 'Pilih...' },
  title: { type: String, default: '' },
  menuWidth: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue']);

const open = ref(false);
const rootRef = ref(null);

const opts = computed(() => props.options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)));
const selected = computed(() => opts.value.find((o) => o.value === props.modelValue));

function toggle() { open.value = !open.value; }
function pick(o) {
  emit('update:modelValue', o.value);
  open.value = false;
}
function onDocClick(e) {
  if (rootRef.value && !rootRef.value.contains(e.target)) open.value = false;
}
onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));
</script>

<template>
  <div ref="rootRef" class="relative inline-block" :title="title">
    <button type="button" class="sel-btn" @click="toggle">
      <span class="truncate">{{ selected ? selected.label : placeholder }}</span>
      <span class="caret" :class="{ up: open }">▾</span>
    </button>

    <div v-if="open" class="sel-menu" :style="menuWidth ? { minWidth: menuWidth } : {}">
      <button
        v-for="o in opts"
        :key="o.value"
        type="button"
        class="sel-item"
        :class="{ 'sel-active': o.value === modelValue }"
        @click="pick(o)"
      >
        <span class="truncate">{{ o.label }}</span>
        <span v-if="o.value === modelValue" class="sel-check">✓</span>
      </button>
      <div v-if="!opts.length" class="sel-empty">Kosong</div>
    </div>
  </div>
</template>

<style scoped>
.sel-btn {
  display: flex; align-items: center; gap: 8px;
  background: var(--bg-2); border: 1px solid var(--border); color: var(--text);
  padding: 9px 12px; border-radius: 10px; font-size: 13px; cursor: pointer;
  max-width: 260px; transition: border-color .15s;
}
.sel-btn:hover { border-color: var(--accent); }
.caret { font-size: 10px; color: var(--text-dim); transition: transform .15s; }
.caret.up { transform: rotate(180deg); }
.sel-menu {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 70;
  min-width: 170px; max-width: 320px; max-height: 320px; overflow-y: auto;
  background: var(--card); border: 1px solid var(--border); border-radius: 12px;
  padding: 4px; box-shadow: 0 12px 32px rgba(0, 0, 0, .45);
}
.sel-item {
  display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
  padding: 8px 10px; border-radius: 8px; font-size: 13px;
  color: var(--text-dim); background: transparent; border: none; cursor: pointer;
  white-space: nowrap;
}
.sel-item:hover { background: var(--bg-2); color: var(--text); }
.sel-active { color: var(--text); font-weight: 600; }
.sel-check { margin-left: auto; color: var(--accent-2); font-size: 12px; }
.sel-empty { padding: 10px; text-align: center; font-size: 12px; color: var(--text-dim); }
</style>
