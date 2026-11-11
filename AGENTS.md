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
| Jalur mingguan | **Newsroom** (`scripts/weekly.ts`, 004); rollback `WEEKLY_WRITER=legacy` |
| Rollback | `--no-newsroom` atau `NEWSROOM_WRITE=0` |
| CI | GitHub Actions `daily.yml`, 05:45 WIB, timeout 45 menit |
| Provider CI | **OpenCode saja**, model `opencode-go/deepseek-v4.1-flash` (`DEC-0017`); DeepSeek API langsung nonaktif (`DEC-0016`) |
| Edisi terakhir | `2026-11-11` nasional 8 kartu + lokal 4 kartu |
| Kartu meta | `change` (status) + `misread` (judul–isi), deterministik |
| Tests | `npm test` — 212 uji; `npm run test:ui` — 4 uji browser |
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
| `src/core/newsroom/meta.ts` | Kartu `change`/`misread` deterministik |
| `src/core/weekly-newsroom.ts` | Assignment + bentuk kartu rekap mingguan |
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
- **kartu meta tidak pernah didedupe** — judulnya mirip karena membahas kartu berita yang sama

### 4.7 Kartu meta

- `change`: hanya bila **status** klaim berbeda dari edisi sebelumnya dengan `topic_id` sama. Angka **tidak** dipakai (pernah menghasilkan “2026 → 28”).
- `misread`: kualifikasi prosedural di teks penuh (`article_text`, ≥500 char) yang tidak ada di judul. Kalimat wajib berbagi kata subjek dengan judul; judul yang sudah memuat sinonim kualifikasi (`belum`, `wacana`, `rencana`, …) tidak layak.
- `missing` berisi **fakta** (mis. “masih berupa usulan, bukan keputusan”), bukan nama kualifikasi.
- Maksimum 1 `change` + 1 `misread`; dua kartu memakai satu slot berita dan `hoax_roundup` selalu dipertahankan (maks 8).
- `changes[]` hasil `change` juga ditempel ke kartu berita agar hitungan pembaruan push benar.
- Desk tidak menilai kartu meta dengan standar berita.
- `gap`/`debate` belum dibuat: butuh amplifikasi (Reddit/komentar/Trends/TikTok).

---

## 5. Gotchas yang mahal

### Node/TypeScript

- Node 24 menjalankan TS dengan **strip-only**. Jangan pakai:
  - parameter properties (`constructor(private x)`)
  - `enum`, `namespace`
- Tulis field class eksplisit.
- Tes memakai `node --test`, tanpa jaringan.

### UI shell, PWA, dan Pages

- Situs dilayani dari `/edisi-pagi/`: **semua path harus relatif**. Path absolut (`/style.css`) membuat app berhenti di “Memuat…”.
- Pages meng-cache `app.js` 10 menit. `publish.ts` menulis `?v=<sha1>` untuk `app.js`/`style.css`; tanpa itu deploy terlihat tidak berubah.
- Service worker v4: navigasi memakai shell cache, data network-first, aset berversi cache-first, plus fallback ke nama tanpa query. Uji offline dengan mematikan server, bukan hanya DevTools.
- `beforeinstallprompt` tidak ada di Electron/browser in-app; fallback instruksi wajib. Tombol asli muncul di Chrome Android; iOS hanya instruksi “Tambah ke Layar Utama”.
- Push payload memakai URL relatif scope (`./`); `/` membuka akar domain yang salah.
- `latest_by_scope` menyembunyikan tab mingguan di hari non-Minggu. Itu keputusan produk.
- `npm run serve` default melayani di akar, sedangkan produksi di `/edisi-pagi/`. Pakai `BASE_PATH=/edisi-pagi npm run serve` untuk mereproduksi produksi; tanpa itu bug path absolut tidak muncul di lokal (`DEC-0015`).
- `public/index.html` ditulis ulang di tempat oleh `publish.ts` (`?v=<sha1>`); berkas di repo adalah hasil publish, bukan sumber terpisah.
- Asersi UI tanpa browser ada di `tests/ui-static.test.ts` dan ikut `npm test`; asersi browser ada di `tests-ui/shell.spec.ts` dan dijalankan `npm run test:ui` (`DEC-0014`).
- `npm run test:ui` memakai `fixtures/ui/public/` (hasil `npm run prepare:ui`, di-.gitignore) dan server yang sama (`ROOT`) di `BASE_PATH=/edisi-pagi`. Tidak menyentuh edisi terbit, tidak memakai jaringan. Workflow: `ui.yml`, terpisah dari `daily.yml` (`DEC-0013`).

### State CI

- `.gitignore` pola `local.db` cocok di **kedalaman mana pun** dan diam-diam mengabaikan `data/state/local.db`. Akibatnya setiap run CI mulai kosong: tanpa riwayat 7 hari, tanpa langganan push.
- Perbaikan: `/local.db` hanya di akar, `data/state/*.db` diabaikan sengaja, lalu `actions/cache` bergulir (`edisi-state-<run_id>`, restore prefix `edisi-state-`).
- `npm run state:info` mencetak jumlah artikel sebelum ingest; angka 0 di run kedua = cache tidak terbawa.
- Commit bot bukan syarat deploy. Push manusia saat run berjalan pernah menggagalkan langkah commit dan melewati deploy. Langkah commit kini retry + `continue-on-error`, dan deploy tetap jalan.
- `continue-on-error: true` **tidak selalu** menyelamatkan job (terlihat pada langkah auth OpenCode). Untuk langkah opsional, tangani kegagalan di dalam skrip (`if ! cmd; then ... exit 0; fi`).

### Sumber Sleman / lokal

- `fallbackTopics(summarise([cluster]))` selalu memberi `cid: "c01"`. Dulu `isFollowTopic` mencocokkannya dengan entri nasional `c01`, mengira semua brief lokal adalah follow-up, lalu kuota membuang seluruh edisi Sleman. Solusi: cid unik `solo_<cluster-key>` + cocokkan identitas objek lebih dulu.
- Brief lokal boleh 1 sumber; nasional minimal 2.
- Klaster lokal butuh mayoritas media DIY **dan** penanda wilayah; berita nasional dari media Jogja tetap nasional.
- Kicker memakai wilayah sebenarnya (`Sleman`, `Gunungkidul`, `Bantul`, `Kulon Progo`, `Yogyakarta`).

### OpenCode di CI

- **Jangan** pakai `https://opencode.ai/install` — itu v1.19.5.
- Pakai `https://opencode.ai/v2/install` — v2.2.7.
- Ekspor kredensial lokal: `opencode auth export` → secret `OPENCODE_AUTH_JSON`.
- Impor di CI: `opencode --standalone auth import`.
- `--standalone` wajib untuk auth agar tidak bentrok dengan service desktop.
- `opencode.ai/v2/install` memasang ke `$HOME/.opencode/bin`.
- Jika install/auth gagal, workflow set `OPENCODE_BIN=/nonexistent` agar pipeline memakai penulis deterministik, bukan menunggu timeout. **Bukan** agar DeepSeek dipakai (`DEC-0016`).
- `OPENCODE_AUTH_JSON` adalah kredensial pribadi; rotasi bila perlu.
- Model diverifikasi ke katalog (`opencode models`) sebelum panggilan pertama (`DEC-0018`). Model tidak ada → deterministik; katalog tak terbaca → lanjut dengan peringatan. Jangan hapus cek ini tanpa mengganti `DEC-0018`.

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
| CI memakai penulis deterministik | `OPENCODE_BIN` kosong; versi CLI; `OPENCODE_AUTH_JSON`; model tidak ada di katalog (`DEC-0018`); log `opencode tidak tersedia` |
| Edisi lokal tidak terbit | log `lokal: N kandidat · M lolos`; cid `c01` vs `solo_`; dedupe; minimal 2 |
| Kartu meta tidak muncul | log `meta: ... · lanjut x/y · teks a/b · celah c`; `topic_id` berlanjut?; judul sudah berkualifikasi? |
| Kartu meta hilang dari edisi | dedupe (harus dilewati untuk meta); slot 8 kartu; hoax diprioritaskan |
| Tab scope hilang | `latest_by_scope`; edisi scope itu tidak ada di tanggal terbaru |
| App berhenti di “Memuat…” | path absolut; `app.js` 404; cache SW lama |
| Offline kosong | SW v4; `edisi-shell-v4`; fallback aset tanpa query |
| Push membuka halaman salah | URL payload harus `./`, bukan `/` |
| CI state kosong tiap run | cache `edisi-state-`; `.gitignore` `data/state/*.db`; `state:info` |
| Deploy tidak jalan padahal build sukses | langkah commit/push; `continue-on-error`; cek step yang gagal |
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
4. **Satu perubahan kebijakan = satu tes** yang mengunci perilakunya, dengan `DEC-xxxx` di komentar tes (`docs/DECISIONS.md`).
5. **Jangan menambah loop tanpa batas.** Maksimum 2 revisi + 1 repair fakta; setelah itu sempitkan atau gugurkan.
6. **Jangan biarkan LLM menjadi gerbang newsworthiness.** Planner memilih; aturan memutuskan terbit.
7. **Catat kegagalan dengan alasan.** `blocked`, `fallback`, `defensive` harus terlihat di log.
8. **Hati-hati konkurensi repo.** Bot dan agen lain bisa push; rebase, jangan force.
9. **Rollback harus selalu tersedia.** `--no-newsroom`, `NEWSROOM_DESK=off`, `OPENCODE_BIN=/nonexistent`.
10. **Baca angka, bukan kesan.** Token, latensi, fallback, disclaimer, kartu unik.
11. **Rencana sebelum kode.** Perubahan apa pun punya rencana di `docs/plans/` yang terdaftar di `docs/PLAN-INDEX.md`. Kelas UI butuh mockup disetujui manusia; kelas pipeline/infra butuh kontrak.
12. **Selesai berarti terverifikasi.** Langkah terakhir bukan “push”, tapi cek `latest_by_scope` dan URL edisi di Pages.

### Alur perubahan

Alur enam langkah, mesin keadaan, dan gerbangnya: `docs/WORKFLOW.md` (`DEC-0011`).
Ringkas:

| Kelas | Sebelum kode | Tes |
|---|---|---|
| UI | mockup HTML bertoken sama + persetujuan manusia | unit + `npm run test:ui` |
| pipeline | kontrak: potongan `edition.json` / baris log sebelum–sesudah | unit |
| infra | kontrak: perintah + keluaran yang diharapkan | tes + satu run CI |
| docs | — | `typecheck` bila menyentuh kode |

- **Tidak ada implementasi sebelum `mockup-approved`.** Hanya manusia yang boleh
  menyetujui status; agen mengusulkan dan menjalankan.
- Rencana **append-only**: ubah arah = tambah §Revisi, jangan hapus riwayat.
- Insiden produksi memakai jalur darurat: perbaiki → tes → push → rencana
  retroaktif dalam 24 jam.
- Mockup memakai token `public/style.css`; setelah disetujui tidak diedit
  (`DEC-0012`). Tes UI berjalan di workflow sendiri, bukan `daily.yml`
  (`DEC-0013`).

---

## 8. Skill verifikasi

```bash
# manifest + edisi live
curl -s https://abbadaim.github.io/edisi-pagi/manifest.json | python3 -m json.tool
curl -s https://abbadaim.github.io/edisi-pagi/data/editions/2026-11-11.nasional.json \
  | python3 -c 'import json,sys; e=json.load(sys.stdin); [print(c["type"], c["title"][:60]) for c in e["cards"]]'

# validasi lokal
npm run validate -- data/editions/2026-11-11.nasional.json

# smoke OpenCode CI (tanpa menyentuh edisi)
gh workflow run opencode-smoke.yml --repo abbadaim/edisi-pagi
gh run list --workflow opencode-smoke.yml --limit 1
```

Di browser:

1. Buka manifest, cek `latest_by_scope`.
2. Cek nav: `.bar .it` = Edisi/Sleman/Mingguan (bila ada)/Atur.
3. Buka `#/atur`: panel Pasang, Notifikasi, Tentang.
4. Untuk `misread`: detail harus menampilkan chip “Kata yang hilang dari judul”; `change` menampilkan timeline sebelum/sesudah.
5. Uji offline: hentikan server lokal, reload; shell dan edisi terakhir harus tetap tampil.
6. Saat menguji `app.js` baru, hapus cache + unregister SW lebih dulu.

Jangan menguji dengan menjalankan ulang tanggal yang sudah terbit. Pakai
`--newsroom-limit 2 --thin` pada tanggal baru atau POC.

---

## 9. Dokumen terkait

**Alur kerja:**

- `docs/WORKFLOW.md` — alur enam langkah, kelas perubahan, mesin keadaan, jalur darurat.
- `docs/PLAN-INDEX.md` — daftar rencana berjalan; satu-satunya pintu masuk.
- `docs/DECISIONS.md` — keputusan bernomor `DEC-0001…`, dirujuk tes.
- `docs/learnings/YYYY-MM.md` — apa yang terjadi, dengan bukti dan angka.
- `docs/plans/001-ui-test-harness.md` — harness tes UI (status `plan-draft`).

**Desain:**

- `NEWSROOM.md` — desain lima peran, kontrak, hasil POC.
- `NEWSROOM-IMPLEMENTATION.md` — fase P1–P4, telemetri, prioritas.
- `SESSION-LEARNINGS.md` — catatan sesi 10–11 November 2026 (arsip).
- `.opencode/skills/edisi-pagi/SKILL.md` — skill proyek: alur kerja, aturan
  yang mengikat, verifikasi, dan tabel debugging.
- `SCHEMA.md` — kontrak `edition.json`.
- `INFRA.md` — CI, Turso, Pages, OpenCode.
