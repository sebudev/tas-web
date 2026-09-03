<script setup>
import { computed, ref } from 'vue';
import { store } from '../store';
import { House, Folder } from '@lucide/vue';
import { folderPath, openFolder, renameFolder } from '../composables/useApp';
import { promptDialog } from '../composables/usePrompt';
import { toast } from '../composables/useToast';

const breadcrumb = computed(() => (store.currentFolder ? folderPath(store.currentFolder) : []));
const editingId = ref(null);
const editName = ref('');

function startEdit(f) { editingId.value = f.id; editName.value = f.name; }
async function saveEdit(f) {
 const name = editName.value.trim();
 editingId.value = null;
 if (!name || name === f.name) return;
 try { await renameFolder(f.id, name); toast('Folder di-rename', 'ok'); }
 catch (e) { toast('Gagal: ' + e.message, 'err'); }
}
</script>

<template>
 <div class="flex items-center gap-1 text-[13px] px-1 py-1 overflow-x-auto whitespace-nowrap">
 <button
 class="px-2 py-1 rounded hover:bg-[#F7F7F5] dark:hover:bg-[#262626] flex items-center gap-1.5"
 :style="{ color: !store.currentFolder ? 'var(--text)' : 'var(--text-dim)' }"
 :class="!store.currentFolder ? 'font-semibold bg-[#EFEFED] dark:bg-[#2A2A2A]' : ''"
 @click="openFolder(null)"
 ><House :size="14" /> Home</button>

 <template v-for="(f, i) in breadcrumb" :key="f.id">
 <span class="text-[12px] opacity-30" :style="{ color: 'var(--text-dim)' }"><span class="opacity-30">></span></span>
 <div v-if="editingId === f.id" class="flex items-center gap-1">
 <input v-model="editName" class="px-2 py-1 rounded border text-[13px] w-[140px] bg-white dark:bg-[#262626] outline-none focus:border-[#2383E2]" :style="{ borderColor: 'var(--border)' }" @keydown.enter="saveEdit(f)" @keydown.escape="editingId=null" @blur="saveEdit(f)" autofocus />
 </div>
 <button
 v-else
 class="px-2 py-1 rounded hover:bg-[#F7F7F5] dark:hover:bg-[#262626]"
 :style=" i === breadcrumb.length - 1 ? { color: 'var(--text)', background: 'var(--bg-2)', fontWeight: 600 } : { color: 'var(--text)' }"
 :class="i === breadcrumb.length - 1 ? 'dark:!bg-[#2A2A2A] dark:!text-[#F5F5F5]' : ''"
 @click="openFolder(f.id)"
 @dblclick="startEdit(f)"
 :title="i===breadcrumb.length-1 ? 'Double-click to rename' : ''"
 ><Folder :size="14" class="shrink-0" /> {{ f.name }}</button>
 </template>

 <span class="ml-2 text-[11px] px-1.5 py-0.5 rounded border bg-white dark:bg-[#262626]" :style="{ borderColor: 'var(--border)', color: 'var(--text-dim)' }">
 {{ store.filtered.length }} item
 </span>
 </div>
</template>
