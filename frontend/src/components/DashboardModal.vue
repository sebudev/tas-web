<script setup>
import { onMounted, computed } from 'vue';
import { store, fmtBytes, fmtDateTime } from '../store';
import { loadDashboard } from '../composables/useApp';
import { useAppStore } from '../stores/app';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title } from 'chart.js';
import { Doughnut, Bar } from 'vue-chartjs';
import { Folder, HardDrive, Share2, Trash2, Activity, LayoutDashboard, FileText, Film, Image as ImageIcon, Music, Archive } from '@lucide/vue';
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose } from 'radix-vue';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title);

const emit = defineEmits(['close']);
const piniaStore = useAppStore();

onMounted(async () => { try { await loadDashboard(); } catch {} });

const doughnutData = computed(() => {
 const byType = store.stats?.byType || {};
 const labels = Object.keys(byType);
 const data = Object.values(byType);
 if (!labels.length) return { labels: ['No data'], datasets: [{ data: [1], backgroundColor: ['var(--border)'] }] };
 const colors = ['var(--text)', '#2383E2', '#E03E3E', '#7C6CFF', '#00C853', '#FF8A00', '#0094C2'];
 return {
 labels,
 datasets: [{ data, backgroundColor: labels.map((_, i) => colors[i % colors.length]), borderWidth: 1, borderColor: 'var(--card)', hoverOffset: 4 }],
 };
});
const doughnutOptions = { responsive: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11, family: 'Inter' }, color: 'var(--text-dim)' } } }, cutout: '62%' };

const barData = computed(() => {
 const act = store.activity.slice(0, 7).reverse();
 if (!act.length) return { labels: ['—'], datasets: [{ label: 'Activity', data: [0], backgroundColor: 'var(--border)' }] };
 return {
 labels: act.map(a => new Date(a.ts).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })),
 datasets: [{ label: 'Activity', data: act.map(() => 1), backgroundColor: '#2383E2', borderRadius: 4, barThickness: 14 }],
 };
});
const barOptions = { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: 'var(--text-dim)', font: { size: 10 } } }, y: { display: false } } };
</script>

<template>
 <DialogRoot :open="true" @update:open="(v) => !v && emit('close')">
 <DialogPortal>
 <DialogOverlay class="fixed inset-0 z-[90] bg-[rgba(55,53,47,0.36)] backdrop-blur-[2px]" @click="emit('close')" />
 <DialogContent class="fixed inset-0 z-[100] flex items-center justify-center p-4">
 <div class="w-full max-w-[720px] max-h-[88vh] overflow-hidden bg-white dark:bg-[#1F1F1F] border rounded-[8px] shadow-xl flex flex-col" :style="{ borderColor: 'var(--border)' }">
 <!-- header Notion -->
 <div class="px-5 py-4 border-b flex items-center gap-3" :style="{ borderColor: 'var(--border)', background: 'var(--bg)' }">
 <div class="w-8 h-8 rounded-[6px] bg-[var(--text)] flex items-center justify-center text-white"><LayoutDashboard :size="16" /></div>
 <div>
 <DialogTitle class="text-[14px] font-semibold" :style="{ color: 'var(--text)' }">Dashboard</DialogTitle>
 <DialogDescription class="text-[12px]" :style="{ color: 'var(--text-dim)' }">Ringkasan storage Telegram — Notion style</DialogDescription>
 </div>
 <DialogClose class="ml-auto w-7 h-7 rounded-[6px] border bg-white dark:bg-[#262626] hover:bg-[var(--bg-2)] flex items-center justify-center text-[12px]" :style="{ borderColor: 'var(--border)' }">X</DialogClose>
 </div>

 <div class="flex-1 overflow-y-auto p-5 space-y-5">
 <!-- stats cards Notion -->
 <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
 <div class="rounded-[6px] border p-3 bg-white dark:bg-[#262626] flex items-center gap-3" :style="{ borderColor: 'var(--border)' }">
 <div class="w-8 h-8 rounded-[6px] bg-[var(--bg)] dark:bg-[#333] flex items-center justify-center text-[var(--text)]"><FileText :size="16" /></div>
 <div><div class="text-[18px] font-bold leading-none" :style="{ color: 'var(--text)' }">{{ store.stats?.fileCount || 0 }}</div><div class="text-[11px]" :style="{ color: 'var(--text-dim)' }">File</div></div>
 </div>
 <div class="rounded-[6px] border p-3 bg-white dark:bg-[#262626] flex items-center gap-3" :style="{ borderColor: 'var(--border)' }">
 <div class="w-8 h-8 rounded-[6px] bg-[#2383E214] flex items-center justify-center text-[#2383E2]"><HardDrive :size="16" /></div>
 <div><div class="text-[16px] font-bold leading-none" :style="{ color: 'var(--text)' }">{{ fmtBytes(store.stats?.totalSize) }}</div><div class="text-[11px]" :style="{ color: 'var(--text-dim)' }">Total</div></div>
 </div>
 <div class="rounded-[6px] border p-3 bg-white dark:bg-[#262626] flex items-center gap-3" :style="{ borderColor: 'var(--border)' }">
 <div class="w-8 h-8 rounded-[6px] bg-[#E6F4EA] dark:bg-[#2A4A32] flex items-center justify-center text-[#1A7F37]"><Activity :size="16" /></div>
 <div><div class="text-[18px] font-bold leading-none" :style="{ color: 'var(--text)' }">{{ store.stats?.savingsPercent || 0 }}%</div><div class="text-[11px]" :style="{ color: 'var(--text-dim)' }">Hemat</div></div>
 </div>
 <div class="rounded-[6px] border p-3 bg-white dark:bg-[#262626] flex items-center gap-3" :style="{ borderColor: 'var(--border)' }">
 <div class="w-8 h-8 rounded-[6px] bg-[#FFF1F1] dark:bg-[#3A2222] flex items-center justify-center text-[#E03E3E]"><Share2 :size="16" /></div>
 <div><div class="text-[18px] font-bold leading-none" :style="{ color: 'var(--text)' }">{{ store.stats?.activeShares || 0 }}</div><div class="text-[11px]" :style="{ color: 'var(--text-dim)' }">Share aktif</div></div>
 </div>
 </div>

 <!-- charts -->
 <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
 <div class="rounded-[6px] border p-4 bg-white dark:bg-[#262626]" :style="{ borderColor: 'var(--border)' }">
 <div class="text-[12px] font-semibold mb-3 flex items-center gap-1.5" :style="{ color: 'var(--text)' }"><Archive :size="14" /> Breakdown tipe file</div>
 <Doughnut :data="doughnutData" :options="doughnutOptions" style="max-height: 180px" />
 </div>
 <div class="rounded-[6px] border p-4 bg-white dark:bg-[#262626]" :style="{ borderColor: 'var(--border)' }">
 <div class="text-[12px] font-semibold mb-3 flex items-center gap-1.5" :style="{ color: 'var(--text)' }"><Activity :size="14" /> Aktivitas 7 hari</div>
 <Bar :data="barData" :options="barOptions" style="max-height: 180px" />
 </div>
 </div>

 <!-- byType pills -->
 <div v-if="store.stats?.byType && Object.keys(store.stats.byType).length" class="flex flex-wrap gap-1.5">
 <span v-for="(v,k) in store.stats.byType" :key="k" class="text-[11px] px-2.5 py-1 rounded-full border bg-[var(--bg)] dark:bg-[#1F1F1F] flex items-center gap-1" :style="{ borderColor: 'var(--border)', color: 'var(--text)' }">
 <Film v-if="k.includes('video') || k.includes('mp4')" :size="12" />
 <ImageIcon v-else-if="k.includes('image')" :size="12" />
 <Music v-else-if="k.includes('audio')" :size="12" />
 <Archive v-else :size="12" />
 {{ k }} · {{ v }}
 </span>
 </div>

 <!-- activity TanStack-ready table -->
 <div>
 <div class="text-[12px] font-semibold mb-2 flex items-center gap-1.5" :style="{ color: 'var(--text)' }"><Activity :size="14" /> Aktivitas terakhir</div>
 <div class="border rounded-[6px] overflow-hidden" :style="{ borderColor: 'var(--border)' }">
 <div v-if="!store.activity.length" class="p-3 text-[12px] text-center" :style="{ color: 'var(--text-dim)' }">Belum ada aktivitas</div>
 <div v-for="a in store.activity.slice(0,8)" :key="a.id" class="px-3 py-2 border-b last:border-0 flex gap-2 text-[12px] hover:bg-[var(--bg)] dark:hover:bg-[#262626]" :style="{ borderColor: 'var(--border)' }">
 <span class="text-[11px] whitespace-nowrap" :style="{ color: '#9B9A97' }">{{ fmtDateTime(a.ts) }}</span>
 <span class="truncate" :style="{ color: 'var(--text)' }"><span class="font-medium">{{ a.action }}</span> — {{ a.detail }}</span>
 </div>
 </div>
 </div>

 <div>
 <div class="text-[12px] font-semibold mb-2" :style="{ color: 'var(--text)' }">Share link aktif</div>
 <div class="border rounded-[6px] overflow-hidden" :style="{ borderColor: 'var(--border)' }">
 <div v-if="!store.shares.length" class="p-3 text-[12px] text-center" :style="{ color: 'var(--text-dim)' }">Tidak ada share link</div>
 <div v-for="s in store.shares.slice(0,5)" :key="s.token" class="px-3 py-2 border-b last:border-0 flex gap-2 text-[12px]" :style="{ borderColor: 'var(--border)' }">
 <span class="truncate" :style="{ color: 'var(--text)' }">{{ s.filename }} · {{ s.downloads }}/{{ s.max_downloads }}x · {{ Math.round((s.expires_at - Date.now())/3600000) }}j lagi</span>
 </div>
 </div>
 </div>
 </div>
 </div>
 </DialogContent>
 </DialogPortal>
 </DialogRoot>
</template>
