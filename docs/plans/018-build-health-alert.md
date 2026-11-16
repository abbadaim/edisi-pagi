# 018 — Deteksi build turun mutu + peringatan surel

```
Status: tested
Kelas: infra
Dibuat: 2026-11-16
Diperbarui: 2026-11-16
Mockup: — (kelas infra; kontrak di §4)
```

> Ditulis sebagai rencana retroaktif lewat jalur darurat (`docs/WORKFLOW.md` §4):
> insiden produksi sudah terjadi (edisi 2026-11-15 dan 2026-11-16), jadi
> perbaikan dikerjakan lebih dulu, tes menyusul, rencana dalam 24 jam.

## 1. Masalah

Workflow `daily.yml` **sukses**, deploy jalan, tetapi isi edisinya rusak. Tidak
ada satu pun sinyal yang memberi tahu.

| Tanggal | Hasil | Bukti |
|---|---|---|
| 2026-11-14 | 8 kartu, OpenCode, 28 panggilan | log run `43547751676` |
| 2026-11-15 | 6 kartu, `tulis: deterministic` | log: `tidak ada LLM tersedia` |
| 2026-11-16 | **1 kartu** (`hoax_roundup`) | log: `kartu: hoax_roundup:1` |

Penyebabnya dua lapis:

1. Installer memasang OpenCode **v2.3.0** (bukan v2.2.7 yang tercatat di
   `AGENTS.md`), lalu pemeriksaan katalog `DEC-0018` melaporkan
   `model opencode-go/deepseek-v4.1-flash tidak ada di katalog opencode`.
   Terbukti lokal: profil bersih mengembalikan 12 model tanpa satu pun
   `opencode-go/*`, sedangkan profil dengan kredensial memuat model itu.
2. Semua langkah setelahnya tetap `continue-on-error`, sehingga edisi satu kartu
   tetap diterbitkan dan tetap dideploy.

Status workflow tidak bisa dipakai sebagai alarm: tidak ada langkah yang gagal.
Yang harus dinilai adalah **hasil build** (`edition.json` + `manifest.json`).

## 2. Keputusan yang akan diambil

Menambahkan penilaian kesehatan hasil build dan peringatan surel, serta mematok
versi CLI OpenCode. Penerbitan tetap tidak diblokir oleh pemeriksaan ini —
peringatan dikirim, deploy tetap berjalan. Terkait `DEC-0018` (verifikasi
katalog) dan `DEC-0011` (kontrak sebelum kode).

## 3. Rencana

1. `src/core/health.ts` — `assessEdition()` dan `composeAlert()`; murni, tanpa
   jaringan.
2. `scripts/health.ts` — CLI: membaca `data/editions/<date>.<scope>.json` dan
   `public/manifest.json`, menulis `GITHUB_STEP_SUMMARY`, `GITHUB_OUTPUT`, dan
   `--out <file>`.
3. `scripts/alert.ts` — CLI: menyusun surel, mengirim lewat `curl` ke
   `ALERT_SMTP_URL`. Tanpa secret → hanya menulis peringatan di log.
4. `.github/workflows/daily.yml` — langkah `Cek kesehatan build` dan
   `Kirim peringatan surel`, keduanya `if: always()`.
5. `.github/workflows/daily.yml`, `.github/workflows/opencode-smoke.yml` —
   patok `--version 2.2.7` pada installer.
6. `package.json` — `npm run health`, `npm run alert`.

## 4. Kontrak

Perintah dan keluaran yang diharapkan (dijalankan pada salinan `origin/main`):

```bash
node scripts/health.ts --date 2026-11-14 --editions /tmp/edtest --manifest /tmp/edtest/manifest.json
# 2026-11-14 nasional · 8 kartu · tulis: opencode · adjudikasi: opencode · sehat

node scripts/health.ts --date 2026-11-16 --editions /tmp/edtest --manifest /tmp/edtest/manifest.json
# 2026-11-16 nasional · 1 kartu · tulis: deterministic · adjudikasi: fallback · ALASAN: deterministic-writer, deterministic-adjudicate, few-cards
```

Ketentuan:

- `ok=false` bila: edisi tidak ada, `generated_by.write.provider != "opencode"`,
  `generated_by.adjudicate.provider != "opencode"`, kartu < 4, atau manifest
  tidak menunjuk tanggal/scope itu.
- Langkah CI **tidak** menggagalkan job. Deploy tetap jalan; surel yang
  memberi tahu.
- Surel dikirim bila `ok=false` **atau** `JOB_STATUS=failure`.
- Tanpa `ALERT_SMTP_URL/USER/PASS/FROM/TO`, skrip mencetak
  `peringatan tidak dikirim: secret surel belum lengkap` dan keluar 0.
- Isi surel memuat ringkasan, penyedia per peran, alasan, tautan run, dan
  pengingat “jangan menerbitkan ulang tanggal yang sudah terbit”.

Untuk menguji jalur surel tanpa menunggu build gagal:
`gh workflow run alert-test.yml --ref main` (workflow `alert-test.yml`,
`node scripts/alert.ts --test`). Subjeknya diberi tanda “uji kirim”.

Secret yang perlu diisi di repo: `ALERT_SMTP_URL` (mis.
`smtps://smtp.gmail.com:465`), `ALERT_SMTP_USER`, `ALERT_SMTP_PASS`,
`ALERT_FROM`, `ALERT_TO`. Untuk selain Gmail, cukup ganti URL/port.

## 5. Tes

`tests/health.test.ts` — 6 uji, semuanya lulus (`npm test`):

1. Edisi OpenCode dengan kartu cukup → `ok`.
2. Penulis deterministik → tiga alasan sekaligus.
3. Edisi tidak ada → `no-edition`.
4. Manifest menunjuk tanggal lain → `not-published`.
5. `edition_id` berbeda dari tanggal build → `edition-not-yesterday`.
6. Surel memuat alasan dan larangan bangun ulang.

Bukti pada data nyata: 11-14 sehat, 11-15 dan 11-16 ditandai dengan alasan yang
tepat (§4).

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| Surel tidak terkirim (SMTP diblokir) | `continue-on-error`; langkah tetap mencetak ringkasan ke log dan Step Summary |
| Surel banjir saat OpenCode sering mati | satu surel per run, bukan per kartu |
| Mematok v2.2.7 menghalangi model baru | jalankan `opencode-smoke.yml` bulanan; naikkan pin setelah smoke lulus |
| Alarm palsu saat kartu memang sedikit | ambang 4 kartu; alasan ditulis eksplisit |
| Deploy ikut gagal karena langkah baru | kedua langkah `always()` dan tidak pernah `exit 1` |

Rollback: hapus dua langkah baru di `daily.yml`, hapus pin versi. Tidak ada
perubahan pada data atau edisi terbit.

## 7. Riwayat

- `2026-11-16` — `tested` — deteksi kesehatan, peringatan surel, pin v2.2.7;
  6 uji baru. Menunggu satu run `daily.yml` untuk membuktikan surel benar-benar
  terkirim.
- `2026-11-16` — `tested` — run `43823312712`: health check bekerja
  (`ALASAN: deterministic-writer, deterministic-adjudicate, few-cards`), tetapi
  pin 2.2.7 **tidak** menyembuhkan katalog. Sebabnya profil: auth diimpor
  `--standalone`, sedangkan `models`/`run` tanpa flag. Perbaikan dipindah ke
  `DEC-0029` (samakan profil), bukan versi.

## 8. Pelajaran (diisi setelah `shipped`)

—
