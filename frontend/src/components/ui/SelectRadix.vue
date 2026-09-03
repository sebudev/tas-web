<script setup>
import { ref } from 'vue';
import { ChevronDown, Check } from '@lucide/vue';
import { SelectRoot, SelectTrigger, SelectPortal, SelectContent, SelectViewport, SelectItem, SelectItemIndicator, SelectItemText, SelectValue } from 'radix-vue';

const props = defineProps({
 modelValue: { type: [String, Number], default: null },
 options: { type: Array, required: true },
 placeholder: { type: String, default: 'Pilih...' },
 title: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue']);
const opts = props.options.map(o => typeof o === 'string' ? { value: o, label: o } : o);
function onUpdate(v) { emit('update:modelValue', v); }
</script>

<template>
 <SelectRoot :model-value="String(modelValue ?? '')" @update:model-value="onUpdate" :title="title">
 <SelectTrigger class="inline-flex items-center gap-2 px-3 py-1.5 rounded-[6px] border bg-white dark:bg-[#262626] hover:bg-[#F7F7F5] dark:hover:bg-[#333] text-[13px] min-w-[140px] justify-between" :style="{ borderColor: 'var(--border)', color: 'var(--text)' }">
 <SelectValue :placeholder="placeholder" />
 <ChevronDown :size="14" class="opacity-60 shrink-0" />
 </SelectTrigger>
 <SelectPortal>
 <SelectContent class="min-w-[160px] rounded-[8px] border bg-white dark:bg-[#262626] shadow-lg p-1 z-[70]" :style="{ borderColor: 'var(--border)', boxShadow: '0 12px 32px rgba(0,0,0,0.12)' }">
 <SelectViewport>
 <SelectItem v-for="o in opts" :key="o.value" :value="String(o.value)" class="relative flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-[13px] cursor-pointer data-[highlighted]:bg-[#F7F7F5] dark:data-[highlighted]:bg-[#333] data-[state=checked]:bg-[#EFEFED] dark:data-[state=checked]:bg-[#333] outline-none" :style="{ color: 'var(--text)' }">
 <SelectItemText>{{ o.label }}</SelectItemText>
 <SelectItemIndicator class="ml-auto"><Check :size="12" class="text-[#2383E2]" /></SelectItemIndicator>
 </SelectItem>
 </SelectViewport>
 </SelectContent>
 </SelectPortal>
 </SelectRoot>
</template>
