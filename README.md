# 📦 tas-web — Web UI & API untuk TAS (Telegram as Storage)

Web wrapper untuk [TAS CLI](https://github.com/ixchio/tas) — ubah bot Telegram jadi
cloud storage gratis & terenkripsi (AES-256-GCM), dengan UI ber-design system **xbook**.

## ✨ Fitur

- **🔐 Auth** — login password (SQLite: users + sessions), API token untuk integrasi
- **🤖 Multi-bot** — kelola beberapa bot Telegram (storage terpisah) + switch kapan saja
- **📦 Layer App (workspace)** — kelompokkan bot jadi app; API token & folder bisa di-scope per app
- **🗂️ Folder virtual** (model Google Drive) — folder bertingkat, 1 file di 1 folder; file asli tetap di Telegram
- **🗄️ S3-compatible gateway** — endpoint `/s3` path-style + AWS SigV4; 1 bot = 1 bucket; bisa dipakai rclone / SDK S3
- **📥 Bot ingest** — kirim file langsung ke bot → otomatis masuk storage (pesan asli dihapus, limit 20MB)
- **🔑 API tokens per bot** — token integrasi terikat ke bot/app tertentu (halaman `/api.html`)
- **🌗 Light mode** — toggle tema terang/gelap (tersimpan di browser)
- **⊞/☰ Tampilan tabel & kartu** — switch view, pilihan tersimpan
- **📤 Multi-upload** — batch upload + progress, drag & drop, upload dari URL
- **▶️ Preview in-browser** — video player & gambar (streaming HTTP Range, seek-able)
- **🔗 Share link** — link kadaluarsa + batas download (publik tanpa login)
- **🗜️ Download ZIP** — pilih banyak file → download jadi satu archive
- **📊 Dashboard** — stats storage, breakdown tipe file, aktivitas, share aktif
- **🔁 Retry upload** — job gagal bisa diulang
- **🗑 Delete hard (multi)** — hapus 1 atau banyak file sekaligus (index + chat Telegram)
- **🖥️ UI 100% custom** — tidak ada dialog native browser (`prompt`/`confirm`/`alert`/`select` diganti komponen sendiri)
- **Anonim di bot** — caption chunk tidak membocorkan nama asli file

## 🏗️ Arsitektur

```
node:20-slim container (multi-stage)
├── @nightowne/tas-cli (global) + 3 patch (caption, chunk 18MB, init env)
├── server.js  → Express (auth SQLite, API, streaming, share, zip, S3 gateway)
└── public/    → frontend Vue 3 + Vite + Tailwind (components-first)
                  (dibuild di stage Docker, design system dipertahankan)
```

Data: SQLite (WAL) di `/data` — `users`, `sessions`, `profiles`, `apps`, `app_profiles`,
`api_tokens`, `folders`, `folder_files`, `s3_creds`. File asli tersimpan terenkripsi di Telegram.

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
| `API_TOKEN` | Token statis untuk integrasi API (`Authorization: Bearer ...`) |
| `BOT_INGEST` | `1` (default) aktifkan bot ingest — file kiriman ke bot langsung masuk storage |

## 📡 API

Semua endpoint butuh `Authorization: Bearer <API_TOKEN>` kecuali yang ditandai **publik**.

| Endpoint | Fungsi |
|----------|--------|
| `POST /api/login` · `POST /api/logout` · `GET /api/me` | Auth (login via user/password) |
| `GET /api/profiles` · `POST /api/profiles` | Daftar / buat bot profile |
| `POST /api/profiles/:id/init` | Init bot (token via env TAS_BOT_TOKEN) |
| `POST /api/profiles/:id/switch` · `DELETE /api/profiles/:id` | Switch / hapus bot |
| `GET /api/apps` · `POST /api/apps` | Daftar / buat app (workspace) |
| `POST /api/apps/:id/rename` · `DELETE /api/apps/:id` | Rename / hapus app |
| `POST /api/apps/:id/bots` · `DELETE /api/apps/:id/bots/:profileId` | Attach / detach bot ke app |
| `GET /api/folders` · `POST /api/folders` | Daftar / buat folder virtual |
| `POST /api/folders/:id/rename` · `DELETE /api/folders/:id` | Rename / hapus folder (file naik ke parent) |
| `POST /api/files/folder` | Pindahkan file ke folder (`?profileId=` utk multi-bot) |
| `GET /api/tokens` · `POST /api/tokens` · `DELETE /api/tokens/:id` | API token per bot (bisa di-scope per app) |
| `GET /api/status` · `GET /api/files` | Status & daftar file (`?all=1` agregasi semua bot, `?folderId=`, `?profileId=`) |
| `POST /api/upload` (multi) · `POST /api/upload-url` | Upload file / dari URL |
| `POST /api/upload/retry/:jobId` · `GET /api/jobs` | Job upload |
| `GET /api/download/:id` · `POST /api/delete/:id` | Download / hapus hard (`?profileId=` utk multi-bot) |
| `GET /api/stream/:id` | **publik** — stream (capability URL by hash, HTTP Range) |
| `POST /api/share/:id` · `GET /s/:token` · `POST /api/share/revoke/:token` · `GET /api/shares` | Share link |
| `POST /api/zip` | Download ZIP multi-file |
| `GET /api/stats` · `GET /api/activity` | Dashboard |
| `GET /api/cache` · `POST /api/cache/clear` | Cache streaming |
| `GET /api/s3` · `POST /api/s3/creds` · `DELETE /api/s3/creds/:id` | Kelola kredensial S3 |

## 🗄️ S3-compatible gateway

Endpoint `/s3` (path-style, **AWS SigV4**, zero dependency) — tas-web bertingkah sebagai
object storage. **1 bot = 1 bucket** (nama bucket = slug nama profile).

Didukung: ListBuckets, CreateBucket (idempotent), PutObject, GetObject, HeadObject,
DeleteObject, ListObjects v1 & v2. Multipart upload → `501 Not Implemented` (fase 2).

Contoh dengan [rclone](https://rclone.org):

```bash
rclone config  # type=s3, provider=Other, endpoint=http://localhost:8001/s3,
               # access_key_id=<dari halaman /api.html>, secret_access_key=<...>,
               # force_path_style=true

rclone lsd tas:            # daftar bucket (bot)
rclone copy file.mp4 tas:default/   # upload → masuk storage Telegram
rclone ls tas:default      # daftar file
rclone cat tas:default/notes.txt | less
rclone deletefile tas:default/notes.txt
```

File yang di-upload via S3 langsung muncul di web UI (satu storage terpadu).

## 🔌 Integrasi dengan aplikasi lain

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
