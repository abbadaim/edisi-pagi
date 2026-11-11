# Edisi Pagi

Brief harian untuk orang yang jarang membuka media sosial: apa yang terjadi kemarin, apa yang benar, apa yang luput, dan apa yang sedang salah dipahami.

Spesifikasi lengkap ada di `REQUIREMENTS.md`, `SCHEMA.md`, `CLUSTERING.md`, `RANKING.md`, `INFRA.md`.

## Jalankan lokal

```bash
npm install
npm run migrate          # buat data/state/local.db
npm run ingest           # tarik RSS (36 jam terakhir)
npm run build -- --date 2026-11-10
npm run weekly -- --date 2026-11-10   # opsional
npm run publish          # salin ke public/ + manifest
npm run serve            # http://localhost:8080
```

Database memakai `DATABASE_PATH` bila diset; default `local.db`.

Di CI, state ada di `data/state/local.db` dan dipulihkan lewat `actions/cache`
(lihat `.github/workflows/daily.yml`). `npm run state:info` mencetak jumlah
artikel yang terbawa sebelum ingest.

Adjudikasi di-cache per tanggal + hash masukan, jadi menjalankan ulang `build` pada data yang sama menghasilkan topik yang sama. Pakai `--refresh` untuk memaksa panggilan model baru.

## LLM

Urutan penyedia: **opencode → deepseek → deterministik**.

```bash
# .env.local (gitignored)
DEEPSEEK_API_KEY=sk-...
OPENCODE_BIN=/Users/aim/.opencode/bin/opencode
OPENCODE_MODEL=opencode-go/deepseek-v4.1-flash
```

Tanpa keduanya, pipeline tetap berjalan dengan penulis deterministik (judul dan isi dari artikel, konteks dari glosarium).

## Newsroom (POC)

`NEWSROOM.md` merancang lima peran: planner, riset, writer, editor, dan desk.
`NEWSROOM-IMPLEMENTATION.md` berisi rencana produksi dan fase rollout.

POC menulis artefak ke `data/work/poc-newsroom/<tanggal>/` dan membandingkan
hasilnya dengan edisi yang sudah terbit. Pipeline produksi **memakai jalur
newsroom secara default**:

```bash
npm run build -- --date 2026-11-10

# rollback ke jalur lama
npm run build -- --no-newsroom --date 2026-11-10
# atau NEWSROOM_WRITE=0
```

Desk review berjalan dalam mode shadow (advisory). Matikan dengan
`NEWSROOM_DESK=off`. `--newsroom-limit 2` hanya untuk uji integrasi.

```bash
LLM_PROVIDER=deepseek npm run poc:newsroom -- --date 2026-11-10 --limit 3
# --no-fetch        : jangan ambil teks penuh (uji offline)
# --max-fetch 4     : jumlah halaman per topik
# --revisions 1     : putaran revisi writer per kartu
# --plan-only       : hanya planner; tampilkan catatan editor yang terbuka
```

Baca `data/work/poc-newsroom/<tanggal>/report.md` untuk perbandingan metrik,
draft, temuan editor, dan vonis desk. Temuan yang tidak bisa ditutup bahan
disimpan di `data/work/poc-newsroom/ledger.json` dan dibaca planner pada hari
berikutnya (NEWSROOM.md §4.6).

## Notifikasi

```bash
npm run gen:vapid        # sekali; kunci privat -> .env.local, publik -> public/config.json
```

Buka aplikasi → bagian **Notifikasi** → Aktifkan → salin JSON langganan → simpan sebagai secret `PUSH_SUBSCRIPTION`.

```bash
npm run push -- --dry    # cek payload
npm run push
```

## Otomasi

`.github/workflows/daily.yml` berjalan 22:45 UTC (05:45 WIB), membangun edisi harian, edisi mingguan pada hari Minggu, lalu commit `data/` dan `public/` kembali ke repo.

Secret yang dibutuhkan: `DEEPSEEK_API_KEY`, `VAPID_PRIVATE_KEY`, `PUSH_SUBSCRIPTION`.
`OPENCODE_AUTH_JSON` opsional: bila diisi, CI memasang OpenCode CLI dan
mengimpor kredensial (`opencode auth export`); tanpa itu CI memakai DeepSeek.
`OPENCODE_BIN` hanya untuk lokal.

## Aplikasi

- **Nav bawah**: Edisi (nasional), Sleman, Mingguan, dan Atur. Tab scope hanya
  muncul bila edisinya ada.
- **Arsip**: baris tanggal di bawah judul untuk berpindah edisi lama (2 tahun
  retensi).
- **Pasang (PWA)**: tombol *Pasang* di kanan atas muncul saat browser
  menawarkan instalasi; di iOS berisi langkah "Tambah ke Layar Utama". Detail
  ada di **Atur → Aplikasi Edisi Pagi**.
- **Offline**: service worker menyajikan shell terakhir dan edisi yang sudah
  pernah dibuka (`edisi-shell-v4`, `edisi-data-v4`).
- **Notifikasi**: aktivasi di **Atur → Notifikasi**; langganan disalin sebagai
  JSON ke secret `PUSH_SUBSCRIPTION`.
- **Kartu meta**: "Yang berubah" (status/angka dibanding edisi sebelumnya) dan
  "Salah dipahami" (kualifikasi yang hilang dari judul artikel sumber).

## Perintah lain

| Perintah | Fungsi |
|---|---|
| `npm test` | 189 uji |
| `npm run validate -- <file>` | validasi edisi |
| `npm run clusters` | lihat klaster harian |
| `npm run adjudicate -- --fallback` | klaster → topik tanpa LLM |
| `npm run backfill:gdelt -- --date YYYY-MM-DD` | arsip GDELT (sering kena rate limit) |
| `npm run poc:newsroom -- --date YYYY-MM-DD --limit 3` | POC lima peran (planner → riset → writer → editor → desk) |
