# 008 — Arsip edisi dan gestur kembali

```
Status: tested
Kelas: UI
Dibuat: 2026-11-11
Diperbarui: 2026-11-11
Mockup: docs/mockups/arsip-dan-gestur-kembali.html (v1, disetujui 2026-11-11)
```

---

## 1. Masalah

Dua keluhan, satu akar: **router aplikasi tidak punya keadaan rute** — hanya
`S.view`, `S.scope`, dan `S.entryIndex` yang saling menimpa. Arsip yang sudah
dijanjikan README tidak pernah dirender, dan gesture back tidak mengubah apa pun.

### 1.1 Bukti — gesture back

Probe Playwright atas `fixtures/ui/public` lewat `scripts/serve.ts`
(`BASE_PATH=/edisi-pagi`), 2026-11-11:

| Kejadian | Hasil terukur |
|---|---|
| boot | hash `#/nasional`, `history.length` = 3 |
| klik kartu pertama | hash `#/nasional/0`, `history.length` = 4, `#detail` tampil |
| header saat detail | `#top` **tetap tampil setinggi 125 px**; judul besar, `8 kartu · ±5 menit · Nasional`, dan `covline` tetap di atas artikel |
| label bar detail | `Nasional · kartu 1 dari 8` — tanpa tanggal edisi |
| satu gesture back | hash `#/nasional`, **`#detail` masih tampil**, `#feed` masih tersembunyi |
| gesture back kedua | hash `""`, detail masih tampil — di PWA terpasang gesture ini menutup aplikasi |
| cold load `#/nasional/1` | berakhir di `#/nasional` dengan feed, bukan kartu 1 |

Sebab di kode:

- `openCard()` (`public/app.js:439`) menampilkan detail tanpa pernah menulis
  `S.view = "detail"`.
- Handler `hashchange` (`public/app.js:645-647`) hanya memanggil `openScope`
  bila `S.view === "atur"` atau scope berbeda. Karena `S.view` masih `"feed"`
  dan scope sama, back gesture tidak melakukan apa pun.
- `showFeed()` (`public/app.js:197`) menulis `location.hash` sebagai **push**,
  jadi boot menambah satu entri history. Back pertama dari feed meninggalkan
  aplikasi.
- Tidak ada pemulihan posisi baca: `showFeed()` memanggil `window.scrollTo(0,0)`
  (`public/app.js:198`) dan `openScope` mengambil ulang edisi dari jaringan.

### 1.2 Bukti — arsip tidak ada

| Kejadian | Hasil terukur |
|---|---|
| manifest berisi 8 edisi | `#dates .date` = **0** tombol |
| `#dates` punya atribut `hidden` | `display: flex`, tinggi 2 px — garis kosong tetap memakan ruang |

Sebab:

- `boot()` (`public/app.js:110-119`) membuang setiap edisi yang bukan
  `latest_by_scope` milik scope-nya, sehingga `S.byScope` berisi **satu** edisi
  per scope. `renderDates()` (`public/app.js:170`) langsung berhenti karena
  `entries.length < 2`.
- `.dates{display:flex}` (`public/style.css:153`) mengalahkan `[hidden]` dari UA
  stylesheet, jadi strip kosong tetap dirender.
- `README.md:112` sudah menjanjikan “baris tanggal di bawah judul untuk
  berpindah edisi lama (2 tahun retensi)”. Kode tidak melakukannya.

### 1.3 Yang sudah benar dan tidak perlu diubah

- `manifest.json` sudah memuat **semua** edisi terbit (`scripts/publish.ts:82-91`),
  lengkap dengan `edition_id`, `scope`, `published_at`, `card_count`,
  `reading_time_min`, `path`. Tidak ada perubahan pipeline.
- `latest_by_scope` (`DEC-0019`) tetap dipakai untuk menentukan tab mana yang
  tampil dan edisi mana yang dibuka pertama.
- Push memakai URL `./` (`PUSH-01`); skema hash baru tidak menyentuhnya.

---

## 2. Keputusan yang akan diambil

Aplikasi mendapat **satu rute eksplisit per keadaan** dan **mengikuti history
browser**, bukan menebak dari state yang saling menimpa:

```
#/arsip
#/<scope>
#/<scope>/<edition_id>
#/<scope>/<edition_id>/<card>
```

Arsip menjadi layar sendiri yang membaca seluruh `manifest.editions`. Gestur
back menjadi navigasi history biasa: detail → feed tanpa fetch ulang dan tanpa
kehilangan posisi gulir. Yang **tidak** berubah: aturan tab (`latest_by_scope`),
gerbang terbit, isi `edition.json`, dan `publish.ts`.

Rencana ini mengusulkan `DEC-0023` — “Rute arsip memakai identitas edisi;
kembali adalah urusan history” — ditambahkan saat implementasi.

---

## 3. Rencana

1. **Router** (`public/app.js`): ganti `S.view`/`S.entryIndex` menjadi satu objek
   `S.route = { name, scope, editionId, card }` dengan `name` ∈
   `feed | detail | arsip | atur`. Satu fungsi `parseRoute(hash)` dan
   `renderRoute(route)`; tidak ada penulisan hash di dalam fungsi render.
2. **Data** (`public/app.js`): simpan `S.all` (seluruh `manifest.editions`,
   urut terbaru) **dan** `S.byScope` (hasil filter `latest_by_scope`, perilaku
   tab tidak berubah). Tambah `S.loaded: Map<path, edition>` agar kembali dari
   detail tidak memuat ulang.
3. **URL**: `#/<scope>/<edition_id>` untuk edisi, `.../<card>` untuk kartu.
   Hash lama `#/<scope>/<n>` tetap diterima sebagai indeks ke `S.byScope` agar
   tautan/push lama tidak pecah. Normalisasi memakai `history.replaceState`,
   bukan `location.hash =`, supaya tidak menambah entri.
4. **Kembali**: `openCard()` menulis `S.route.name = "detail"` sebelum hash.
   Rute detail → feed memakai edisi di `S.loaded` dan memulihkan
   `S.feedScroll`. Tombol `#back` memakai `history.back()` bila entri sebelumnya
   rute feed; jika tidak (masuk dari tautan langsung), `showFeed()` langsung.
5. **Konteks layar** (`public/app.js`): saat detail terbuka, `#top` (eyebrow,
   tanggal besar, `subline`, `covline`) **disembunyikan**; hanya bar detail yang
   tersisa — panah kembali + label `Nasional · 11 Nov · kartu 3 dari 8`. Tanggal
   tetap disebut di label itu supaya posisi edisi tidak hilang bersama header.
   `showFeed()` mengembalikan `#top`; `openAtur()` sudah melakukannya.
   Alasan: header tanggal yang sama di atas artikel membuat layar detail
   terbaca seperti feed dan menenggelamkan penanda posisi. Efek samping yang
   diterima: chip Pasang (anak `#top`) ikut tersembunyi dan kembali di feed.
6. **Layar arsip** (`public/app.js` + `public/index.html`): `<section id="arsip">`
   dengan kelas `.page` seperti `#atur`. Satu blok per tanggal (`.arsipDay`),
   berisi tanggal panjang dan 1–3 baris scope (`.arsipItem`): label scope,
   `card_count` kartu, `reading_time_min` menit. Edisi terbaru per scope diberi
   penanda `Terbaru`; edisi yang sedang dibuka diberi `aria-current`. Klik →
   `openScope(scope, editionId)`.
   Karena retensi 2 tahun (±700 tanggal, ±1.400 baris), render awal dibatasi
   30 tanggal dengan tombol **Muat 30 tanggal lagi**; label bulan (`.arsipMonth`)
   memisahkan kelompok. Tanpa batas ini `/arsip` membangun ribuan tombol
   sebelum layar pertama tampil.
7. **Masuk ke arsip**: item nav bawah kelima `Arsip` (§4 keputusan 1), muncul
   hanya bila `S.all` memuat edisi lebih tua dari `latest_by_scope` — tombol
   tanpa isi dilarang (pelajaran `SESSION-LEARNINGS.md` §8). `#dates` dihapus
   dari `index.html` dan `style.css`.
8. **CSS** (`public/style.css`): kelas `.arsipList`, `.arsipRow`, `.arsipDate`,
   `.arsipMeta`, `.arsipChip` memakai token lama; tambah `[hidden]{display:none}`
   yang mengalahkan aturan `display:flex`.
9. **Offline** (`public/sw.js`): tidak berubah. `manifest.json` tetap
   network-first; baris arsip tampil dari cache, edisi yang belum pernah dibuka
   memberi pesan “Belum tersimpan offline” alih-alih “Gagal memuat edisi”.
10. **Dokumen**: `README.md:112` diperbarui; `SCHEMA.md` tidak berubah karena
    `edition.json` tidak berubah.

---

## 4. Mockup / kontrak

Mockup: [`docs/mockups/arsip-dan-gestur-kembali.html`](../mockups/arsip-dan-gestur-kembali.html),
token sama dengan `public/style.css` (`--paper`, `--ink`, `--muted`, `--faint`,
`--rule`, `--accent`, `--serif`, `--sans`), bingkai ponsel 380 px seperti
`mockup/index.html`.

Layar yang dicakup:

| # | Layar | Isi |
|---|---|---|
| A | Feed | nav bawah 5 item: Edisi / Sleman / Mingguan / **Arsip** / Atur |
| B | Arsip | daftar per tanggal, label bulan, penanda `Terbaru`, tombol “Muat 30 tanggal lagi” |
| C | Arsip — keadaan tepi | offline dan edisi belum tersimpan; tautan baris tidak aktif |
| D | Feed tanpa arsip | item Arsip tidak dirender bila belum ada edisi lama |
| E | Detail | header tanggal disembunyikan; bar berisi panah kembali + `Nasional · 11 Nov · kartu 3 dari 8` |

**Keputusan pemilik, 2026-11-11:**

1. Pintu masuk arsip: **item nav bawah kelima** (Edisi / Sleman / Mingguan /
   Arsip / Atur).
2. Bentuk daftar: **satu blok per tanggal**, baris scope di dalamnya; tanpa
   baris filter.
3. `#dates`: **dihapus**; arsip menggantikannya.
4. Mockup dibuat lebih dulu, kode menunggu `mockup-approved`.
5. Di layar detail, **header tanggal besar + `subline` + `covline`
   disembunyikan**; tanggal dipindah ke label bar detail supaya posisi edisi
   tetap terbaca tanpa header feed.

---

## 5. Tes

| Tes | File | Perilaku yang dikunci |
|---|---|---|
| UI-10 | `tests-ui/shell.spec.ts` | `page.goBack()` dari detail mengembalikan `#feed`, menyembunyikan `#detail`, dan mempertahankan `scrollY` (gestur Android/iOS memakai jalur history yang sama) |
| UI-11 | `tests-ui/shell.spec.ts` | cold load `#/nasional/<edition_id>/2` membuka kartu 2, bukan feed |
| UI-12 | `tests-ui/shell.spec.ts` | laman arsip menampilkan edisi terbaru lebih dulu, maksimum 30 tanggal, tombol “Muat 30 tanggal lagi” menambah daftar; klik edisi lama membuka edisi itu dan hash memuat `edition_id` |
| UI-13 | `tests-ui/shell.spec.ts` | satu back dari boot tetap di feed, tidak meninggalkan aplikasi (`history.length` tidak bertambah saat boot) |
| UI-14 | `tests-ui/shell.spec.ts` | offline: baris arsip tetap tampil; edisi yang belum di-cache memberi pesan “Belum tersimpan offline” |
| UI-15 | `tests-ui/shell.spec.ts` | detail menyembunyikan `#top` (`#dateline` tidak tampil) dan label bar memuat tanggal edisi; `#top` kembali setelah back |
| UI-05 | `tests/ui-static.test.ts` | `public/index.html` memuat `#arsip` dan tidak ada path absolut (melanjutkan UI-01) |
| UI-08 | `tests/ui-static.test.ts` | `style.css` punya penjaga `[hidden]` yang mengalahkan `display:flex` — bug strip kosong 2 px tidak kembali |

Fixture perlu satu edisi lama sintetis (`2026-10-31`, nasional + lokal) di
`fixtures/ui/`; tanggal ini tidak ada di `data/editions/`, jadi tes tidak
memakai edisi terbit. `scripts/prepare-ui-fixture.ts` tidak perlu diubah.

Bukti tes gagal sebelum perbaikan: probe §1.1 dan §1.2 dijalankan pada kode
sekarang dan menghasilkan angka di atas. UI-10 s/d UI-13 harus gagal pada
`app.js` versi ini.

Bukti yang sama juga berlaku untuk gestur iOS/Android: keduanya mengirim
navigasi history, bukan event khusus aplikasi.

---

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| Skema hash baru memecah tautan lama | `#/<scope>/<n>` tetap diterima; push memakai `./` sehingga selalu berakhir di edisi terbaru |
| Kembali tanpa fetch membuat edisi basi | `S.loaded` hanya dipakai untuk satu sesi; muat ulang halaman selalu mengambil `manifest.json` (`cache: "no-cache"`) dan edisi (`no-cache`) |
| Arsip mengunduh semua edisi | Arsip hanya membaca manifest; `edition.json` diambil saat dibuka |
| `latest_by_scope` ikut berubah tanpa sengaja | `S.byScope` tetap hasil filter yang sama; UI-03 yang ada mengunci nav |
| Service worker lama menyajikan `app.js` lama | `publish.ts` menulis `?v=<sha1>`; uji manual: hapus cache + unregister SW dulu |
| Rollback | `git revert` pada commit `app.js`/`index.html`/`style.css` lalu workflow `deploy-site` — tidak ada build edisi, tanggal terbit tidak disentuh |

---

## 7. Riwayat

- `2026-11-11` — `plan-draft` — dibuat; bukti probe gesture dan arsip dicatat
  di §1.
- `2026-11-11` — `plan-draft` — tiga keputusan produk dipilih pemilik (§4):
  nav kelima, satu blok per tanggal, `#dates` dihapus. Ditambahkan batas render
  30 tanggal + “Muat 30 tanggal lagi”, karena retensi 2 tahun berarti ±700
  tanggal.
- `2026-11-11` — `plan-draft` — mockup **v1** ditulis
  (`docs/mockups/arsip-dan-gestur-kembali.html`), lima layar A–E. Menunggu
  `mockup-approved` dari pemilik; belum ada kode produksi yang disentuh.
- `2026-11-11` — `plan-draft` — revisi mockup v1 (belum disetujui): header
  tanggal besar, `subline`, dan `covline` disembunyikan di layar detail; tanggal
  pindah ke label bar detail. Tambah langkah §3.5, tes UI-15.
- `2026-11-11` — `plan-approved` / `mockup-approved` — pemilik menyetujui
  rencana dan mockup v1 dalam sesi; implementasi mulai.
- `2026-11-11` — `implementing` — `public/app.js`, `public/index.html`,
  `public/style.css`, fixture UI, dan tes.
- `2026-11-11` — `tested` — `npm test` 244 lulus, `npm run typecheck` bersih,
  `npm run test:ui` 10 lulus (dijalankan dua kali). Belum di-deploy.

---

## 8. Pelajaran (diisi setelah `shipped`)

—
