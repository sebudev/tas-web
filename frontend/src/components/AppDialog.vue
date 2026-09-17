<script setup>
import { ref, computed, watch } from 'vue';
import { store } from '../store';
import { appById, currentAppBots, renameApp, deleteApp, attachBot, detachBot } from '../composables/useApp';
import { toast } from '../composables/useToast';
import { confirmDialog } from '../composables/useConfirm';
import { useEscape } from '../composables/useEscape';
import { X, Settings } from '@lucide/vue';

const emit = defineEmits(['close']);
useEscape(() => emit('close'));

const app = computed(() => appById(store.currentApp));
const name = ref(app.value?.name || '');
watch(app, (a) => { name.value = a?.name || ''; });
const attached = computed(() => currentAppBots());
const available = computed(() => store.profiles.filter((p) => !(app.value?.bots || []).includes(p.id)));

async function onRename() {
 const n = name.value.trim();
 if (!n || !app.value || n === app.value.name) return;
 try { await renameApp(app.value.id, n); toast('App di-rename', 'ok'); }
 catch (e) { toast('Gagal: ' + e.message, 'err'); }
}

async function onAttach(profileId) {
 try { await attachBot(app.value.id, profileId); toast('Bot ditambahkan ke app', 'ok'); }
 catch (e) { toast('Gagal: ' + e.message, 'err'); }
}

async function onDetach(p) {
 if (!app.value) return;
 const ok = await confirmDialog({
 title: 'Lepas bot?',
 message: `Lepas bot "${p.name}" dari app "${app.value.name}"?\n\nFile di bot TIDAK terhapus — bot tetap bisa dipakai di app lain.`,
 confirmText: 'Lepas',
 });
 if (!ok) return;
 try { await detachBot(app.value.id, p.id); toast('Bot dilepas dari app', 'ok'); }
 catch (e) { toast('Gagal: ' + e.message, 'err'); }
}

async function onDelete() {
 if (!app.value) return;
 const ok = await confirmDialog({
 title: 'Hapus app?',
 message: `Hapus app "${app.value.name}"?\n\nBot, file, dan storage TIDAK terhapus — cuma grup & API key app ini yang dibuang.`,
 confirmText: 'Hapus App',
 });
 if (!ok) return;
 try { await deleteApp(app.value.id); emit('close'); }
 catch (e) { toast('Gagal: ' + e.message, 'err'); }
}
</script>

<template>
 <div class="fixed inset-0 z-[150]">
 <div class="modal-backdrop" @click="emit('close')"></div>
 <div class="fixed inset-0 z-[100] flex items-center justify-center p-5 pointer-events-none">
 <div v-focus-trap role="dialog" aria-modal="true" aria-label="Kelola app" class="relative pointer-events-auto w-full max-w-[430px] bg-card border border-line rounded-xl2 p-5 shadow-2xl max-h-[85vh] overflow-y-auto">
 <h3 class="text-[15px] font-semibold mb-3 flex items-center gap-2 pr-8" :style="{ color: 'var(--text)' }"><Settings :size="16" class="shrink-0" /><span class="truncate">App: {{ app?.name || '—' }}</span></h3>

 <label class="block text-xs text-txt-dim mb-1">Nama app</label>
 <div class="flex gap-2 mb-4">
 <input v-model="name" class="input" placeholder="Nama app" @keydown.enter="onRename" />
 <button class="btn-secondary shrink-0" @click="onRename">Rename</button>
 </div>

 <div class="text-[11px] text-txt-dim font-semibold uppercase tracking-wide mb-1.5">Bot di app ini ({{ attached.length }})</div>
 <div class="border border-line rounded-xl bg-bg-2 p-2 mb-3 flex flex-col gap-1">
 <div v-if="!attached.length" class="text-[12px] text-txt-dim py-1 px-1">Belum ada bot — tambahkan dari daftar bawah.</div>
 <div v-for="p in attached" :key="p.id" class="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px]">
 <span class="truncate">{{ p.name }}{{ p.botUsername ? ' (@' + p.botUsername + ')' : '' }}</span>
 <button class="ml-auto shrink-0 text-[11px] px-2 py-0.5 rounded-md bg-red-500/10 text-red-500 border border-red-500/40 hover:brightness-125" @click="onDetach(p)">Lepas</button>
 </div>
 </div>

 <div class="text-[11px] text-txt-dim font-semibold uppercase tracking-wide mb-1.5">➕ Bot lain yang tersedia</div>
 <div class="border border-line rounded-xl bg-bg-2 p-2 flex flex-col gap-1">
 <div v-if="!available.length" class="text-[12px] text-txt-dim py-1 px-1">Semua bot sudah ada di app ini.</div>
 <div v-for="p in available" :key="p.id" class="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px]">
 <span class="truncate">{{ p.name }}{{ p.botUsername ? ' (@' + p.botUsername + ')' : '' }}</span>
 <button class="ml-auto shrink-0 text-[11px] px-2 py-0.5 rounded-md bg-accent/15 text-accent border border-accent/40 hover:brightness-125" @click="onAttach(p.id)">+ Tambah</button>
 </div>
 </div>

 <div class="flex justify-between mt-4">
 <button class="btn-danger" @click="onDelete">Hapus App</button>
 <button class="btn-secondary" @click="emit('close')">Tutup</button>
 </div>
 <button class="dialog-close" @click="emit('close')" aria-label="Tutup"><X :size="16" /></button>
 </div>
 </div>
 </div>
</template>
