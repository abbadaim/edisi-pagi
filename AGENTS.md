# AGENTS.md — panduan sesi berikutnya

**Proyek:** Edisi Pagi — brief berita harian pribadi, Kabupaten Sleman/DIY.
**Terakhir diperbarui:** 11 November 2026.
**Dokumen desain:** `REQUIREMENTS.md`, `SCHEMA.md`, `CLUSTERING.md`, `RANKING.md`, `INFRA.md`, `NEWSROOM.md`, `NEWSROOM-IMPLEMENTATION.md`.

Dokumen ini adalah ringkasan kerja untuk sesi OpenCode berikutnya. Baca ini lebih dulu, lalu dokumen desain yang relevan.

---

## 1. Status saat ini

| Hal | Status |
|---|---|
| Jalur produksi | **Newsroom default** (`scripts/build.ts`) |
| Rollback | `--no-newsroom` atau `NEWSROOM_WRITE=0` |
| CI | GitHub Actions `daily.yml`, 05:45 WIB, timeout 45 menit |
| Provider CI | OpenCode v2 → DeepSeek fallback |
| Edisi terakhir | `2026-11-11` nasional 8 kartu + lokal 5 kartu |
| Tests | `npm test` — 189 uji |
| Typecheck | `npm run typecheck` |

Jangan menganggap angka di atas permanen; periksa `git log`, `gh run list`, dan `data/editions/` sebelum menyimpulkan.

---

## 2. Peta arsitektur

```
ingest → cluster → adjudicate → planner → rank/select
                                      │
                                      ▼
                        riset → writer → editor → repair fakta
                                      │
                                      ├→ ledger catatan (SQLite)
                                      └→ kartu + disclaimer + unresolved
                                      ▼
                              validate → publish → Pages
```

| Modul | Fungsi |
|---|---|
| `src/core/newsroom/plan.ts` | Planner: depth, `answers[]`, `note_ids` |
| `src/core/newsroom/material.ts` | Riset teks penuh + cache |
| `src/core/newsroom/primary.ts` | Sumber primer (P4a) |
| `src/core/newsroom/write.ts` | Writer + repair fakta |
| `src/core/newsroom/edit.ts` | Aturan + editor + kebijakan fakta |
| `src/core/newsroom/card.ts` | Satu kartu dari riset sampai siap terbit |
| `src/core/newsroom/notes.ts` | Ledger, dedupe, lifecycle |
| `src/core/newsroom/store.ts` | Ledger ↔ SQLite |
| `src/core/newsroom/selection.ts` | Kuota tindak lanjut |
| `src/core/newsroom/dedupe.ts` | Dedupe kartu akhir |
| `src/core/newsroom/hoax.ts` | Penulis kartu hoaks |
| `src/core/telemetry.ts` | `llm_calls` per panggilan |
| `scripts/build.ts` | Orkestrasi harian |
| `scripts/publish.ts` | `public/` + manifest |
| `scripts/poc-newsroom.ts` | POC lima peran |

---

## 3. Perintah penting

```bash
npm install
npm run migrate                 # WAJIB setelah pull; migrasi 004–006
npm run ingest
npm run build -- --date 2026-11-11
npm run build -- --no-newsroom --date 2026-11-11   # rollback
npm run build -- --newsroom-limit 2 --thin         # uji integrasi murah
npm test
npm run typecheck
npm run validate -- data/editions/2026-11-11.nasional.json
npm run publish
npm run serve
```

POC:

```bash
LLM_PROVIDER=deepseek npm run poc:newsroom -- --date 2026-11-10 --limit 3 --revisions 2
npm run poc:newsroom -- --date 2026-11-10 --rebuild-ledger --fresh-ledger
npm run poc:newsroom -- --date 2026-11-10 --attach-notes
```

CI:

```bash
gh run list --workflow daily.yml --limit 5
gh run watch <run-id> --exit-status
gh run view <run-id> --log | grep -E "planner newsroom|kartu:|llm:|desk shadow|lokal"
gh workflow run daily.yml --ref main
gh workflow run opencode-smoke.yml --ref main
```

---

## 4. Kebijakan yang mengikat

### 4.1 Gerbang terbit

Hanya tiga hal yang memblokir:

| Kode | Arti |
|---|---|
| `E-FACT` | sumber yang disitasi **bertentangan** dan kutipannya terverifikasi |
| `D-TYPO` | kata ganda, tanda tak seimbang, id bahan bocor, sisa markdown |
| `D-TRUNC` | judul menggantung, paragraf tanpa akhir, teks berakhir `…` |

Semua temuan lain **advisory**. Kelayakan berita adalah wewenang planner, bukan editor/desk.

- `E-FACT` yang sumbernya **saling bertentangan** → terbit dengan `disclaimer`, bukan gugur.
- `E-FACT` yang **terbukti salah** dan tidak bisa diperbaiki → kartu gugur.
- Writer yang **mengarang** detail saat repair → terbit dengan `disclaimer` + `unresolved`.
- `E-SAFE` → `risk` note; tidak memblokir.

### 4.2 Panjang

Target kata **advisory**:

| Depth | Kata | Paragraf |
|---|---:|---:|
| `brief` | 150–250 | 1–2 |
| `standard` | 300–600 | 3–6 |
| `deep` | 1.200–2.500 | 8–18 |

Jangan menambah retry otomatis hanya karena panjang kurang. `D-LEN` advisory.

### 4.3 Catatan editor

- Internal `editor_notes` menyimpan teks **utuh**: pertanyaan ≤1.200, detail ≤8.000, tindakan ≤1.200, temuan ≤4.000.
- Hanya field publik yang dipendekkan: `unresolved` ≤120, `disclaimer` ≤320.
- **Jangan menempelkan potongan issue editor ke disclaimer.** Disclaimer harus kalimat utuh.
- Catatan `waiting` tidak ditawarkan planner; hanya `open`.
- Penutupan catatan wajib `notes_resolved` dengan kutipan yang ada di draft.

### 4.4 Kuota tindak lanjut

| | Nasional | Lokal |
|---|---:|---:|
| Maks kartu follow-up | 2 | 1 |
| Minimum berita baru | 3 | 1 |
| Target kandidat | 6 | 4 |

Follow-up memakai slot normal. Jika berita baru kurang, follow-up ≤ berita baru. Nol berita baru = nol follow-up. Jangan pernah menerbitkan edisi yang seluruhnya follow-up.

### 4.5 Kartu publik

- `unresolved`: 0–3 pertanyaan yang belum dijawab bahan.
- `disclaimer`: peringatan kuat untuk konflik sumber; tampil di atas body.
- `manifest.latest_by_scope`: null menyembunyikan tab lokal/mingguan yang sudah basi.

### 4.6 Dedupe

`dedupeCards()` sebelum `buildEdition`:
- nasional ambang 0,6; lokal 0,5
- pilih kartu dengan sumber/isi/gambar lebih kuat
- hoax tidak digabung dengan news

---

## 5. Gotchas yang mahal

### Node/TypeScript

- Node 24 menjalankan TS dengan **strip-only**. Jangan pakai:
  - parameter properties (`constructor(private x)`)
  - `enum`, `namespace`
- Tulis field class eksplisit.
- Tes memakai `node --test`, tanpa jaringan.

### OpenCode di CI

- **Jangan** pakai `https://opencode.ai/install` — itu v1.19.5.
- Pakai `https://opencode.ai/v2/install` — v2.2.7.
- Ekspor kredensial lokal: `opencode auth export` → secret `OPENCODE_AUTH_JSON`.
- Impor di CI: `opencode --standalone auth import`.
- `--standalone` wajib untuk auth agar tidak bentrok dengan service desktop.
- `opencode.ai/v2/install` memasang ke `$HOME/.opencode/bin`.
- Jika install/auth gagal, workflow set `OPENCODE_BIN=/nonexistent` agar DeepSeek dipakai, bukan menunggu timeout.
- `OPENCODE_AUTH_JSON` adalah kredensial pribadi; rotasi bila perlu.

### CI dan commit

- Workflow bot meng-commit `data/` dan `public/` setiap run. **Selalu `git pull --rebase origin main` sebelum push.**
- Bisa ada proses lain/agen yang push bersamaan. Periksa `git log origin/main` setelah push.
- **Jangan menjalankan ulang tanggal edisi yang sudah terbit**; edisi immutable. Untuk uji, pakai `--newsroom-limit` + `--thin` pada tanggal yang belum ada, atau POC.
- `data/work/`, `local.db`, `.env.local` diabaikan. Jangan commit.
- Migrasi 004–006 harus jalan sebelum build di CI; workflow sudah melakukannya.

### Sumber primer

- RSS resmi KPK/OJK/BPS/MA tidak tersedia.

- OJK listing mengembalikan halaman kosong/terblokir.
- DPR dan BPS adalah JS-rendered; anchor tidak ada di HTML.
- Polri/KPK sering gagal fetch.
- BPS butuh `BPS_API_KEY`; tanpa itu hanya tautan BPS yang sudah ada di artikel.
- Jangan mengarang URL feed. Verifikasi dulu.
- P4b: sitemap, PDF, atau API resmi.

### Publisher

- `manifest.latest_by_scope` dihitung dari `latest`; lokal kemarin tidak ditampilkan.
- `publish.ts` menyalin semua edisi; app memfilter tab.
- Harga LLM belum dikonfigurasi; `cost_usd` sering 0. Token/latensi tetap tercatat.

---

## 6. Debugging cepat

| Gejala | Periksa |
|---|---|
| CI jatuh ke DeepSeek | `OPENCODE_BIN` kosong; versi CLI; `OPENCODE_AUTH_JSON`; log `opencode tidak tersedia` |
| Edisi lokal tidak terbit | log `lokal · ... kartu unik`; dedupe; minimal 2 |
| Tab lokal basi | `manifest.latest_by_scope`; publish baru |
| Catatan terpotong | internal vs publik; `clipText`; schema 120/320 |
| Semua kartu gugur | `E-FACT` terbukti salah; `D-TYPO`/`D-TRUNC`; lihat edit JSON |
| Build lambat | `llm_calls` role/latency; jumlah kartu; OpenCode spawn |
| Edisi tidak valid | `npm run validate -- <file>` |

---

## 7. Cara kerja yang terbukti

1. **Verifikasi sumber daya nyata** sebelum menulis kode: feed, URL, endpoint, versi CLI. Jangan menebak.
2. **Pisahkan internal dan publik.** Teks penuh untuk planner/editor; field publik pendek dan utuh kalimatnya.
3. **Uji unit dulu, lalu build terbatas** (`--newsroom-limit 2 --thin`) sebelum build penuh.
4. **Satu perubahan kebijakan = satu tes** yang mengunci perilakunya.
5. **Jangan menambah loop tanpa batas.** Maksimum 2 revisi + 1 repair fakta; setelah itu sempitkan atau gugurkan.
6. **Jangan biarkan LLM menjadi gerbang newsworthiness.** Planner memilih; aturan memutuskan terbit.
7. **Catat kegagalan dengan alasan.** `blocked`, `fallback`, `defensive` harus terlihat di log.
8. **Hati-hati konkurensi repo.** Bot dan agen lain bisa push; rebase, jangan force.
9. **Rollback harus selalu tersedia.** `--no-newsroom`, `NEWSROOM_DESK=off`, `OPENCODE_BIN=/nonexistent`.
10. **Baca angka, bukan kesan.** Token, latensi, fallback, disclaimer, kartu unik.

---

## 8. Dokumen terkait

- `NEWSROOM.md` — desain lima peran, kontrak, hasil POC.
- `NEWSROOM-IMPLEMENTATION.md` — fase P1–P4, telemetri, prioritas.
- `SESSION-LEARNINGS.md` — catatan sesi 10–11 November 2026.
- `SCHEMA.md` — kontrak `edition.json`.
- `INFRA.md` — CI, Turso, Pages, OpenCode.
