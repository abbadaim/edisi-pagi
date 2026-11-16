# 016 — Edisi perspektif (POC)

```
Status: tested
Kelas: UI
Dibuat: 2026-11-16
Diperbarui: 2026-11-16
Mockup: docs/mockups/016-perspektif-v2.html (v1: 016-perspektif.html)
```

## 1. Masalah

Setiap kartu hari ini adalah **satu ringkasan netral** dari 2–6 media. Framing
tiap media hilang, padahal framing itulah yang membedakan liputan. Contoh nyata
dari `data/editions/2026-11-13.nasional.json` (kartu `c1`, 5 sumber, 3 pemilik):

| Media | Judul asli (slug URL) |
|---|---|
| liputan6.com | Prabowo puji sikap ksatria Gibran serahkan langsung surat pengunduran diri |
| cnnindonesia.com | Prabowo merasa terbantu Gibran pantau proyek pemerintah |
| detik.com | Kata-kata Gibran saat peluk Prabowo: “Saya minta maaf ya, Pak” |
| cnbcindonesia.com | Momen Gibran temui Prabowo sebelum serahkan surat resign |
| tirto.id | Prabowo-Gibran sudah tempuh pendidikan lewat proses teratur |

Empat frame berbeda (pujian, manfaat pemerintahan, human interest, prosedural)
dipadatkan menjadi satu judul. Pembaca tidak bisa melihat siapa menyorot apa.

Dua masalah biaya yang terukur:

| | Nilai | Bukti |
|---|---|---|
| Token per edisi (8 kartu) | 417k masuk / 34k keluar | `llm_calls`, 2026-11-12 |
| Waktu build | 14 m 16 s | log build 2026-11-12 |
| Token masuk per kartu | 15,6k | `write` 124,8k / 8 kartu |
| Ukuran edisi | 51–75 KB, 15–34 menit baca | `data/editions/2026-11-1*.json` |

Penyebabnya bukan pengambilan isi artikel (16.870 karakter/artikel, 0 token),
melainkan model yang membaca 4 × 5.000 karakter lalu menulis ulang 2–3 kali.

Temuan tambahan saat menyiapkan POC: `src/core/truth.ts:57` menghitung
kemandirian per **domain**, bukan per pemilik. Tiga media CT Corp (detik, CNN,
CNBC) dihitung tiga sumber independen, dan angka itu dipakai `confidence`.

| Kartu | Domain | Pemilik | `independent_outlets` |
|---|---:|---:|---:|
| Gibran mundur | 5 | 3 | 5 |
| Kapolri/penyadapan | 4 | 2 | 4 |
| Pertamina BBM | 3 | 2 | 3 |
| DPO Bangkalan | 2 | 2 | 2 |
| Nvidia/Jensen | 4 | 3 | 4 |
| Ijazah Jokowi | 6 | 5 | 6 |

## 2. Keputusan yang akan diambil

Memutuskan **model penyajian** edisi: tetap satu ringkasan tulis ulang, atau
liputan dikelompokkan per pemilik media tanpa menulis ulang. POC ini tidak
mengubah pipeline, tidak menambah kartu, dan tidak menerbitkan apa pun. Yang
diminta hanya persetujuan arah lewat mockup.

Yang **tidak** berubah: jalur terbit harian, `schema_version`, kartu meta, dan
gerbang fakta (§4.1 `AGENTS.md`). Terkait `DEC-0011` (mockup sebelum kode) dan
`DEC-0012` (token CSS sama).

## 3. Rencana

POC (selesai):

1. `data/work/poc-perspektif/build.py` — skrip sekali pakai, di luar git:
   membaca `data/editions/2026-11-13.nasional.json`, mengelompokkan sumber per
   pemilik, menurunkan judul per media dari slug URL, menulis satu HTML.
2. `docs/mockups/016-perspektif.html` — artefak; data inline, tanpa jaringan.

Bila mockup disetujui, lanjutan yang diusulkan (belum dikerjakan):

3. `config/outlets.yaml` — registry pemilik, kelas **pipeline**: satu entri
   `outlet`, `pemilik`, `afiliasi`, `catatan`, `diverifikasi_pada`. Kontrak di §4.
4. `src/core/truth.ts` — hitung `independent_outlets` per pemilik. Satu tes
   mengunci: tiga domain satu pemilik = 1.
5. Kartu `perspektif` (kelas **UI**, mockup baru) — hanya bila §2 diputuskan
   mengganti ringkasan, bukan menambah strip.
6. `SCHEMA.md` — tipe kartu baru + field `coverage.pemilik` bila langkah 5 jalan.

## 4. Mockup

**v2 — `docs/mockups/016-perspektif-v2.html`** (keputusan 2026-11-16: perspektif
sebagai pelengkap, bukan pengganti). Kiri: kartu terbit apa adanya + strip
“Siapa menyorot apa” (3 baris, satu per pemilik, + tombol “Lihat semua N
media”). Kanan: detail semua media dengan kutipan. Tambahan panel keragaman
judul per kartu dan perbandingan biaya tiga pilihan.

**v1 — `docs/mockups/016-perspektif.html`** — satu file, dua bingkai ponsel 380 px,
token `--paper/--ink/--accent/--rule/--serif/--sans` dari `public/style.css`.

Keadaan yang dicakup:

1. Delapan kartu edisi 2026-11-13, termasuk `debate` (satu pemilik) dan
   `hoax_roundup` (satu sumber).
2. Spektrum pemilik; klik segmen memfilter daftar media.
3. Baris media: judul asli, jam terbit, pemilik; klik membuka slot kutipan.
4. Toggle `Label pemilik` (matikan = daftar datar tanpa pengelompokan).
5. Toggle `Kutipan` (dua kalimat pertama halaman sumber; 18 dari 24 URL berhasil,
   `tirto.id` 403 — dibiarkan kosong, bukan diisi teks lain).
6. Panel temuan (§1) dan panel biaya; angka kiri bernama edisi asalnya.

Yang sengaja **tidak** diisi: panel “Luput”. Edisi tidak mencatat media yang
meliput topik tetapi tidak dipilih planner, jadi “siapa yang tidak menulis”
tidak bisa dinyatakan. Mockup menyatakan itu, bukan mengarang.

## 5. Tes

Belum ada kode produksi, jadi belum ada tes baru. Tes yang akan menyertai
langkah 3–5:

- `tests/outlets.test.ts` — registry terbaca, setiap `outlet` di `feeds.yaml`
  punya entri, `diverifikasi_pada` wajib.
- `tests/truth-independence.test.ts` — tiga domain satu pemilik dihitung 1;
  `band` turun bila pemilik < 2.
- `tests/ui-static.test.ts` — kartu `perspektif` memakai path relatif dan tidak
  memuat markup mentah dari sumber.
- `tests-ui/shell.spec.ts` — spektrum dan toggle label.

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| Label pemilik salah = klaim faktual salah | `diverifikasi_pada` per entri; tanpa verifikasi, label disembunyikan |
| Spektrum menyesatkan dengan 13 media | Tampilkan jumlah pemilik, bukan hanya “kaya/beragam”; jangan tampilkan bar bila pemilik < 2 |
| Kutipan isi = risiko hak cipta | Maksimum 2 kalimat + tautan; jangan pernah menyalin badan penuh |
| Pembaca kehilangan sintesis | Mockup menampilkan keduanya berdampingan; keputusan ada di §2 |
| POC dianggap fitur jadi | Header mockup: `mockup-v1 · belum disetujui`, badge `0 panggilan LLM` |

Rollback: tidak ada yang perlu dibatalkan. Mockup adalah file statis di
`docs/mockups/`, tidak dirujuk `publish.ts` dan tidak masuk `public/`.

## 6b. Implementasi (2026-11-16)

Bagian yang dikirim lebih dulu sebagai pelengkap, tanpa mengubah bentuk kartu:

- `src/core/frames.ts` — `buildFrames()` mengambil judul dari tabel `articles`
  (judul RSS, 0 token); `headlineFromUrl()` hanya cadangan bila URL tidak ada.
- `scripts/build.ts` — menempelkan `frames` ke kartu; log
  `perspektif: N kartu punya judul per media`.
- `public/app.js` + `style.css` — strip tiga baris “Siapa menyorot apa” di bawah
  badan, “Lihat semua N media” membuka sisanya.
- `schema/edition.schema.json` — field opsional `frames`, maks 6.

Belum: pengelompokan per pemilik (rencana 017), kutipan isi artikel, dan panel
“Luput”. Tanpa registry, satu baris = satu media.

## 7. Riwayat

- `2026-11-16` — `mockup-v1` — mockup dibuat dari edisi 2026-11-13; 0 panggilan
  LLM; 8 kartu, 29 sumber, 27 masuk registry.
- `2026-11-16` — `mockup-v1` — tambah kutipan asli: 24 URL berita diambil sekali,
  18 berhasil (tirto.id menolak 403), 0 token; toggle `Kutipan` menampilkan
  kutipan atau alasan kosong.
- `2026-11-16` — `mockup-v2` — perspektif sebagai pelengkap: strip 3 baris di
  bawah kartu + layar detail. Panel keragaman judul: hanya dua kartu yang
  benar-benar berbeda (penyadapan 0,09; DPO 0,06 — dua media saja), empat
  lainnya 0,17–0,35 dan cenderung menulis hal yang sama.
- `2026-11-16` — `tested` — strip perspektif dikirim: `frames` dari tabel
  `articles`, UI tiga baris + “Lihat semua”, 5 uji baru. Belum tampil di edisi
  2026-11-16 karena build hari itu sudah selesai; masuk pada run 17 Nov.

## 8. Pelajaran (diisi setelah `shipped`)

—
