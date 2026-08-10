<script setup>
import { computed } from 'vue';
import { store } from '../store';
import { folderChildren, folderById, openFolder, createFolder, renameFolder, deleteFolder } from '../composables/useApp';
import { confirmDialog } from '../composables/useConfirm';
import { toast } from '../composables/useToast';
import FolderSidebar from './FolderSidebar.vue';

const props = defineProps({
  parentId: { type: Number, default: null },
  depth: { type: Number, default: 0 },
});

const children = computed(() => folderChildren(props.parentId));

function toggleExpand(id) {
  if (store.expandedFolders.has(id)) store.expandedFolders.delete(id);
  else store.expandedFolders.add(id);
}

async function onCreate() {
  const parent = props.parentId ? folderById(props.parentId) : null;
  const name = prompt(parent ? `Nama subfolder di "${parent.name}":` : 'Nama folder baru:');
  if (!name || !name.trim()) return;
  try {
    await createFolder(name.trim(), props.parentId);
    if (props.parentId) store.expandedFolders.add(props.parentId);
    toast('📁 Folder "' + name.trim() + '" dibuat', 'ok');
  } catch (e) { toast('Gagal: ' + e.message, 'err'); }
}

async function onRename(f) {
  const name = prompt('Nama baru untuk "' + f.name + '":', f.name);
  if (!name || !name.trim() || name.trim() === f.name) return;
  try { await renameFolder(f.id, name.trim()); toast('Folder di-rename', 'ok'); }
  catch (e) { toast('Gagal: ' + e.message, 'err'); }
}

async function onDelete(f) {
  const ok = await confirmDialog({
    title: 'Hapus folder?',
    message: `Hapus folder "${f.name}"?\n\nSubfolder naik ke atas dan file di dalamnya TETAP aman di storage — hanya organisasinya yang dihapus.`,
    confirmText: 'Hapus Folder',
  });
  if (!ok) return;
  try { await deleteFolder(f.id); } catch (e) { toast('Gagal: ' + e.message, 'err'); }
}
</script>

<template>
  <div class="flex flex-col gap-[3px]">
    <div
      v-for="f in children"
      :key="f.id"
      class="flex flex-col gap-[3px]"
    >
      <div
        class="group flex items-center gap-0.5 rounded-lg"
        :style="{ paddingLeft: (depth * 14 + 4) + 'px' }"
        :class="store.currentFolder === f.id ? 'bg-accent/15' : 'hover:bg-bg-2'"
      >
        <button
          class="w-4 h-7 shrink-0 flex items-center justify-center text-[10px] text-txt-dim hover:text-txt transition-colors"
          :class="{ 'invisible': folderChildren(f.id).length === 0 }"
          :title="folderChildren(f.id).length ? (store.expandedFolders.has(f.id) ? 'Ciutkan' : 'Bentang') : ''"
          @click.stop="toggleExpand(f.id)"
        >
          {{ store.expandedFolders.has(f.id) ? '▾' : '▸' }}
        </button>

        <button
          class="flex-1 min-w-0 flex items-center gap-1.5 py-1.5 pr-1 text-[13px] text-left rounded-md"
          :class="store.currentFolder === f.id ? 'text-txt font-semibold' : 'text-txt-dim hover:text-txt'"
          @click="openFolder(f.id)"
        >
          <span class="shrink-0">📁</span>
          <span class="truncate">{{ f.name }}</span>
          <span v-if="f.fileCount" class="ml-auto shrink-0 text-[10.5px] bg-black/10 border border-line rounded-full px-1.5 py-px">{{ f.fileCount }}</span>
        </button>

        <div class="hidden group-hover:flex items-center gap-0.5 shrink-0 pr-1">
          <button class="w-5 h-5 flex items-center justify-center text-[10px] text-txt-dim hover:text-accent rounded" title="Subfolder baru" @click.stop="onCreate">➕</button>
          <button class="w-5 h-5 flex items-center justify-center text-[10px] text-txt-dim hover:text-accent rounded" title="Ganti nama" @click.stop="onRename(f)">✏️</button>
          <button class="w-5 h-5 flex items-center justify-center text-[10px] text-txt-dim hover:text-red-400 rounded" title="Hapus folder" @click.stop="onDelete(f)">🗑</button>
        </div>
      </div>

      <div v-if="store.expandedFolders.has(f.id)">
        <FolderSidebar :parent-id="f.id" :depth="props.depth + 1" />
      </div>
    </div>
  </div>
</template>
