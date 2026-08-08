# 📦 tas-web — Web UI & API untuk TAS (Telegram as Storage)

Web wrapper untuk [TAS CLI](https://github.com/ixchio/tas) — ubah bot Telegram jadi
cloud storage gratis & terenkripsi (AES-256-GCM), dengan UI ber-design system **xbook**.

## ✨ Fitur

- **Upload / Download / Delete** file via web UI (drag & drop)
- **Streaming video** — HTTP Range support (seek/jump), cache di disk
- **JSON API** dengan CORS — siap diintegrasikan aplikasi lain (mis. xbook-web)
- **Anonim di bot** — caption chunk tidak membocorkan nama asli file
- CLI TAS didukung penuh: list, status, pull, delete (hard)

## 🏗️ Arsitektur

```
node:20-slim container
├── @nightowne/tas-cli (global) + patch caption anonim
├── server.js  → Express wrapper (subprocess `tas`)
└── public/    → frontend design system xbook
```

## 🚀 Deploy

```bash
cp .env.example .env   # isi TAS_PASSWORD (password enkripsi TAS)
docker compose up -d --build

# init sekali (interaktif — butuh bot token dari @BotFather,
# lalu kirim pesan apa saja ke bot):
docker exec -it tas-web tas init
```

## 📡 API

| Endpoint | Fungsi |
|----------|--------|
| `GET /api/status` | Status TAS (initialized, user, jumlah file) |
| `GET /api/files` | Daftar file (JSON) |
| `POST /api/upload` | Upload file (multipart `file`) → `jobId` |
| `GET /api/jobs` | Status job upload |
| `GET /api/download/:id` | Download file (by hash/nama) |
| `GET /api/stream/:id` | **Stream video** dengan Range support |
| `POST /api/delete/:id` | Hapus file (hard — termasuk dari Telegram) |
| `GET /api/cache` · `POST /api/cache/clear` | Kelola cache streaming |

## 🔌 Integrasi xbook-web

xbook-web bisa menyimpan hasil download ke TAS (opsional via halaman settings)
dan streaming video lewat `GET /api/stream/:id`:

```
http://<host>:<port>/api/stream/<HASH>   ← dipakai <video src>
```

## 🛡️ Keamanan

- File terenkripsi **AES-256-GCM** sebelum dikirim ke Telegram (zero-knowledge)
- Password enkripsi via env `TAS_PASSWORD` (jangan commit!)
- Nama asli file **tidak** muncul di chat bot (caption = hash saja)
- `data/` (config + index SQLite) jangan pernah di-commit (sudah di `.gitignore`)

## 📄 Lisensi

MIT — kode TAS CLI oleh [ixchio](https://github.com/ixchio/tas).
