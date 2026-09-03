<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiPost } from '../composables/useApi';
import { store } from '../store';
import { toast } from '../composables/useToast';

const router = useRouter();
const username = ref('');
const password = ref('');
const busy = ref(false);
const showPw = ref(false);

async function login() {
 if (!username.value || !password.value) return toast('Isi username & password', 'err');
 busy.value = true;
 try {
 const data = await apiPost('/api/login', { username: username.value, password: password.value });
 store.user = data;
 router.replace('/');
 } catch (e) {
 toast(e.message, 'err');
 }
 busy.value = false;
}
</script>

<template>
 <div class="min-h-screen flex bg-[var(--bg)] dark:bg-[#191919]">
 <!-- left branding -->
 <div class="hidden lg:flex w-[44%] max-w-[520px] flex-col justify-between p-10 border-r" :style="{ background: '#37352F', borderColor: '#2F2F2F', color: 'var(--card)' }">
 <div>
 <div class="flex items-center gap-2.5">
 <div class="w-9 h-9 rounded-[10px] bg-white flex items-center justify-center text-[16px]">✈️</div>
 <span class="font-bold text-[18px] tracking-tight">Telegram Storage</span>
 <span class="text-[11px] px-1.5 py-0.5 rounded bg-white/15 border border-white/20">Notion style</span>
 </div>
 <h1 class="mt-10 text-[28px] font-bold leading-tight tracking-tight">
 File manager<br>untuk Telegram.<br><span class="text-white/60">Gratis, terenkripsi,</span><br>tanpa batas.
 </h1>
 <p class="mt-4 text-[13.5px] leading-relaxed text-white/70 max-w-[360px]">
 Simpan file terenkripsi AES-256-GCM di chat bot Telegram. Kelola seperti Google Drive — folder, share link, stream, sampai S3 gateway.
 </p>

 <div class="mt-8 space-y-3 text-[13px]">
 <div class="flex items-center gap-2.5 text-white/90"><span class="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-[13px]"></span> Enkripsi zero-knowledge — server tidak bisa baca file</div>
 <div class="flex items-center gap-2.5 text-white/90"><span class="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-[13px]"></span> Folder virtual & multi-bot workspace</div>
 <div class="flex items-center gap-2.5 text-white/90"><span class="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-[13px]"></span> Share link + stream + S3 compatible</div>
 </div>
 </div>

 <div class="flex items-center gap-2 text-[11px] text-white/40">
 <span>© {{ new Date().getFullYear() }} Telegram Storage</span>
 <span class="opacity-30">·</span>
 <span>Powered by TAS</span>
 </div>
 </div>

 <!-- right form -->
 <div class="flex-1 flex items-center justify-center p-4 sm:p-8" :style="{ background: 'var(--card)' }" >
 <div class="w-full max-w-[380px]">
 <!-- mobile logo -->
 <div class="lg:hidden flex items-center gap-2 mb-6">
 <div class="w-8 h-8 rounded-[8px] bg-[var(--text)] flex items-center justify-center text-white text-[14px]">✈️</div>
 <span class="font-bold text-[16px]" :style="{ color: 'var(--text)' }">Telegram Storage</span>
 </div>

 <div class="mb-6">
 <h2 class="text-[22px] font-bold tracking-tight" :style="{ color: 'var(--text)' }">Masuk</h2>
 <p class="text-[13px] mt-1" :style="{ color: 'var(--text-dim)' }">Telegram as Storage — masuk untuk melanjutkan</p>
 </div>

 <div class="space-y-3">
 <div>
 <label class="text-[12px] font-medium" :style="{ color: 'var(--text)' }">Username</label>
 <input
 v-model="username"
 class="mt-1.5 w-full px-3 py-2.5 rounded-[6px] border text-[14px] outline-none placeholder:text-[#9B9A97] focus:border-[#2383E2] focus:bg-white transition"
 :style="{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text)' }"
 placeholder="admin"
 autocomplete="username"
 @keydown.enter="$refs.pwInput?.focus()"
 />
 </div>

 <div>
 <label class="text-[12px] font-medium" :style="{ color: 'var(--text)' }">Password</label>
 <div class="mt-1.5 relative">
 <input
 ref="pwInput"
 v-model="password"
 :type="showPw ? 'text' : 'password'"
 class="w-full px-3 py-2.5 pr-9 rounded-[6px] border text-[14px] outline-none placeholder:text-[#9B9A97] focus:border-[#2383E2] focus:bg-white transition"
 :style="{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text)' }"
 placeholder="••••••••"
 autocomplete="current-password"
 @keydown.enter="login"
 />
 <button class="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded flex items-center justify-center text-[12px] hover:bg-[var(--bg-2)]" :style="{ color: 'var(--text-dim)' }" @click="showPw = !showPw" :title="showPw ? 'Hide' : 'Show'">{{ showPw ? '🙈' : '' }}</button>
 </div>
 </div>

 <button
 class="w-full py-2.5 rounded-[6px] font-semibold text-[14px] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
 :style="{ background: 'var(--text)', color: 'var(--card)' }"
 :disabled="busy"
 @click="login"
 >
 <span v-if="busy" class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
 <span v-else></span>
 {{ busy ? 'Memproses...' : 'Masuk' }}
 </button>

 <div class="flex items-center gap-2 text-[11px] pt-1" :style="{ color: '#9B9A97' }">
 <span class="w-1.5 h-1.5 rounded-full bg-[#2383E2]"></span>
 Mode Notion · Aman & terenkripsi
 <span class="ml-auto">Lupa password? hubungi admin</span>
 </div>
 </div>

 <div class="mt-8 pt-4 border-t text-center text-[11px]" :style="{ borderColor: 'var(--border)', color: '#9B9A97' }">
 Belum punya akun? Buat di server via <code class="px-1.5 py-0.5 rounded border text-[11px] font-mono" :style="{ background: 'var(--bg)', borderColor: 'var(--border)' }">AUTH_PASSWORD</code>
 </div>
 </div>
 </div>
 </div>
</template>
