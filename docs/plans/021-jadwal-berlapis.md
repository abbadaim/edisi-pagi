# 021 — Jadwal berlapis dengan penjaga idempoten

```
Status: tested
Kelas: infra
Dibuat: 2026-11-17
Diperbarui: 2026-11-17
Mockup: — (kelas infra; kontrak di §4)
```

## 1. Masalah

Pada 2026-11-17 **tidak ada run sama sekali** untuk `daily.yml`, dan
`schedule-check.yml` juga tidak berjalan. Cron masih ada di `main`, workflow
`active`, dan manifest masih menunjuk `2026-11-16` pukul 09:42 WIB.

Ini kekambuhan `DEC-0028` (12 November): status `active` bukan bukti. Penjaga
yang ada (`schedule-check.yml`, satu cron 07:15 WIB) ikut terkena masalah yang
sama, jadi ia tidak bisa menjadi jaring pengaman tunggal — pada 16 November
run-nya bahkan baru muncul 13:18 WIB, enam jam terlambat.

| Tanggal | `daily.yml` | `schedule-check` |
|---|---|---|
| 2026-11-15 | jalan (02:09 UTC) | jalan (06:19 UTC, terlambat) |
| 2026-11-16 | jalan (02:24 UTC) | jalan (06:18 UTC, terlambat) |
| 2026-11-17 | **tidak ada** | **tidak ada** |

## 2. Keputusan yang akan diambil

Menambah jendela cron berlapis dan penjaga idempoten: run kedua dan ketiga
berhenti sendiri bila `<tanggal>.nasional.json` sudah ada di repo. Dengan
begitu pengulangan cron tidak pernah menimpa edisi terbit, sehingga biaya
"jadwal berlapis" hanya satu langkah cek 10 detik. Tidak ada perubahan pada
bentuk edisi, kuota, atau gerbang terbit.

## 3. Rencana

1. `scripts/edition-guard.ts` — mencetak `skip=true|false` ke `GITHUB_OUTPUT`
   berdasarkan ada/tidaknya `data/editions/<tanggal>.nasional.json`; memakai
   `canWriteEdition()` dari `src/core/overwrite-guard.ts`.
2. `.github/workflows/daily.yml` — job `check` (checkout + node + guard) dan
   `build` memakai `needs: check` + `if: needs.check.outputs.skip != 'true'`;
   cron menjadi 22:45, 00:30, 02:30 UTC (05:45, 07:30, 09:30 WIB).
3. `.github/workflows/schedule-check.yml` — cron kedua 02:15 UTC (09:15 WIB).
4. `.github/workflows/weekly.yml` — cron kedua 21:00 UTC Sabtu (04:00 WIB);
   sudah aman karena `weekly.ts` menolak menimpa tanpa `--force` (rencana 020).
5. `AGENTS.md` — catat bahwa jadwal berlapis adalah pengaman, bukan jaminan.

## 4. Kontrak

```bash
node scripts/edition-guard.ts --date 2026-11-16
# guard: 2026-11-16 sudah terbit (/…/data/editions/2026-11-16.nasional.json) — dilewati (pakai --force untuk membangun ulang)

node scripts/edition-guard.ts --date 2026-11-18
# guard: 2026-11-18 belum ada — lanjut
```

Aturan:

- `skip=true` → job `build` dan `deploy` tidak berjalan; run tetap hijau.
- `--force` hanya untuk membangun ulang tanggal yang sudah terbit, dan hanya
  atas keputusan manusia.
- Penjaga membaca **repo**, bukan manifest live. Bila commit bot gagal, run
  berikutnya akan membangun ulang tanggal itu (perilaku lama) — itu disengaja:
  lebih baik edisi ada daripada hilang.

## 5. Tes

- `src/core/overwrite-guard.ts` sudah dikunci `tests/local-off.test.ts`
  (3 kasus: belum ada, sudah ada, `--force`).
- Verifikasi manual: guard mengembalikan `skip=true` untuk 2026-11-16 dan
  `skip=false` untuk 2026-11-18 di checkout ini.
- Bukti jadwal: setelah push, dua cron berikutnya harus muncul di
  `gh run list --workflow daily.yml`; yang kedua boleh berhenti di guard.

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| Tiga run menumpuk | `concurrency: edisi-pipeline` + guard: yang kedua berhenti <15 detik |
| Guard salah menilai (file ada tapi manifest basi) | jalankan `deploy-site` untuk publish ulang, bukan build ulang |
| Cron tetap dibuang semua | dispatch manual tetap tersedia; guard membuat dispatch aman |
| `--force` dipakai tanpa sengaja | flag hanya manual, tidak dipakai workflow |

Rollback: hapus job `check` dan `needs`, sisakan satu cron.

## 7. Riwayat

- `2026-11-17` — `tested` — guard + tiga jendela cron; 17 November dibangun
  manual karena tidak ada run sama sekali.

## 8. Pelajaran (diisi setelah `shipped`)

—
