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

Secret yang dibutuhkan: `DEEPSEEK_API_KEY` atau `OPENCODE_BIN`, `VAPID_PRIVATE_KEY`, `PUSH_SUBSCRIPTION`.

## Perintah lain

| Perintah | Fungsi |
|---|---|
| `npm test` | 92 uji |
| `npm run validate -- <file>` | validasi edisi |
| `npm run clusters` | lihat klaster harian |
| `npm run adjudicate -- --fallback` | klaster → topik tanpa LLM |
| `npm run backfill:gdelt -- --date YYYY-MM-DD` | arsip GDELT (sering kena rate limit) |
