# 017 — Registry pemilik media

```
Status: tested
Kelas: pipeline
Dibuat: 2026-11-16
Diperbarui: 2026-11-16
Mockup: docs/mockups/017-registry.html (alat keputusan; kontrak ada di §4)
```

## 1. Masalah

`src/core/truth.ts:57` menghitung kemandirian sumber dari **domain**, bukan dari
pemilik:

```ts
const groups = new Set([...domains].map((d) => d.split(".").slice(-2).join(".")));
const independent = groups.size;
```

Tiga media CT Corp (detik, CNN Indonesia, CNBC Indonesia) menjadi tiga “sumber
independen”, lalu angka itu masuk ke `basis.independent_outlets` dan ke
`confidence`. Pada edisi 2026-11-13, enam kartu berita:

| Kartu | `independent_outlets` | Pemilik sebenarnya |
|---|---:|---:|
| Gibran mundur | 5 | 3 |
| Kapolri/penyadapan | 4 | 2 |
| Pertamina BBM | 3 | 2 |
| DPO Bangkalan | 2 | 2 |
| Nvidia/Jensen | 4 | 3 |
| Ijazah Jokowi | 6 | 5 |

Sumber: `data/editions/2026-11-13.nasional.json`; hitung ulang ada di
`docs/mockups/017-registry.html` §2.

Yang **tidak** terjadi (dan tidak boleh diklaim): memperbaiki hitungan ini tidak
membuat edisi jauh lebih tepercaya. Dengan formula `truth.ts`, hanya dua kartu
yang berubah, dan hanya 0,03 (0,83 → 0,80); tidak ada yang turun di bawah ambang
`kemungkinan_besar` (0,75). Dasar `two_independent_tier2` tetap sah karena enam
kartu memang punya ≥2 pemilik dengan sumber tier 2.

## 2. Keputusan yang akan diambil

Menambahkan `config/outlets.yaml` sebagai sumber tunggal pemilik media, dan
menghitung kemandirian per pemilik. Label pemilik tidak pernah tampil publik
sebelum entrinya punya `diverifikasi_pada`. Tidak ada perubahan pada gerbang
terbit (§4.1 `AGENTS.md`), pada `schema_version`, dan pada kartu meta. Terkait
`DEC-0011` (kontrak sebelum kode).

## 3. Rencana

1. `config/outlets.yaml` — entri per outlet: `pemilik`, `afiliasi`, `catatan`,
   `diverifikasi_pada`, `sumber_verifikasi`. Diisi manusia, bukan model.
2. `src/core/outlets.ts` — pemuat + validator: setiap `outlet` di
   `config/feeds.yaml` wajib punya entri; entri tanpa `diverifikasi_pada`
   dianggap **tidak diketahui** (jatuh ke perilaku hari ini).
3. `src/core/truth.ts` — `independent` dihitung dari pemilik; bila registry
   tidak memuat outlet, pakai domain. Tanpa registry: perilaku lama.
4. `src/core/types.ts` + `SCHEMA.md` — tambah `basis.independent_owners` dan
   `basis.registry_coverage` (opsional, aditif).
5. `scripts/build.ts` — satu baris log: `registry: 14 outlet · 9 terverifikasi ·
   independen 5→3 (Gibran)`.
6. Uji: `tests/outlets.test.ts`, `tests/truth-independence.test.ts`.

## 4. Kontrak (kelas pipeline)

`config/outlets.yaml`:

```yaml
# Satu entri per domain media. `diverifikasi_pada` kosong = belum dicek manusia.
outlets:
  - outlet: detik.com
    pemilik: CT Corp
    afiliasi: Trans Media
    catatan: Pemilik sama dengan cnnindonesia.com dan cnbcindonesia.com
    diverifikasi_pada: 2026-11-20
    sumber_verifikasi: https://www.transmedia.co.id/...
```

Potongan `edition.json` sebelum/sesudah (kartu `c2`, penyadapan):

```diff
   "truth": {
-    "basis": { "strongest": "two_independent_tier2", "independent_outlets": 4 },
-    "confidence": 0.83, "band": "kemungkinan_besar"
+    "basis": { "strongest": "two_independent_tier2", "independent_outlets": 2,
+               "independent_owners": 2, "registry_coverage": 1.0 },
+    "confidence": 0.8, "band": "kemungkinan_besar"
   }
```

Baris log yang diharapkan:

```
  registry: 14 outlet · 9 terverifikasi · independen Gibran 5→3, Penyadapan 4→2
```

Aturan yang mengikat kontrak:

- Registry hilang / gagal dibaca → perilaku lama, plus
  `registry: tidak terbaca — hitungan per domain`.
- Outlet tidak dikenal → dihitung per domain dan dicatat di
  `basis.registry_coverage` (mis. 0,83), bukan digugurkan.
- Tidak ada penilaian “kubu”, “kiri–kanan”, atau afiliasi politik. Hanya
  kepemilikan dan afiliasi korporasi yang bisa diverifikasi.

## 5. Tes

- `tests/outlets.test.ts` — semua outlet di `feeds.yaml` punya entri; entri tanpa
  `diverifikasi_pada` tidak dipakai untuk label; registry rusak tidak melempar.
- `tests/truth-independence.test.ts` — tiga domain satu pemilik = 1; kartu dengan
  satu pemilik turun 0,1; kartu tanpa registry menghasilkan angka lama
  (regresi terkunci).
- `tests/ui-static.test.ts` — label pemilik tidak muncul bila
  `diverifikasi_pada` kosong (bila kelak dipakai di kartu).

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| Nama pemilik salah = klaim faktual salah | `diverifikasi_pada` + `sumber_verifikasi`; tanpa itu label tidak tampil |
| Angka turun membuat edisi terlihat “kurang yakin” | Perubahan maksimum 0,03 pada data nyata; tidak melewati ambang band |
| Registry cepat basi (akuisisi media) | Kolom tanggal; tinjau bulanan; log mencetak jumlah terverifikasi |
| Ketergantungan pada satu file | File opsional: tanpa registry, perilaku lama |
| Kartu dengan satu pemilik turun 0,1 | Dampak kecil hari ini, tetapi perlu diperiksa saat breadth masih 13 outlet |

Rollback: hapus `config/outlets.yaml` atau set `OUTLET_REGISTRY=off`. Tidak ada
migrasi basis data; edisi terbit tidak diubah (`edition.json` hanya bertambah
field opsional pada build berikutnya).

## 6b. Implementasi (2026-11-16)

- `config/outlets.yaml` — 14 outlet, `diverifikasi_pada: 2026-11-16` setelah
  daftar dikonfirmasi pemilik proyek. Setiap entri punya `catatan` yang menyebut
  apa yang perlu dicek ulang saat tinjauan bulanan.
- `src/core/outlets.ts` — `parseRegistry()`/`loadRegistry()`/`ownerOfOutlet()`;
  entri tanpa `diverifikasi_pada` **tidak** dipakai untuk label. Registry hilang
  atau rusak = registry kosong, penerbitan jalan seperti sebelumnya.
- `src/core/truth.ts` — `computeTruthRegistered()` menghitung kemandirian per
  pemilik (`independent_outlets` + `independent_owners`). `computeTruth()` tetap
  murni untuk tes.
- `src/core/frames.ts` — satu baris per pemilik dengan `media` counter; tanpa
  registry kembali ke satu baris per media.
- `public/app.js` — label `CT Corp · 3 media · 11 Nov`, ringkasan
  `3 dari 3 pemilik · 5 media`.

Insiden 2026-11-17: `frames` ditambah `owner`/`media` tetapi schema masih
`additionalProperties: false`, sehingga edisi 17 November ditolak validasi
(`E000 ... additionalProperty owner`) dan tidak terbit. Diperbaiki di commit
berikutnya + `tests/frames-schema.test.ts` (termasuk kontrol yang membuktikan
schema memang menolak properti asing).

Bukti: tiga domain CT Corp kini 1 suara (uji `tests/truth-owners.test.ts`);
strip di fixture menampilkan 3 baris untuk 5 media.

## 7. Riwayat

- `2026-11-16` — `tested` — registry + hitungan per pemilik + strip per pemilik
  dikirim; 305 uji lulus.
- `2026-11-16` — `plan-draft` — rencana + mockup alat keputusan
  (`docs/mockups/017-registry.html`); angka 0,83 → 0,80 diukur dari edisi
  2026-11-13.

## 8. Pelajaran (diisi setelah `shipped`)

—
