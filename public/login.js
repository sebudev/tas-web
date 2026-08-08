const $ = (s) => document.querySelector(s);

async function login() {
  const btn = $('#login-btn');
  btn.disabled = true;
  $('#err').textContent = '';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('#username').value.trim(), password: $('#password').value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login gagal');
    window.location.href = '/';
  } catch (e) {
    $('#err').textContent = e.message;
    btn.disabled = false;
  }
}

$('#login-btn').addEventListener('click', login);
$('#password').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
$('#username').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#password').focus(); });
