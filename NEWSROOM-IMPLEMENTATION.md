# Newsroom — Rencana Implementasi Produksi

**Versi:** 0.1
**Tanggal:** 10 November 2026
**Status:** P1 selesai; newsroom menjadi default dengan rollback `--no-newsroom`
**Bergantung pada:** `NEWSROOM.md` (desain + hasil POC), `SCHEMA.md`, `INFRA.md` §11

---

## 1. Keputusan yang sudah dikunci dari POC

| # | Keputusan | Bukti POC |
|---|---|---|
| K1 | Riset material penuh adalah pengungkit terbesar, bukan jumlah peran | bahan 1.722 → 8.835 karakter; fakta unik 16 → 99 |
| K2 | Setiap paragraf wajib menunjuk `source_id` | 3/3 kartu bersitasi |
| K3 | Panjang **advisory**: 300–600 kata harian, 1.200–2.500 kata mendalam | 1.147 / 920 / 500 kata; tidak memaksa retry |
| K4 | Gerbang terbit hanya fakta salah, typo, teks terpotong | 3/3 terbit; temuan lain jadi advisory |
| K5 | Konflik sumber terbit dengan `disclaimer` kuat, bukan digugurkan | DPR/Ahrie/ESDM terbit dengan peringatan |
| K6 | Catatan editor menjadi ledger lintas hari | 15 terbuka, 53 terjawab dengan kutipan |
| K7 | Kartu membawa `unresolved` publik | 3/3 kartu menampilkan "Yang belum terjawab" |
| K8 | Writer memperbaiki fakta sebelum kartu digugurkan | `repairFactDraft` terpakai di ketiga kartu |

---

## 2. Arsitektur produksi

```
ingest → cluster → adjudicate ─┐
                               ├─► planner (assignment: depth/answers/note_ids)
editor_notes (DB) ─────────────┘        │
                                        ▼
                              rank/select (aturan, tidak berubah)
                                        │
                                        ▼
                         riset ─► writer ─► editor ─► repair fakta
                                        │        │
                                        │        └─► ledger (DB)
                                        ▼
                              kartu + disclaimer + unresolved
                                        │
                                        ▼
                              validateEdition → publish
```

Modul:

| Modul | Fungsi | Status |
|---|---|---|
| `src/core/newsroom/plan.ts` | planner + `depthFor` | ada (POC) |
| `src/core/newsroom/material.ts` | riset + ekstraksi | ada |
| `src/core/newsroom/write.ts` | writer + repair fakta | ada |
| `src/core/newsroom/edit.ts` | aturan + editor + kebijakan | ada |
| `src/core/newsroom/notes.ts` | ledger, dedupe, lifecycle | ada |
| `src/core/newsroom/desk.ts` | gerbang edisi | ada |
| `src/core/newsroom/card.ts` | **baru** — satu kartu dari riset sampai siap terbit | P1 |
| `src/core/newsroom/store.ts` | **baru** — ledger ↔ SQLite | P1 |

---

## 3. Perubahan data

### 3.1 `edition.json` (sudah)

| Field | Perubahan |
|---|---|
| `body` | 1–24 paragraf; tiap ≤1.000 karakter |
| `unresolved` | 0–3 string, 8–120 karakter |
| `disclaimer` | string 20–320 karakter |
| `deep_dive.read_min` | 4–15 |

Tidak menaikkan `schema_version` (semua field opsional/kelonggaran).

### 3.2 Tabel baru

```sql
CREATE TABLE editor_notes (
  id            TEXT PRIMARY KEY,
  topic_id      TEXT NOT NULL,
  kind          TEXT NOT NULL,      -- coverage_gap | verification_gap | risk
  question      TEXT NOT NULL,
  detail        TEXT NOT NULL,
  origin_json   TEXT NOT NULL,
  status        TEXT NOT NULL,      -- open | waiting | answered | dropped
  first_seen    TEXT NOT NULL,
  last_seen     TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 1,
  weight        INTEGER NOT NULL DEFAULT 1,
  next_action   TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  resolved_json TEXT
);
CREATE INDEX idx_notes_status ON editor_notes(status, expires_at);
```

`notes.ts` tetap menjadi satu-satunya tempat aturan dedupe/lifecycle; `store.ts` hanya memetakan baris.

---

## 4. Fase

### P0 — POC (selesai)

Membuktikan kualitas dan kebijakan. Artefak: `data/work/poc-newsroom/`, `scripts/poc-newsroom.ts`.

### P1 — Pipeline kartu di produksi (sekarang)

**Tujuan:** `build.ts` memakai riset + sitasi + editor + repair fakta + disclaimer + unresolved untuk kartu yang dipilih aturan yang sudah ada.

| Item | Detail |
|---|---|
| Flag | `NEWSROOM_WRITE=1` atau `--newsroom` |
| Planner | Satu panggilan `planEdition` setelah adjudikasi; assignment ditempel ke entry |
| Kartu | `writeNewsroomCard()`: riset → writer → editor → revisi → repair fakta → kartu |
| Catatan | Ledger dimuat dari DB; temuan baru di-merge dan disimpan |
| Deep | Satu assignment `deep` menjadi `deep_dive`; sisanya `news` |
| Fallback | LLM gagal / kartu null → writer lama (`writer-llm` → deterministik) |
| Gate | Kartu dengan fakta terbukti salah gugur; konflik sumber terbit dengan disclaimer |

**Selesai bila:** `npm run build -- --newsroom --date …` menghasilkan edisi valid; kartu punya `unresolved`/`disclaimer`; ledger bertambah; jalur lama tetap identik tanpa flag.

### P2 — Planner tindak lanjut penuh

- `editorial_queue`/notes dibaca planner setiap hari (sudah di P1) dan dipakai untuk memilih follow-up.
- Catatan `waiting` tidak ditawarkan terus-menerus.
- `note_ids` ditutup hanya oleh `notes_resolved` ber-kutipan (sudah).

**Kuota tindak lanjut (diterapkan di `planCards`):**

| | Nasional | Lokal |
|---|---:|---:|
| Maksimum kartu tindak lanjut | 2 | 1 |
| Minimum berita baru | 3 | 1 |
| Target kandidat | 6 | 4 |
| Maksimum catatan per tugas | 2 | 2 |

Tindak lanjut **memakai slot kartu normal**, bukan kartu ke-9 (skema maksimum 8).
Aturannya:

1. Berita baru diutamakan; tindak lanjut hanya mengisi sisa slot.
2. Bila berita baru < minimum, jumlah tindak lanjut ≤ jumlah berita baru.
3. Bila tidak ada berita baru sama sekali, **tidak ada** tindak lanjut yang
   dipaksakan; edisi menjadi tipis (`truncated_reason`).
4. Kandidat baru diambil dari pool yang kalah kuota, bukan dari cerita lama.
5. Satu catatan hanya boleh ditutup oleh satu kartu; editor tetap wajib
   menyertakan kutipan (`notes_resolved`).

### P3 — Desk dan shadow

- `reviewEdition` dijalankan setelah kartu; vonisnya **advisory** (tidak menahan).
- `NEWSROOM_DESK=off` untuk mematikan. Default menyala saat `--newsroom`.
- Pemantauan 3 edisi pada jalur default; rollback `--no-newsroom` bila ada regresi.
- Bandingkan metrik dengan edisi lama.

### P4 — Default

- `--newsroom` menjadi **default**; rollback `--no-newsroom` / `NEWSROOM_WRITE=0`.
- Paritas lokal, hoax, good_news, gambar, dan deep dive.
- Shadow 5 edisi dilewati; pemantauan 3 edisi dilakukan pada jalur default.
- Jalur lama tetap ada sebagai rollback, belum dihapus.

---

## 5. Metrik penerimaan

| Metrik | Target P1 |
|---|---|
| Edisi valid | 5/5 hari |
| Kartu punya sitasi per paragraf | ≥95% |
| Fakta terbukti salah terbit | 0 |
| Kartu dengan disclaimer | tercatat, bukan kegagalan |
| Waktu build | ≤15 menit |
| Biaya | ≤$0,15/edisi |
| Regresi jalur lama | 0 (flag off) |

---

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| Build lambat | konkurensi 3–4, batas `--newsroom-limit`, cache material |
| LLM gagal | fallback writer lama per kartu |
| Disclaimer terlalu sering | filter temuan yang benar-benar konflik; audit 3 edisi |
| Catatan menumpuk | TTL + `waiting` setelah 14 hari |
| Skema berubah | field opsional; validator lama tetap menerima |
| Rollback | hapus flag `--newsroom`; tidak ada migrasi yang merusak |

---

## 7. Checklist implementasi P1

- [x] Skema `body`, `unresolved`, `disclaimer`, `read_min`
- [x] Migrasi `004_editor_notes.sql`
- [x] `src/core/newsroom/store.ts`
- [x] `src/core/newsroom/card.ts`
- [x] Integrasi `build.ts` di balik `--newsroom`
- [x] `good_news` memakai writer newsroom saat flag aktif
- [x] Desk review shadow (`NEWSROOM_DESK=off` untuk mematikan)
- [x] Uji unit pipeline kartu + store
- [x] Jalankan `build --newsroom` pada satu tanggal
- [x] Bandingkan dengan edisi lama (uji terbatas 2 kartu)
- [ ] Putuskan P2/P3

### P4a — sumber primer (selesai)

- `config/primary-sources.yaml`: peta entitas → domain resmi + halaman listing.
- `primary.ts`: tiga jalur deterministik — artikel resmi di klaster, artikel
  resmi di database, dan listing resmi. Tidak ada crawl bebas.
- BPS: `bps.go.id` dan BPS DIY; daftar Berita Resmi Statistik memakai
  `BPS_API_KEY` (opsional). Tanpa kunci, BPS hanya diambil dari tautan resmi
  yang sudah ada di artikel/database.
- Hanya bahan yang **disitasi writer** yang masuk `sources` dan `truth`;
  bahan primer yang tidak dikutip tidak menaikkan status.
- RSS resmi KPK/OJK/BPS/MA tidak tersedia (diuji 10 Nov 2026); halaman listing
  resmi dipakai sebagai pengganti. PDF dan sitemap masuk P4b.

### Prioritas 5–6 (selesai)

| Prioritas | Implementasi | Bukti |
|---|---|---|
| 5. Paritas lokal | `toCard` mengisi 2 pertanyaan konteks dari satu artikel lokal; kartu 1 sumber tidak lagi jatuh ke writer lama | uji kartu lokal 1 sumber |
| 6. Cache fetch | `006_article_text.sql` + `createDbFetchCache`; kunci hash URL + versi ekstraktor, TTL 14 hari | uji cache hit: fetch kedua = 0 request |

Cache sengaja hanya untuk teks artikel, bukan output LLM: build harian memakai
URL baru, sedangkan retry/backfill mendapat manfaat terbesar.

### Prioritas 1–3 (selesai)

| Prioritas | Implementasi | Bukti |
|---|---|---|
| 1. Telemetri | `005_llm_calls.sql`, `LlmTelemetry` membungkus adapter; `run_log` menyimpan agregat | 28 panggilan · 97.105/30.779 token · max 20.856 ms |
| 2. Penulis hoaks | `src/core/newsroom/hoax.ts`; verdict deterministik, model hanya framing | 3 paragraf · 181 kata · 3 item utuh |
| 3. Kuota tindak lanjut | `selection.ts` + `planCards`: maks 2 nasional/1 lokal, min 3/1 berita baru, nol berita baru = nol tindak lanjut | 4 uji kuota |

Biaya masih `$0.0000` karena pricing provider belum dikonfigurasi; token dan latensi sudah tercatat.

### Catatan implementasi P1

- `writeNewsroomCard()` mengembalikan `blocked: true` hanya bila fakta terbukti
  salah. Kegagalan bentuk (mis. `explain` kurang) jatuh ke writer lama, bukan
  menggugurkan kartu.
- `explain` punya fallback deterministik dari bahan artikel bila glosarium dan
  Wikipedia tidak memberi konteks. Ini mencegah kartu hilang di topik lokal
  yang tidak ada di glosarium.
- `--newsroom-limit N` hanya untuk uji integrasi; produksi tidak memakainya.
- Jalur lama (tanpa flag) tidak berubah.
- Catatan internal disimpan utuh di SQLite: pertanyaan 1.200, detail 8.000,
  tindakan 1.200, temuan editor 4.000. Hanya field publik `unresolved` (120)
  dan `disclaimer` (320) yang dipendekkan sesuai skema.

### Hasil integrasi 10 November (uji `--newsroom-limit 2 --thin`)

| Artefak | Hasil |
|---|---|
| Nasional | 4 kartu (2 news newsroom + hoax + good_news), terbit tipis, valid |
| Lokal | 2 kartu, valid |
| Kartu newsroom | 365 kata dan 1.174 kata; keduanya membawa disclaimer |
| `unresolved` | 1 kartu membawa pertanyaan publik |
| Ledger | 24 terbuka, 23 terjawab (53 total) |
| Jalur lama | 1 kartu lokal jatuh ke writer lama karena hanya 1 sumber |

Catatan: uji ini memakai `--newsroom-limit 2`, jadi bukan edisi penuh. Edisi
asli 10 November dipulihkan setelah uji; salinan hasil uji ada di
`data/work/build-newsroom3/`.

**Yang belum setara:** `hoax_roundup` dan sebagian kartu lokal masih memakai
jalur lama. `good_news` sudah dipindah ke writer newsroom saat flag aktif.

### Hasil build penuh (tanpa limit)

`npm run build -- --newsroom --thin --date 2026-11-10`

| Artefak | Hasil |
|---|---|
| Nasional | **8 kartu, valid** (6 news + hoax + good_news), waktu baca 15 menit |
| Lokal | 3 kartu, valid |
| Newsroom news | 349, 1.030, 490, 140, 162, 115 kata |
| `good_news` | 314 kata (sebelumnya 33 kata di jalur lama) |
| Desk shadow | layak, 0 advisory |
| Ledger | 24 terbuka, 23 terjawab |

**Temuan build penuh:** edisi lokal memuat tiga kartu tentang peristiwa PSI yang
sama. Adjudikasi memecahnya menjadi beberapa topik dan dedupe topik tidak
menangkap judul yang ditulis ulang. Perbaikannya: `dedupeCards()` di
`src/core/newsroom/dedupe.ts`, dipanggil sebelum `buildEdition` (ambang 0,6
nasional, 0,5 lokal), memilih kartu dengan sumber/isi lebih kuat. Sudah diuji.

**Rerun dengan dedupe:** nasional **8 kartu valid**, lokal **3 kartu valid**;
duplikat judul persis hilang. Tiga kartu PSI yang tersisa memiliki sudut
berbeda (klaim eksodus, kursi DPR, dampak Sleman), jadi tidak digabung.

Edisi asli dipulihkan setelah uji; salinan hasil build penuh ada di
`data/work/build-newsroom-full/` dan `data/work/build-newsroom-full2/`.

Catatan kualitas: beberapa kartu `brief` hanya 115–162 kata (target 150–250,
advisory) dan satu kartu hanya 1 sumber. Kartu dengan assignment `deep` tetapi
hanya 2 sumber tetap menjadi `news`, bukan `deep_dive`.

---

## 8. Pertanyaan terbuka

| # | Pertanyaan | Menentukan |
|---|---|---|
| Q1 | ~~Apakah `--newsroom` menjadi default setelah 5 edisi?~~ **Diputuskan: default sekarang, rollback `--no-newsroom`** | rollout |
| Q2 | Berapa batas kata final untuk edisi 8 kartu? | produk |
| Q3 | Apakah disclaimer perlu tingkat (ringan/berat)? | UI |
| Q4 | Apakah `unresolved` tampil di edisi mingguan? | konsistensi |
| Q5 | Sumber primer: tambah pencarian `.go.id`/OJK/BPS? | kualitas |
