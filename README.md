# 📦 tas-web — Web UI & API untuk TAS (Telegram as Storage)

Web wrapper untuk [TAS CLI](https://github.com/ixchio/tas) — ubah bot Telegram jadi
cloud storage gratis & terenkripsi (AES-256-GCM), dengan UI ber-design system **xbook**.

## ✨ Fitur

- **🔐 Auth** — login password (SQLite: users + sessions), API token untuk integrasi
- **🤖 Multi-bot** — kelola beberapa bot Telegram (storage terpisah) + switch kapan saja
- **🔑 API tokens per bot** — token integrasi terikat ke bot tertentu (halaman `/api.html`)
- **🌗 Light mode** — toggle tema terang/gelap (tersimpan di browser)
- **⊞/☰ Tampilan tabel & kartu** — switch view, pilihan tersimpan
- **📤 Multi-upload** — batch upload + progress, drag & drop, upload dari URL
- **▶️ Preview in-browser** — video player & gambar (streaming HTTP Range, seek-able)
- **🔗 Share link** — link kadaluarsa + batas download (publik tanpa login)
- **🗜️ Download ZIP** — pilih banyak file → download jadi satu archive
- **📊 Dashboard** — stats storage, breakdown tipe file, aktivitas, share aktif
- **🔁 Retry upload** — job gagal bisa diulang
- **🗑 Delete hard (multi)** — hapus 1 atau banyak file sekaligus (index + chat Telegram)
- **Anonim di bot** — caption chunk tidak membocorkan nama asli file

## 🏗️ Arsitektur

```
node:20-slim container (multi-stage)
├── @nightowne/tas-cli (global) + 3 patch (caption, chunk 18MB, init env)
├── server.js  → Express (auth SQLite, API, streaming, share, zip)
└── public/    → frontend Vue 3 + Vite + Tailwind (components-first)
                  (dibuild di stage Docker, design system dipertahankan)
```

## 🧑‍💻 Development frontend

```bash
cd frontend
npm install
npm run dev   # dev server + proxy ke localhost:8001
npm run build # build ke dist/
```

## 🚀 Deploy

```bash
cp .env.example .env   # isi TAS_PASSWORD + AUTH_PASSWORD + API_TOKEN
docker compose up -d --build

# init TAS sekali (interaktif — butuh bot token dari @BotFather,
# lalu kirim pesan apa saja ke bot):
docker exec -it tas-web tas init
```

## 🔑 Konfigurasi (`.env`)

| Variable | Fungsi |
|----------|--------|
| `TAS_PASSWORD` | Password enkripsi TAS (wajib) |
| `AUTH_USER` / `AUTH_PASSWORD` | Login web (kosongkan = mode publik) |
| `API_TOKEN` | Token statis untuk integrasi API (`Authorization: Bearer`) |

## 📡 API

| Endpoint | Auth | Fungsi |
|----------|------|--------|
| `POST /api/login` · `POST /api/logout` · `GET /api/me` | – | Auth |
| `GET /api/profiles` · `POST /api/profiles` | ✅ | Daftar / buat bot profile |
| `POST /api/profiles/:id/init` | ✅ | Init bot (token via env TAS_BOT_TOKEN) |
| `POST /api/profiles/:id/switch` · `DELETE /api/profiles/:id` | ✅ | Switch / hapus bot |
| `GET /api/tokens` · `POST /api/tokens` · `DELETE /api/tokens/:id` | ✅ | API token per bot |
| `GET /api/status` · `GET /api/files` | ✅ | Status & daftar file |
| `POST /api/upload` (multi) · `POST /api/upload-url` | ✅ | Upload file / dari URL |
| `POST /api/upload/retry/:jobId` · `GET /api/jobs` | ✅ | Job upload |
| `GET /api/download/:id` | ✅ | Download file |
| `GET /api/stream/:id` | **publik** | Stream (capability URL by hash) |
| `POST /api/delete/:id` | ✅ | Hapus hard |
| `POST /api/share/:id` · `GET /s/:token` · `POST /api/share/revoke/:token` | ✅/publik | Share link |
| `POST /api/zip` | ✅ | Download ZIP multi-file |
| `GET /api/stats` · `GET /api/activity` · `GET /api/shares` | ✅ | Dashboard |
| `GET /api/cache` · `POST /api/cache/clear` | ✅ | Cache streaming |

## 🔌 Integrasi dengan aplikasi lain (mis. xbook-web)

Kirim header `Authorization: Bearer <API_TOKEN>` pada semua panggilan API
(kecuali `/api/stream` & `/s/*` yang publik). Streaming video:
`GET /api/stream/<HASH>` — mendukung HTTP Range (seek).

## 🛡️ Keamanan

- File terenkripsi **AES-256-GCM** sebelum dikirim ke Telegram (zero-knowledge)
- Password di-hash dengan **scrypt** (SQLite, WAL mode)
- Nama asli file **tidak** muncul di chat bot
- `data/` (config + SQLite) jangan pernah di-commit (sudah di `.gitignore`)

## 📄 Lisensi

MIT — kode TAS CLI oleh [ixchio](https://github.com/ixchio/tas).
