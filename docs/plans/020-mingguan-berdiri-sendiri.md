# 020 — Rekap mingguan berdiri sendiri

```
Status: tested
Kelas: infra
Dibuat: 2026-11-16
Diperbarui: 2026-11-16
Mockup: — (kelas infra; kontrak di §4)
```

## 1. Masalah

Rekap mingguan menumpang di `daily.yml` dan hanya jalan pada Minggu:

```yaml
if [ "$(TZ=Asia/Jakarta date +%u)" = "7" ]; then npm run weekly -- --thin; fi
```

Akibatnya tiga hal:

1. **Tidak bisa dibuat tanpa membangun harian.** Untuk menghasilkan rekap hari
   ini, satu-satunya jalan adalah menjalankan `daily.yml`, yang sekaligus
   menimpa `<tanggal>.nasional.json` — edisi terbit yang seharusnya immutable.
2. **Kalau build harian gagal, rekap ikut hilang.** Pada 2026-11-15/16 build
   harian turun ke penulis deterministik; langkah mingguan tetap jalan tetapi
   memakai state yang sama.
3. **Tidak ada jadwal cadangan.** Cron GitHub bisa dibuang tanpa notifikasi
   (`DEC-0028`); rekap mingguan tidak punya pemeriksa seperti `schedule-check`.

Keadaan 2026-11-16: `latest_by_scope.mingguan = 2026-11-12`, sementara
`latest = 2026-11-16`. Tab mingguan masih tampil karena jendela 7 hari
(`DEC-0019`), tetapi isinya rekap 5–12 November.

## 2. Keputusan yang akan diambil

Rekap mingguan dipindahkan ke workflow sendiri (`weekly.yml`) yang **tidak**
memanggil `npm run build`. `daily.yml` kehilangan langkah mingguan sehingga
tidak ada dua penulis untuk berkas yang sama. Yang tidak berubah: bentuk
`<tanggal>.mingguan.json`, `latest_by_scope` (`DEC-0019`), dan gerbang terbit.

## 3. Rencana

1. `.github/workflows/weekly.yml` — jadwal `0 22 * * 6` (Sabtu 22.00 UTC =
   Minggu 05.00 WIB) + `workflow_dispatch`; langkah: state → migrate → ingest
   168 jam → `npm run weekly -- --thin` → publish → health → alert → commit →
   deploy.
2. `.github/workflows/daily.yml` — hapus langkah “Bangun edisi mingguan”.
   Kedua workflow memakai `concurrency: group: edisi-pipeline` supaya tidak
   menulis state/cache dan `public/` bersamaan.
3. `src/core/health.ts` — aturan khusus scope `mingguan`: ambang 3 thread
   (bukan 4) dan adjudikasi `fallback` tidak dihitung sebagai degradasi, karena
   `scripts/weekly.ts` memang selalu memakai adjudikasi deterministik.
4. `scripts/health.ts` — tambah `--min-cards`.
5. `src/core/overwrite-guard.ts` + `scripts/weekly.ts` — rekap yang sudah
   terbit tidak ditimpa tanpa `--force`.
6. `AGENTS.md` — catat workflow baru dan bahwa rekap tidak lagi di `daily.yml`.

## 4. Kontrak

Perintah dan keluaran yang diharapkan:

```bash
npm run weekly -- --thin
# mingguan · <N> artikel · <M> thread · x newsroom / y legacy
#   ✓ valid · data/editions/2026-11-16.mingguan.json
```

```bash
node scripts/health.ts --scope mingguan
# 2026-11-16 mingguan · 3 kartu · tulis: opencode · adjudikasi: fallback · sehat
```

Aturan:

- Workflow mingguan **tidak** boleh menjalankan `npm run build`.
- Berkas yang boleh berubah: `data/editions/<tanggal>.mingguan.json`,
  `public/` (manifest + salinan), state cache.
- `< 3` thread → tidak menerbitkan apa pun, log
  `mingguan · N artikel · M thread — tidak terbit (minimum 3)`, dan berkas
  lama untuk tanggal itu dihapus bila ada.
- `daily.yml` tidak lagi memuat kata `weekly`.
- Menjalankan ulang tanggal yang sudah punya `<tanggal>.mingguan.json` hanya
  boleh dengan `--force`; tanpa itu skrip keluar 0 dengan pesan
  `sudah ada: … — dilewati`.

## 5. Tes

- `tests/health.test.ts` — dua kasus baru: rekap mingguan sehat (adjudikasi
  `fallback`, 3 kartu) dan rekap mingguan tanpa OpenCode tetap ditandai.
- Pemeriksaan statis workflow (dijalankan saat review): `weekly.yml` memuat
  `npm run weekly` dan tidak memuat `npm run build`; `daily.yml` tidak memuat
  `weekly`.

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| Dua workflow menulis state/`public/` bersamaan | `concurrency: edisi-pipeline` dibagi; yang kedua menunggu |
| Cache state ditimpa | kunci `edisi-state-<run_id>` dengan restore prefix yang sama seperti harian |
| Rekap memakai state basi | ingest 168 jam sebelum build |
| Cron mingguan dibuang GitHub | dispatch manual; `schedule-check` tetap menjaga harian |
| Rekap menimpa tanggal yang sudah ada | `weekly.ts` hanya menulis `<tanggal>.mingguan.json`; jalankan untuk tanggal yang belum ada |

Rollback: kembalikan langkah mingguan ke `daily.yml` dan hapus `weekly.yml`.
Tidak ada perubahan skema.

## 7. Riwayat

- `2026-11-16` — `tested` — workflow `weekly.yml` dibuat, langkah mingguan
  dihapus dari `daily.yml`, health dapat aturan scope mingguan. 290 uji lulus.
- `2026-11-16` — `tested` — penjaga tambahan: `concurrency` dibagi
  (`edisi-pipeline`), cron mingguan digeser ke 03.00 WIB, dan rekap terbit tidak
  ditimpa tanpa `--force` (uji nyata: `2026-11-10.mingguan.json` dilewati).

## 8. Pelajaran (diisi setelah `shipped`)

—
