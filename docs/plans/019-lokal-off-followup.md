# 019 — Hentikan edisi lokal, tampilkan tindak lanjut

```
Status: tested
Kelas: pipeline + UI
Dibuat: 2026-11-16
Diperbarui: 2026-11-16
Mockup: docs/mockups/019-lanjutan.html
```

## 1. Masalah

### 1.1 Edisi lokal berhenti sendiri

| Hal | Kenyataan |
|---|---|
| Edisi lokal terakhir | `2026-11-14.lokal.json` |
| 15–16 November | tidak ada file lokal |
| `manifest.latest_by_scope.lokal` | `null` → tab “Sleman” hilang |
| Kandidat lokal yang lolos filter | 8 (16 Nov), 7 (15 Nov) — tapi `localPlan.length < 2` |

Jadi mesinnya masih bekerja, hasilnya tidak cukup untuk ambang dua kartu.
Edisi lokal hanya terbit pada 10–14 November (5 hari dari 7).

### 1.2 Tindak lanjut ada di data, tidak terlihat di aplikasi

Pada edisi 2026-11-13, **5 dari 8 kartu** adalah revisi (`revision` 2–9,
`previous_edition: "2026-11-12"`). Di aplikasi tidak ada satu pun rujukan:

```bash
grep -n "previous_edition\|revision" public/app.js   # tidak ada hasil
```

Pembaca karena itu tidak tahu bahwa sebuah kartu melanjutkan cerita kemarin,
apa yang berubah, atau pertanyaan apa yang sudah terjawab. `changes[]` selalu
kosong di edisi 10–13 November, dan 149 catatan editor berstatus `open` tidak
punya jalan tampil (hanya `unresolved`/`disclaimer` yang publik).

### 1.3 Akibatnya

- Kuota tindak lanjut (`selection.ts`, §4.4 `AGENTS.md`) bekerja di belakang,
  tetapi nilainya nol bagi pembaca.
- Slot lokal memakan jatah kandidat dan waktu build tanpa edisi yang terbit.

## 2. Keputusan yang akan diambil

**Berhenti menerbitkan edisi lokal** dan memindahkan anggaran perhatian ke
tindak lanjut: penanda “lanjutan”, ringkasan “apa yang berubah sejak kemarin”,
dan pertanyaan yang terjawab. Linimasa **selalu terbaru dulu**, dengan simpul
“masih terbuka” disematkan di paling atas; pilihan “kronologis” tidak
dikirim ke produksi (keputusan 2026-11-16). Yang tidak berubah: edisi nasional, rekap
mingguan, gerbang terbit §4.1, dan edisi yang sudah terbit (tidak dibangun
ulang). Terkait `DEC-0011` dan `DEC-0019` (manifest sadar scope).

## 3. Rencana

Tahap A — pipeline (tanpa UI, kontrak di §4) — **sudah dikerjakan 2026-11-16**:

1. `src/core/edition-scope.ts` + `scripts/build.ts` — `localEditionEnabled()`
   default **mati**; `LOCAL_EDITION=1` mengembalikan perilaku lama. Log:
   `lokal: dilewati (LOCAL_EDITION=0)`.
2. `src/core/manifest.ts` — `latest_by_scope.lokal` tidak lagi diisi; kunci
   dibiarkan ada bernilai `null` agar klien lama tidak pecah.
3. `src/core/newsroom/selection.ts` — `SCOPE_BUDGET` terpusat: nasional
   `maxFollow` 2 → 3, `minFresh` 3, `target` 6 (tidak dinaikkan: batas kartu 8
   masih dipakai meta dan deep dive).
4. `tests/local-off.test.ts` — build tanpa edisi lokal, manifest `lokal: null`,
   edisi nasional tetap ≥3 berita baru.

Tahap B — tindak lanjut (mockup v1 disetujui 2026-11-16, **sudah dikerjakan**):

5. `docs/mockups/019-lanjutan.html` — chip “Lanjutan”, blok “Sejak kemarin”
   (3 baris), kutipan jawaban terakhir, dan layar linimasa bergaya Guardian:
   garis tipis, tanggal di kiri, satu peristiwa per simpul, filter
   Berubah/Terjawab/Terbuka. Urutan **terbaru dulu**; simpul “masih terbuka”
   selalu di paling atas dan tidak ikut terbalik.
6. `src/core/history.ts` + `src/core/newsroom/continuity.ts` — `history` dari
   tabel `revisions` (satu baris per edisi) dan `changes[]` untuk perubahan
   status. Judul sengaja tidak masuk `changes[]`: writer menulis ulang judul tiap
   hari, jadi itu akan jadi changelog palsu.
7. `public/app.js` + `public/style.css` — chip `Lanjutan` di feed dan detail,
   blok “Sejak kemarin”, linimasa lipat. 2 tes statis (`UI-03`, `UI-04`).

Tahap C — bersih-bersih:

8. `scripts/push.ts`, `scripts/serve.ts`, `public/app.js` — hapus jalur scope
   lokal yang tidak lagi punya data (tab hilang otomatis karena manifest null,
   tetapi kode mati sebaiknya dihapus).
9. `AGENTS.md`, `SCHEMA.md`, `RANKING.md` — catat bahwa lokal dihentikan dan
   alasannya.

## 4. Kontrak (tahap A)

Sebelum — 2026-11-14:

```
data/editions/2026-11-14.lokal.json          (5 kartu)
manifest.latest_by_scope = { nasional: "2026-11-14", lokal: "2026-11-14", mingguan: ... }
```

Sesudah — build berikutnya:

```
data/editions/<tanggal>.lokal.json           (tidak dibuat)
manifest.latest_by_scope = { nasional: "<tanggal>", lokal: null, mingguan: ... }
log: "lokal: dilewati (LOCAL_EDITION=0)"
```

Aturan:

- `LOCAL_EDITION=1` mengembalikan perilaku lama tanpa perubahan kode.
- File lokal lama **tidak dihapus**; hanya tidak ada yang baru.
- `publish.ts` tetap menyalin seluruh isi `data/editions/`.

### 4b. Isi mockup (tahap B)

Data nyata, bukan contoh karangan:

| Sumber | Isi | Angka |
|---|---|---:|
| `revisions` | judul kartu per edisi untuk topik yang sama | 2 edisi |
| `editor_notes` | pertanyaan terjawab + kutipan | 17 |
| `editor_notes` | pertanyaan masih `open` | 19 |

Topik contoh: `t_dasco_akui_banyak_anggota_dpr_4cca`.

Yang belum bisa ditampilkan: badan kartu per hari. `revisions` hanya menyimpan
judul (`title`, `angle`, `kind`), bukan badan. Karena itu mockup menampilkan
badan sebagai blok kosong berlabel, dan tahap B menambah simpanan ringkas
(status + satu kalimat klaim) per edisi.

## 5. Tes

- `tests/local-off.test.ts` — tidak ada file lokal, manifest `lokal: null`,
  kartu nasional tidak berkurang.
- `tests/manifest.test.ts` (tambahan)— scope dengan `null` tidak muncul sebagai
  tab; scope basi tetap disembunyikan (`DEC-0019`).
- `tests-ui/shell.spec.ts` (tahap B) — chip “Lanjutan” tidak muncul pada kartu
  `revision = 1`; simpul pertama selalu yang terbaru, dan “masih terbuka”
  berada di atasnya walau daftar dibalik.

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| Kehilangan liputan Sleman sepenuhnya | hanya 5 dari 7 hari terakhir yang punya edisi lokal; berita Sleman tetap masuk klaster nasional bila memenuhi aturan |
| Kuota follow-up naik → edisi penuh lanjutan | `minFresh` tetap 3; aturan “follow-up ≤ berita baru” tidak berubah |
| Klien lama membaca `latest_by_scope.lokal` | kunci tetap ada, bernilai `null`; `app.js` sudah menangani `null` |
| `changes[]` kosong membuat blok “Sejak kemarin” kosong | blok disembunyikan bila tidak ada isi; jangan mengarang perubahan |

Rollback: `LOCAL_EDITION=1`. Untuk tahap B, hapus blok UI; data tidak berubah.

## 7. Riwayat

- `2026-11-16` — `plan-draft` — bukti: lokal terakhir 11-14, `latest_by_scope.lokal`
  `null`, 5/8 kartu 11-13 adalah revisi, `grep previous_edition public/app.js`
  kosong.
- `2026-11-16` — `mockup-v1` — `docs/mockups/019-lanjutan.html`: linimasa gaya
  Guardian dari `revisions` + `editor_notes` (2 edisi, 17 terjawab, 19 terbuka),
  0 panggilan LLM.
- `2026-11-16` — `mockup-v1` — arah disetujui: **terbaru dulu**, simpul terbuka
  disematkan di atas. Toggle kronologis hanya ada di mockup, tidak dikirim.
- `2026-11-16` — `implementing` — tahap B dikerjakan: `history` + `changes`
  status, chip dan linimasa di `app.js`. `npm test` 286 lulus,
  `npm run test:ui` 10 lulus, typecheck bersih. Diverifikasi di fixture
  (`#/nasional/2026-11-11/0`): chip “Lanjutan · 2”, baris “status belum →
  sebagian”, 3 simpul linimasa.
- `2026-11-16` — `implementing` — tahap A dikerjakan: lokal mati secara default
  (`LOCAL_EDITION=1` untuk rollback), kuota tindak lanjut nasional 2 → 3,
  `SCOPE_BUDGET` terpusat. 5 uji baru di `tests/local-off.test.ts`; `npm test`
  277 lulus, `npm run typecheck` bersih.

## 8. Pelajaran (diisi setelah `shipped`)

—
