#!/usr/bin/env node
/**
 * Patch TAS CLI: anonimkan caption chunk di chat bot.
 * Nama asli file TIDAK boleh muncul di chat Telegram (privasi).
 * Nama file tetap tersimpan normal di index app (via --name).
 */
const { execSync } = require('child_process');
const fs = require('fs');

const p = execSync('npm root -g').toString().trim() + '/@nightowne/tas-cli/src/index.js';
if (!fs.existsSync(p)) {
  console.error('❌ index.js TAS tidak ditemukan:', p);
  process.exit(1);
}

let s = fs.readFileSync(p, 'utf8');
const before = s;

s = s.replace(
  '`📦 ${filename} (${chunkIndex + 1}/${totalChunks})`',
  '`📦 ${hash.substring(0, 12)} (${chunkIndex + 1}/${totalChunks})`'
).replace(
  '`📦 ${filename}`',
  '`📦 ${hash.substring(0, 12)}`'
);

if (s === before) {
  console.error('❌ Pattern caption tidak ditemukan — patch GAGAL');
  process.exit(1);
}

fs.writeFileSync(p, s);
console.log('✅ Caption chunk di-anonimkan: nama asli tidak bocor ke chat bot');
