<script setup>
import { ref, computed } from 'vue';
import { FlexRender, getCoreRowModel, getSortedRowModel, useVueTable, createColumnHelper } from '@tanstack/vue-table';
import { store, fmtBytes, fmtDate } from '../store';
import { folderById } from '../composables/useApp';
import { ArrowUpDown, Download, Link2, Trash2, Folder as FolderIcon, Bot } from '@lucide/vue';

const props = defineProps({ items: { type: Array, default: () => [] } });
const emit = defineEmits(['open', 'context']);
const sorting = ref([]);

const columnHelper = createColumnHelper();

const columns = [
 columnHelper.accessor('filename', {
 header: 'Name',
 cell: info => info.getValue() || info.row.original.hash,
 enableSorting: true,
 }),
 columnHelper.accessor('original_size', {
 header: 'Size',
 cell: info => fmtBytes(info.getValue()),
 enableSorting: true,
 }),
 columnHelper.display({
 id: 'folder',
 header: 'Folder',
 cell: info => {
 const fid = store.fileFolder[info.row.original.hash];
 const f = fid ? folderById(fid) : null;
 return f ? `${f.name}` : '—';
 },
 }),
 columnHelper.accessor('profileName', {
 header: 'Bot',
 cell: info => info.getValue() ? `${info.getValue()}` : '—',
 }),
 columnHelper.accessor('created_at', {
 header: 'Modified',
 cell: info => fmtDate(info.getValue()),
 enableSorting: true,
 }),
];

const table = useVueTable({
 get data() { return props.items; },
 columns,
 state: { get sorting() { return sorting.value; } },
 onSortingChange: updater => { sorting.value = typeof updater === 'function' ? updater(sorting.value) : updater; },
 getCoreRowModel: getCoreRowModel(),
 getSortedRowModel: getSortedRowModel(),
});

function onRowClick(row, e) {
 if (e.target.closest('button')) return;
 const idx = props.items.findIndex(f => f.hash === row.original.hash);
 emit('open', idx);
}
function onContext(row, e) {
 e.preventDefault();
 emit('context', { file: row.original, x: e.clientX, y: e.clientY });
}
</script>

<template>
 <div class="border rounded-[6px] overflow-hidden bg-white dark:bg-[#1F1F1F]" :style="{ borderColor: 'var(--border)' }">
 <div class="overflow-x-auto">
 <table class="w-full border-collapse text-[13px] min-w-[640px]">
 <thead class="bg-[#F7F7F5] dark:bg-[#1F1F1F] sticky top-0">
 <tr v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
 <th v-for="header in headerGroup.headers" :key="header.id" class="px-3 py-2 text-left text-[11px] font-medium tracking-wide border-b whitespace-nowrap select-none" :style="{ borderColor: 'var(--border)', color: 'var(--text-dim)' }" :class="header.column.getCanSort() ? 'cursor-pointer hover:text-[#37352F]' : ''" @click="header.column.getToggleSortingHandler()?.($event)">
 <span v-if="!header.isPlaceholder" class="flex items-center gap-1">
 <FlexRender :render="header.column.columnDef.header" :props="header.getContext()" />
 <ArrowUpDown v-if="header.column.getCanSort()" :size="12" class="opacity-40" />
 </span>
 </th>
 </tr>
 </thead>
 <tbody>
 <tr v-for="row in table.getRowModel().rows" :key="row.id" class="border-b last:border-0 hover:bg-[#F7F7F5] dark:hover:bg-[#262626] cursor-pointer transition-colors" :style="{ borderColor: 'var(--border)' }" @click="onRowClick(row, $event)" @contextmenu="onContext(row, $event)">
 <td v-for="cell in row.getVisibleCells()" :key="cell.id" class="px-3 py-2 align-middle">
 <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
 </td>
 </tr>
 <tr v-if="!table.getRowModel().rows.length">
 <td :colspan="columns.length" class="px-3 py-6 text-center text-[13px]" :style="{ color: 'var(--text-dim)' }">No files</td>
 </tr>
 </tbody>
 </table>
 </div>
 <div class="px-3 py-2 border-t flex items-center justify-between text-[11px]" :style="{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-dim)' }">
 <span>TanStack Table · {{ table.getRowModel().rows.length }} rows · sorted by {{ sorting[0]?.id || '—' }}</span>
 <span class="hidden sm:inline">Shift+click header to multi-sort</span>
 </div>
 </div>
</template>
