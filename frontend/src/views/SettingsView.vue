<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { apiGet, apiPost } from '../composables/useApi';
import { toast } from '../composables/useToast';
import SelectRadix from '../components/ui/SelectRadix.vue';
import { ArrowLeft, Bot, Save, FlaskConical, Check, KeyRound, Zap, SlidersHorizontal, Activity } from '@lucide/vue';

const router = useRouter();
const models = ref([]);
const provider = ref('opencode-go');
const keyOk = ref(false);
const quotaNote = ref('');
const usage = ref(null);
const loading = ref(true);

const model = ref('glm-5.3-flash');
const temperature = ref(1);
const top_p = ref(1);
const max_tokens = ref(2048);
const reasoning = ref('');
const system_prompt = ref('');

const testMsg = ref('Balas dengan OK');
const testBusy = ref(false);
const testReply = ref('');
const saveBusy = ref(false);

const selModel = computed(() => models.value.find((m) => m.id === model.value) || null);
const reasoningOpts = computed(() => {
  const vs = selModel.value?.thinking?.values || [];
  return [{ value: '', label: 'Default gateway' }, ...vs.map((v) => ({ value: v, label: v }))];
});
const reasoningDisabled = computed(() => !(selModel.value?.thinking?.values?.length));

function fmtPct(u) {
  if (!u || u.percent == null) return '—';
  return u.percent + '%';
}

async function loadAll() {
  loading.value = true;
  try {
    const m = await apiGet('/api/ai/models');
    models.value = m.models || [];
    provider.value = m.provider || 'opencode-go';
    keyOk.value = !!m.keyConfigured;
    quotaNote.value = m.quotaNote || '';
  } catch (e) { toast('Gagal load model: ' + e.message, 'err'); }
  try {
    const s = await apiGet('/api/ai/settings');
    model.value = s.model || 'glm-5.3-flash';
    temperature.value = s.temperature ?? 1;
    top_p.value = s.top_p ?? 1;
    max_tokens.value = s.max_tokens ?? 2048;
    reasoning.value = s.reasoning || '';
    system_prompt.value = s.system_prompt || '';
    keyOk.value = !!s.keyConfigured;
  } catch {}
  try {
    const u = await apiGet('/api/ai/usage');
    usage.value = u.usage || null;
  } catch {}
  loading.value = false;
}

async function onPick(id) {
  model.value = id;
  reasoning.value = '';
}

async function save() {
  saveBusy.value = true;
  try {
    await apiPost('/api/ai/settings', {
      model: model.value,
      temperature: temperature.value,
      top_p: top_p.value,
      max_tokens: max_tokens.value,
      reasoning: reasoningDisabled.value ? '' : reasoning.value,
      system_prompt: system_prompt.value,
    });
    toast('Settings model tersimpan', 'ok');
  } catch (e) { toast('Gagal simpan: ' + e.message, 'err'); }
  saveBusy.value = false;
}

async function test() {
  testBusy.value = true;
  testReply.value = '';
  try {
    const r = await apiPost('/api/ai/chat', { messages: [{ role: 'user', content: testMsg.value || 'Balas dengan OK' }] });
    testReply.value = r.reply || '(kosong)';
    toast('Test jalan via ' + r.model, 'ok');
  } catch (e) { toast('Test gagal: ' + e.message, 'err'); }
  testBusy.value = false;
}

onMounted(loadAll);
</script>

<template>
  <div class="min-h-screen" :style="{ background: 'var(--bg)' }">
    <header class="h-[45px] shrink-0 flex items-center gap-2 px-3 border-b bg-white dark:bg-[#191919] sticky top-0 z-20" :style="{ borderColor: 'var(--border)' }">
      <div class="flex items-center gap-2">
        <span class="w-7 h-7 rounded-[8px] bg-[#37352F] dark:bg-[#E9E9E7] flex items-center justify-center text-white dark:text-[#37352F] text-[12px] font-bold">T</span>
        <span class="font-bold text-[14px]" :style="{ color: 'var(--text)' }">Telegram Storage</span>
        <span class="hidden sm:inline text-[12px] px-1.5 py-0.5 rounded border bg-[var(--bg)]" :style="{ borderColor: 'var(--border)', color: 'var(--text-dim)' }">/ settings</span>
      </div>
      <button class="ml-auto btn-secondary" @click="router.push('/')"><ArrowLeft :size="14" /> Beranda</button>
    </header>

    <main class="max-w-[900px] mx-auto px-3 sm:px-6 py-6 space-y-6">
      <!-- Provider -->
      <div class="rounded-[8px] border bg-white dark:bg-[#1F1F1F] overflow-hidden" :style="{ borderColor: 'var(--border)' }">
        <div class="px-4 py-3 border-b flex items-center gap-2" :style="{ borderColor: 'var(--border)', background: 'var(--bg)' }">
          <div class="w-7 h-7 rounded-[6px] bg-[#2383E2] flex items-center justify-center text-white"><Bot :size="14" /></div>
          <div>
            <div class="text-[13px] font-semibold" :style="{ color: 'var(--text)' }">Provider AI</div>
            <div class="text-[11px] font-mono" :style="{ color: 'var(--text-dim)' }">{{ provider }} · zen/go/v1</div>
          </div>
          <span class="ml-auto text-[11px] px-2 py-1 rounded-full border inline-flex items-center gap-1" :style="keyOk ? { background: '#E6F4EA', borderColor: '#A7E0B5', color: '#1A7F37' } : { background: '#FFF1F1', borderColor: '#FFD0D0', color: '#E03E3E' }">
            <KeyRound :size="11" /> {{ keyOk ? 'key Hermes aktif' : 'key belum di-set' }}
          </span>
        </div>
        <div class="p-4 grid grid-cols-3 gap-2">
          <div v-for="k in [['rolling','5 jam'],['weekly','Mingguan'],['monthly','Bulanan']]" :key="k[0]" class="rounded-[6px] border p-3" :style="{ borderColor: 'var(--border)', background: 'var(--card)' }">
            <div class="text-[18px] font-bold" :style="{ color: 'var(--text)' }">{{ loading ? '…' : fmtPct(usage?.[k[0]]) }}</div>
            <div class="text-[11px] flex items-center gap-1" :style="{ color: 'var(--text-dim)' }"><Activity :size="10" /> {{ k[1] }}</div>
            <div class="h-1.5 rounded-full mt-2 overflow-hidden" style="background:var(--border)">
              <div class="h-full rounded-full bg-[#2383E2]" :style="{ width: Math.min(100, usage?.[k[0]]?.percent ?? 0) + '%' }"></div>
            </div>
          </div>
        </div>
        <div class="px-4 pb-3 text-[11px]" :style="{ color: 'var(--text-dim)' }">{{ quotaNote }}</div>
      </div>

      <!-- Model picker -->
      <div class="rounded-[8px] border bg-white dark:bg-[#1F1F1F] overflow-hidden" :style="{ borderColor: 'var(--border)' }">
        <div class="px-4 py-3 border-b flex items-center gap-2" :style="{ borderColor: 'var(--border)', background: 'var(--bg)' }">
          <div class="w-7 h-7 rounded-[6px] bg-[#37352F] dark:bg-[#E9E9E7] flex items-center justify-center text-white dark:text-[#37352F]"><Zap :size="14" /></div>
          <div>
            <div class="text-[13px] font-semibold" :style="{ color: 'var(--text)' }">Model AI — kurasi quota gede</div>
            <div class="text-[11px]" :style="{ color: 'var(--text-dim)' }">{{ models.length }} model · cap $60/bln · urut request terbanyak</div>
          </div>
        </div>
        <div class="p-4">
          <div v-if="loading" class="text-[13px]" :style="{ color: 'var(--text-dim)' }">Memuat model…</div>
          <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              v-for="m in models"
              :key="m.id"
              class="text-left p-3 rounded-[6px] border transition-colors"
              :style="model===m.id ? { borderColor: '#2383E2', background: '#2383E20D', boxShadow: '0 0 0 1px #2383E2' } : { borderColor: 'var(--border)', background: 'var(--card)' }"
              @click="onPick(m.id)"
            >
              <div class="flex items-center gap-2">
                <span class="font-semibold text-[13px]" :style="{ color: 'var(--text)' }">{{ m.name }}</span>
                <span class="ml-auto text-[10px] px-1.5 py-0.5 rounded-full border font-medium whitespace-nowrap" :style="{ background: '#E6F4EA', borderColor: '#A7E0B5', color: '#1A7F37' }">{{ m.quota }}</span>
              </div>
              <div class="mt-1.5 flex items-center gap-1.5 text-[11px]" :style="{ color: 'var(--text-dim)' }">
                <span class="font-mono">{{ m.id }}</span>
                <span class="px-1 py-px rounded border" :style="{ borderColor: 'var(--border)' }">{{ m.ep }}</span>
              </div>
              <div class="mt-1 text-[11px]" :style="{ color: 'var(--text-dim)' }">${{ m.costIn }}/{{ m.costOut }} per 1M · cap $60/bln</div>
            </button>
          </div>
        </div>
      </div>

      <!-- Advanced -->
      <div class="rounded-[8px] border bg-white dark:bg-[#1F1F1F] overflow-hidden" :style="{ borderColor: 'var(--border)' }">
        <div class="px-4 py-3 border-b flex items-center gap-2" :style="{ borderColor: 'var(--border)', background: 'var(--bg)' }">
          <div class="w-7 h-7 rounded-[6px] bg-[#7C6CFF] flex items-center justify-center text-white"><SlidersHorizontal :size="14" /></div>
          <div>
            <div class="text-[13px] font-semibold" :style="{ color: 'var(--text)' }">Advanced settings</div>
            <div class="text-[11px] font-mono" :style="{ color: 'var(--text-dim)' }">{{ selModel?.id || '—' }} · {{ selModel?.ep || '' }}</div>
          </div>
        </div>
        <div class="p-4 space-y-4">
          <div>
            <div class="flex justify-between text-[12px] font-medium" :style="{ color: 'var(--text)' }"><span>Temperature</span><span class="font-mono">{{ temperature }}</span></div>
            <input v-model.number="temperature" type="range" min="0" max="2" step="0.1" class="w-full accent-[#2383E2]" />
          </div>
          <div>
            <div class="flex justify-between text-[12px] font-medium" :style="{ color: 'var(--text)' }"><span>Top P</span><span class="font-mono">{{ top_p }}</span></div>
            <input v-model.number="top_p" type="range" min="0" max="1" step="0.05" class="w-full accent-[#2383E2]" />
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="text-[12px] font-medium" :style="{ color: 'var(--text)' }">Max tokens</label>
              <input v-model.number="max_tokens" type="number" min="1" max="131072" class="mt-1.5 w-full px-3 py-1.5 rounded-[6px] border bg-[var(--bg)] text-[13px] outline-none focus:border-[#2383E2]" :style="{ borderColor: 'var(--border)', color: 'var(--text)' }" />
              <div v-if="selModel?.ep==='responses'" class="text-[11px] mt-1" :style="{ color: 'var(--text-dim)' }">Responses API: cap output diabaikan (diatur gateway).</div>
            </div>
            <div>
              <label class="text-[12px] font-medium" :style="{ color: 'var(--text)' }">Reasoning effort</label>
              <SelectRadix v-model="reasoning" :options="reasoningOpts" :title="reasoningDisabled ? 'Model ini tanpa effort setting (diatur gateway)' : 'Pilih effort'" class="mt-1.5 w-full" />
              <div v-if="reasoningDisabled" class="text-[11px] mt-1" :style="{ color: 'var(--text-dim)' }">Model ini tanpa effort setting — pakai default gateway.</div>
            </div>
          </div>
          <div>
            <label class="text-[12px] font-medium" :style="{ color: 'var(--text)' }">System prompt</label>
            <textarea v-model="system_prompt" rows="3" placeholder="Instruksi default untuk model…" class="mt-1.5 w-full px-3 py-2 rounded-[6px] border bg-[var(--bg)] text-[13px] outline-none focus:border-[#2383E2] resize-y" :style="{ borderColor: 'var(--border)', color: 'var(--text)' }"></textarea>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class="btn-primary" :disabled="saveBusy" @click="save"><Save :size="14" /> {{ saveBusy ? 'Menyimpan…' : 'Simpan' }}</button>
            <button class="btn-secondary" :disabled="testBusy" @click="test"><FlaskConical :size="14" /> {{ testBusy ? 'Testing…' : 'Test' }}</button>
          </div>
          <div>
            <label class="text-[12px] font-medium" :style="{ color: 'var(--text)' }">Test prompt</label>
            <input v-model="testMsg" class="mt-1.5 w-full px-3 py-1.5 rounded-[6px] border bg-[var(--bg)] text-[13px] outline-none focus:border-[#2383E2]" :style="{ borderColor: 'var(--border)', color: 'var(--text)' }" @keydown.enter="test" />
          </div>
          <div v-if="testReply" class="rounded-[6px] border p-3 text-[13px] whitespace-pre-wrap" :style="{ background: '#E6F4EA', borderColor: '#A7E0B5', color: '#1A7F37' }">
            <div class="flex items-center gap-1.5 font-semibold mb-1"><Check :size="14" /> Reply</div>
            {{ testReply }}
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
