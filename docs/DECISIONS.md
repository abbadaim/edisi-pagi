# DECISIONS.md — keputusan yang dikunci

**Append-only.** Keputusan yang sudah tercatat tidak diedit; bila berubah,
tambahkan `DEC-xxxx` baru yang menyebut keputusan yang digantikannya.

Tes yang mengunci sebuah keputusan menyebut ID-nya di komentar:

```ts
// DEC-0006: panjang target advisory, bukan gerbang terbit
```

---

## DEC-0001 — Material dulu, peran kemudian

Riset teks penuh memberi lompatan kualitas terbesar; menambah peran tanpa bahan
tidak menolong. Cache `article_text` mendahului penambahan peran new.
_Sumber: `SESSION-LEARNINGS.md` §2.1._

## DEC-0002 — Sitasi per paragraf

Hanya bahan yang disitasi masuk `sources` dan `truth`. Bahan primer yang tidak
dikutip tidak boleh menaikkan status.

## DEC-0003 — Gerbang terbit sempit

Hanya `E-FACT` (fakta salah terbukti), `D-TYPO`, dan `D-TRUNC` yang memblokir.
Temuan lain advisory. Newsworthiness milik planner, bukan editor/desk.

## DEC-0004 — Konflik sumber terbit dengan disclaimer

Fakta yang terbukti salah tetap digugurkan. Konflik antar sumber → terbit dengan
`disclaimer`, bukan gugur.

## DEC-0005 — Perbaiki fakta sebelum gugur

Writer mendapat satu putaran repair. Mengarang saat repair → terbit dengan
disclaimer + `unresolved`, bukan gugur.

## DEC-0006 — Panjang advisory

Target 150–250 (`brief`), 300–600 (`standard`), 1.200–2.500 (`deep`) kata. Tidak
ada retry paksa karena panjang kurang.

## DEC-0007 — Catatan internal utuh, publik ringkas

`editor_notes` menyimpan teks penuh. Hanya field publik yang dipendekkan:
`unresolved` ≤120, `disclaimer` ≤320. Disclaimer harus kalimat utuh, bukan
potongan issue editor.

## DEC-0008 — Tindak lanjut berkuota

Maks 2 follow-up nasional / 1 lokal; minimum 3/1 berita baru. Follow-up ≤ berita
baru. Nol berita baru = nol follow-up. Edisi yang seluruhnya follow-up dilarang.

## DEC-0009 — Dedupe kartu akhir

`dedupeCards()` sebelum `buildEdition`: nasional 0,6; lokal 0,5. Kartu meta tidak
pernah didedupe; hoax tidak digabung dengan news.

## DEC-0010 — Manifest sadar scope

`latest_by_scope` dihitung dari `latest`; lokal kemarin tidak tampil sebagai edisi
hari ini. `null` menyembunyikan tab scope yang basi.

## DEC-0011 — Setiap perubahan punya rencana, mockup, dan tes

Alur enam langkah dengan gerbang persetujuan manusia ada di `docs/WORKFLOW.md`.
Rencana terdaftar di `docs/PLAN-INDEX.md`. Tidak ada implementasi sebelum
`mockup-approved`. Kelas perubahan (`UI`/`pipeline`/`infra`/`docs`) menentukan
apakah artefaknya mockup HTML atau kontrak.
_Tanggal: 2026-11-11. Menggantikan kebiasaan "dokumen desain tunggal"._

## DEC-0012 — Mockup memakai token CSS yang sama dengan produksi

Mockup yang tidak memakai `--paper`, `--ink`, `--accent`, `--rule`, `--serif`,
`--sans` dari `public/style.css` tidak bisa disetujui: hasil implementasinya akan
berbeda dari yang disetujui.
_Tanggal: 2026-11-11._

## DEC-0013 — Tes UI terpisah dari `daily.yml`

Harness UI berjalan di workflow sendiri. Tes browser yang rapuh tidak boleh
menggagalkan penerbitan edisi pagi.
_Tanggal: 2026-11-11. Status rencana: `implementing` (`docs/plans/001-ui-test-harness.md`)._

## DEC-0014 — Asersi UI dipisah: tanpa browser di `tests/`, browser di `tests-ui/`

Asersi yang hanya butuh membaca file atau `fetch` ke server lokal tinggal di
`tests/` dan ikut `npm test`, sehingga regresi tertangkap sebelum commit.
Hanya asersi yang benar-benar butuh DOM, JavaScript, atau service worker yang
masuk `tests-ui/` dan workflow terpisah.

Sebab: menempatkan pemeriksaan path di `tests-ui/` berarti regresi baru
tertangkap setelah push, padahal path absolut adalah bug termahal di proyek ini.
_Tanggal: 2026-11-11. Menajamkan `DEC-0013`. Rencana: `docs/plans/001-ui-test-harness.md` §Revisi v2._

## DEC-0015 — `serve.ts` melayani subpath produksi lewat `BASE_PATH`

`npm run serve` mendukung `BASE_PATH` (default `/`). Dengan
`BASE_PATH=/edisi-pagi`, server melayani `public/` di bawah prefix itu dan
mengembalikan 404 di luar prefix, sehingga bug path absolut bisa direproduksi
lokal. `PORT=0` didukung agar tes memakai port acak, dan `ROOT` (default
`public`, relatif akar repo) agar suite UI memakai server yang sama dengan
`npm run serve` alih-alih server kedua yang bisa menyimpang.

Sebab: produksi dilayani dari `/edisi-pagi/` sedangkan server lokal melayani di
akar — perbedaan itulah yang membuat bug path lolos ke produksi.
_Tanggal: 2026-11-11. `ROOT` ditambahkan pada §Revisi v3 rencana 001._

## DEC-0016 — Penyedia LLM berbayar hanya aktif lewat permintaan eksplisit

Urutan penyedia: **opencode → deterministik**. DeepSeek API langsung (kunci
`DEEPSEEK_API_KEY`) hanya dipakai bila `LLM_PROVIDER=deepseek`. Tidak pernah
sebagai cadangan otomatis.

Sebab: saldo DeepSeek ditanggung pribadi. Dengan `!forced` pada syarat lama,
setiap kegagalan OpenCode memindahkan biaya ke saldo itu tanpa ada yang
memutuskan. Karena agen/skrip lain bisa menjalankan pipeline, invarian ini
dikunci di kode dan di tes, bukan hanya dengan menghapus secret di CI.

Rollback: `LLM_PROVIDER=deepseek` + pulihkan `DEEPSEEK_API_KEY`.
_Tanggal: 2026-11-11. Rencana: `docs/plans/002-deepseek-opt-in.md`._

## DEC-0017 — OpenCode memakai satu model: DeepSeek Flash

Semua peran (`adjudicate`, `write`, `verify`) memakai
`opencode-go/deepseek-v4.1-flash` lewat OpenCode. Tidak ada model per-kapabilitas,
tidak ada model yang lebih mahal untuk satu peran.

Dikunci di dua tempat: default `resolve.ts` dan `OPENCODE_MODEL` di
`daily.yml`/`opencode-smoke.yml`. `tests/llm-model.test.ts` memastikan keduanya
sama, sehingga model tidak bisa bergeser diam-diam ke yang lebih mahal.

Sebab: biaya ditanggung pribadi dan satu model menghapus seluruh kelas
pertanyaan “peran mana memakai model apa”.
_Tanggal: 2026-11-11. Rencana: `docs/plans/002-deepseek-opt-in.md` §Revisi._

## DEC-0018 — Model OpenCode diverifikasi terhadap katalog sebelum dipakai

`resolveLlm` menjalankan `opencode models` sekali dan memastikan
`OPENCODE_MODEL` ada di katalog sebelum panggilan pertama.

- Model tidak ada di katalog → OpenCode **tidak dipakai**; penulis deterministik
  dengan log yang menyebut id model.
- Katalog tidak terbaca → **lanjut** dengan peringatan; kegagalan sementara tidak
  boleh memblokir penerbitan.

Sebab: id model yang salah gagal di setiap kartu dan hanya terlihat sebagai
`! tulis gagal` berulang. `INFRA.md` §11.5 sudah mengklaim verifikasi ini ada
sebelum kodenya ditulis.
_Tanggal: 2026-11-11. Rencana: `docs/plans/003-model-catalog-check.md`._

## DEC-0019 — Tab harian dan mingguan dihitung per irama terbit

`manifest.latest` adalah tanggal edisi **harian** terbaru. `latest_by_scope`:

- `nasional`/`lokal`: hanya edisi bertanggal `latest`; edisi lokal kemarin
  tidak tampil sebagai edisi hari ini.
- `mingguan`: edisi mingguan terbaru selama masih dalam 7 hari dari `latest`;
  lebih tua → `null`.

Sebab: satu `latest` global membuat mingguan bertanggal lebih baru
menghilangkan tab harian, dan aturan “hanya tanggal terbaru” membuat tab
mingguan hilang sepanjang pekan. Dikunci di `src/core/manifest.ts` dan
`tests/manifest.test.ts`.
_Tanggal: 2026-11-11. Rencana: `docs/plans/004-weekly-newsroom-parity.md`
(tindak lanjut publikasi edisi uji)._

## DEC-0020 — Sitemap sumber primer hanya dari sumber yang terbukti hidup

Jalur sitemap hanya diaktifkan untuk sumber yang sitemap-nya benar-benar
merespons XML (KPK dan ESDM, diuji 2026-11-11). Satu fetch sitemap per topik,
maksimum dua artikel, dan hanya URL yang domainnya ada di config.

Sitemap hanya boleh dipakai bila tanggal terbit artikel dapat diverifikasi
(meta atau teks Indonesia) dan berada di jendela topik. `lastmod` sitemap
tidak dipercaya: sitemap KPK memberi tanggal yang sama untuk artikel 2018–2021.
ESDM tidak diaktifkan karena sitemap-nya berisi profil/PDF lama, bukan berita.

Sebab: halaman listing banyak yang JS-rendered/403, sedangkan sitemap resmi
menyediakan URL yang dapat diambil tanpa crawl bebas. Tanpa gerbang tanggal,
sitemap justru memasukkan sumber primer lama ke topik baru.
_Tanggal: 2026-11-11. Rencana: `docs/plans/005-primary-sitemap.md`._

## DEC-0021 — Meta lokal boleh mengambil teks penuh, dibatasi tiga fetch

`buildMetaCards` hanya untuk scope lokal boleh mengambil teks penuh artikel
yang belum ada di cache: maksimal tiga fetch per edisi, satu per kartu, timeout
12 detik. Scope nasional tidak pernah fetch tambahan.

Sebab: `misread` lokal hampir tidak pernah muncul karena brief lokal sering
tidak melewati riset newsroom. Batas ketat menjaga build tetap cepat dan tidak
berubah menjadi crawler.
_Tanggal: 2026-11-11. Rencana: `docs/plans/006-local-meta-text.md`._

## DEC-0022 — Sinyal sosial v1 untuk gap/debate

Amplifikasi v1 = Reddit (Arctic Shift) + Google Trends RSS + total komentar
Detik (`sneak-peek`). TikTok `null` karena endpoint hanya memberi angka
kumulatif. Gap hanya arah positif (`gap_rank ≥ 5`); debate hanya bila
komentar Detik ≥15 atau skor post Reddit ≥200, dengan minimal dua kutipan.

Data disimpan per `(edition_id, topic_id)` di `social_cache`. Hasil kosong
tidak di-cache agar rate limit sementara bisa dicoba lagi. Maksimum dua kartu
meta per edisi; prioritas change > debate > gap > misread.

Sebab: lapisan “Yang Luput” dan “Yang Diperdebatkan” membutuhkan sinyal di
luar media, tetapi tidak boleh mengarang angka atau memblokir terbit saat
sumber sosial gagal.
_Tanggal: 2026-11-11. Rencana: `docs/plans/007-gap-debate-cards.md`._

## DEC-0023 — Rute arsip memakai identitas edisi; kembali adalah urusan history

Aplikasi punya satu rute eksplisit per keadaan: `#/arsip`, `#/<scope>`,
`#/<scope>/<edition_id>`, `#/<scope>/<edition_id>/<kartu>`. Hash lama
`#/<scope>/<n>` tetap diterima sebagai indeks kartu pada edisi terbaru.
Normalisasi URL memakai `history.replaceState`, dan boot tidak menambah entri
history. `history.scrollRestoration = "manual"` agar posisi gulir dikelola
aplikasi, bukan ditimpa browser setelah `popstate`.

Arsip membaca seluruh `manifest.editions`; `latest_by_scope` (`DEC-0019`) tetap
menentukan tab yang tampil dan edisi yang dibuka pertama. Daftar arsip dirender
30 tanggal per batch. Di layar detail, header feed (`#top`) disembunyikan dan
tanggal dipindah ke label bar detail.

Sebab: tanpa keadaan rute, gesture back tidak mengubah layar (hash berubah,
detail tetap tampil), boot menambah entri history sehingga back pertama
menutup PWA, dan strip tanggal lama tidak pernah terisi karena `byScope` hanya
memuat edisi terbaru. Dikunci di `tests-ui/shell.spec.ts` UI-10…UI-15 dan
`tests/ui-static.test.ts` UI-05/UI-08.
_Tanggal: 2026-11-11. Rencana: `docs/plans/008-arsip-dan-gestur-kembali.md`._

## DEC-0024 — Prompt cache diukur oleh pipeline, bukan dasbor vendor

`usage.cached_tokens` (dari `prompt_cache_hit_tokens` DeepSeek, atau
`tokens.cache.read` OpenCode) disimpan di `llm_calls.cached_tokens` dan
dicetak di baris `llm:` sebagai hit rate.

System prompt tidak boleh memuat data per-kartu: ia memotong prefix bersama dan
membuat cache meleset. Data per-kartu masuk `user`.

Sebab: hit rate 2026-11-11 baru diketahui dari dasbor (25,8%), bukan dari
pipeline; dan `write.ts` menyisipkan `answers` per-kartu ke system prompt.
_Tanggal: 2026-11-12. Rencana: `docs/plans/011-prompt-cache.md`._

Catatan biaya: cache hanya ±17% dari tagihan; keluaran ±58%. Jangan mengklaim
penghematan besar dari cache saja.

## DEC-0025 — Kartu dibangun paralel; telemetri terikat per jalur async

Kartu dibangun dengan `pool(…, CARD_CONCURRENCY, …)`, default **3**
(`CARD_CONCURRENCY=1` memulihkan perilaku berurutan). `deep` dan catatan
dipra-tentukan sebelum fan-out; urutan hasil dipertahankan sehingga ID kartu
tetap deterministik.

Konteks telemetri memakai `AsyncLocalStorage`: `telemetry.set()` hanya mengubah
konteks jalur async miliknya. Tanpa itu, dua kartu paralel saling menimpa dan
`llm_calls` mencatat panggilan kartu A atas nama kartu B.

Timeout panggilan OpenCode 180 s → 240 s (`OPENCODE_TIMEOUT_MS`), dan panggilan
yang timeout **tidak diulang** — mengulang hanya menggandakan waktu tunggu.
Batas job `daily.yml` 45 → 75 menit sebagai margin.

Sebab: OpenCode ±46,6 s/panggilan; 153 panggilan berurutan ≈ 119 menit, di luar
batas job. Konkurensi 3 terukur 3,3× pada uji lokal.
_Tanggal: 2026-11-12. Rencana: `docs/plans/012-opencode-feasible.md`._

## DEC-0026 — Ulang sekali hanya untuk kegagalan bentuk JSON

`editDraft` mengulang panggilan editor **tepat sekali** bila kegagalannya adalah
bentuk JSON (parse), dengan penanda di akhir system prompt. Timeout dan HTTP
429/5xx tidak diulang di lapisan ini.

Sebab: build 2026-11-12 kehilangan penilaian editor pada satu kartu karena JSON
cacat, padahal kegagalan bentuk bisa diperbaiki dengan satu ulangan. Sebaliknya,
mengulang timeout hanya menggandakan waktu tunggu (`DEC-0025`).
_Tanggal: 2026-11-12. Rencana: `docs/plans/013-editor-json-retry.md`._
