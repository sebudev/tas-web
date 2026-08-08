// Patch: kecilkan ukuran chunk TAS dari 49MB -> 18MB.
// Alasan: Telegram Bot API getFile hanya bisa DOWNLOAD file <= 20MB.
// Upload 49MB boleh, tapi chunk > 20MB tidak bisa di-pull lagi.
// 18MB + overhead enkripsi/kompresi tetap aman di bawah 20MB.
const fs = require('fs');
const p = '/usr/local/lib/node_modules/@nightowne/tas-cli/src/index.js';
let s = fs.readFileSync(p, 'utf8');
const before = 'const TELEGRAM_CHUNK_SIZE = 49 * 1024 * 1024;';
const after = 'const TELEGRAM_CHUNK_SIZE = 18 * 1024 * 1024;';
if (s.includes(before) && !s.includes(after)) {
  s = s.replace(before, after);
  fs.writeFileSync(p, s);
  console.log('✅ chunk size 49MB -> 18MB');
} else if (s.includes(after)) {
  console.log('ℹ️ sudah ter-patch (18MB)');
} else {
  console.log('⚠️ pola chunk size tidak ditemukan, cek source!');
}
