// Patch: `tas init` bisa baca token & password dari env (TAS_BOT_TOKEN / TAS_PASSWORD)
// sehingga bisa dijalankan non-interaktif dari server.js (tanpa TTY).
// Kalau env kosong, tetap pakai prompt inquirer seperti biasa.
const fs = require('fs');
const p = '/usr/local/lib/node_modules/@nightowne/tas-cli/src/cli.js';
let s = fs.readFileSync(p, 'utf8');
if (s.includes('process.env.TAS_BOT_TOKEN')) {
  console.log('ℹ️ init sudah ter-patch (env)');
  process.exit(0);
}
const startMarker = '        // Get bot token';
const endMarker = '        // Initialize encryption';
const i = s.indexOf(startMarker);
const j = s.indexOf(endMarker);
if (i < 0 || j < 0 || j <= i) {
  console.error('⚠️ marker init tidak ditemukan — cek source tas-cli!');
  process.exit(1);
}
const replacement = `        // --- patch-init-env: token & password dari env (non-interaktif) ---
        let token = process.env.TAS_BOT_TOKEN || '';
        let password = process.env.TAS_PASSWORD || '';
        let confirmPassword = password;
        if (!token || !password) {
            const q = [
                { type: 'password', name: 'token', message: 'Enter your Telegram bot token:', mask: '*', validate: (input) => input.includes(':') || 'Invalid token format (should contain :)' },
                { type: 'password', name: 'password', message: 'Set your encryption password (used for all files):', mask: '*', validate: (input) => input.length >= 8 || 'Password must be at least 8 characters' },
                { type: 'password', name: 'confirmPassword', message: 'Confirm password:', mask: '*', validate: (input) => input === password || 'Passwords do not match' }
            ].filter((qq) => !(qq.name === 'token' && token) && !(qq.name === 'password' && password) && !(qq.name === 'confirmPassword' && confirmPassword));
            const answers = await inquirer.prompt(q);
            token = answers.token || token;
            password = answers.password || password;
            confirmPassword = answers.confirmPassword || confirmPassword;
        }
        if (!token.includes(':')) throw new Error('Token bot tidak valid');
        if (password.length < 8) throw new Error('Password minimal 8 karakter');
        // --- end patch-init-env ---
`;
s = s.slice(0, i) + replacement + s.slice(j);
fs.writeFileSync(p, s);
console.log('✅ init di-patch: token/password dari env TAS_BOT_TOKEN/TAS_PASSWORD');
