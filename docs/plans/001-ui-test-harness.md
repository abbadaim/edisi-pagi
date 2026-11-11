# 001 — Harness tes UI

```
Status: shipped (2026-11-11)
Kelas: infra
Dibuat: 2026-11-11
Diperbarui: 2026-11-11
Mockup: — (kelas infra; artefak = kontrak §4, disetujui sebagai v2)
```

---

## 1. Masalah

Tidak ada tes UI otomatis di repo ini. Bukti:

- `package.json` tidak memuat `playwright`, `puppeteer`, atau `jsdom`.
- `npm test` = `node --test tests/*.test.ts` — 190 uji, semuanya unit, tanpa jaringan.
- Seluruh pemeriksaan UI ada di `AGENTS.md` §8 sebagai daftar manual: cek nav,
  buka `#/atur`, chip `misread`, uji offline, hapus cache SW.

Akibatnya, kelas bug yang paling mahal di proyek ini hanya tertangkap bila
manusia kebetulan membukanya:

| Bug historis | Kenapa lolos | Bisa ditangkap tes? |
|---|---|---|
| Path absolut → app berhenti di “Memuat…” | hanya muncul di subpath `/edisi-pagi/` | ya |
| `app.js` basi karena cache 10 menit | tidak terlihat lokal | ya (assert `?v=<sha1>`) |
| Offline kosong setelah SW v4 | butuh server dimatikan | ya |
| Push membuka halaman salah | payload `/` vs `./` | ya (unit, bukan browser) |

Tanpa harness, langkah “tes termasuk UI” di `docs/WORKFLOW.md` §5 tidak punya alat,
dan gerbang UI hanya bisa dipenuhi dengan mata manusia.

## 2. Keputusan yang akan diambil

Menambah satu harness Playwright yang berjalan atas **edisi fixture** di server
lokal yang meniru subpath produksi `/edisi-pagi/`, dijalankan lewat
`npm run test:ui`, dan dipasang di **workflow terpisah** — bukan di `daily.yml`
(`DEC-0013`). Tidak ada perubahan pada `public/` selain yang dibutuhkan agar
server uji bisa melayani subpath.

## 3. Rencana

Dipecah menjadi dua commit setelah revisi v2 (§Revisi). Commit 1 tidak menambah
dependensi apa pun.
**Commit 1 — lapisan tanpa browser (`tests/`, ikut `npm test`):**

1. `scripts/serve.ts` — dukungan `BASE_PATH` (default `/`). Saat
   `BASE_PATH=/edisi-pagi`, server melayani `public/` di bawah prefix itu dan
   mengembalikan 404 di luar prefix. Satu-satunya perubahan kode produksi.
   `PORT=0` didukung agar tes tidak berebut port.
2. `tests/ui-static.test.ts` — UI-01, UI-02, SRV-01, SRV-02, PUSH-01 (§4).
3. `AGENTS.md` §8 — daftar manual menjadi *tambahan* untuk hal yang tidak bisa
   diotomatiskan (mis. `beforeinstallprompt` di Chrome Android), bukan
   pengganti.

**Commit 2 — lapisan browser (`tests-ui/`, workflow sendiri):**

4. `fixtures/ui/` — `manifest.json`, `data/editions/*.json` (salin dari
   `fixtures/valid/`), `config.json`. Dibaca apa adanya; tanpa build, tanpa LLM.
5. `scripts/prepare-ui-fixture.ts` — menyusun `fixtures/ui/public/` dari
   `public/` + fixture data; di-.gitignore.
6. `tests-ui/shell.spec.ts` — UI-03, UI-04, UI-06, UI-07 (§4).
7. `package.json` — `devDependency: @playwright/test`, script `test:ui`,
   `test:ui:install`.
8. `.github/workflows/ui.yml` — `push` ke `main` pada `public/**`,
   `tests-ui/**`, `scripts/serve.ts`, ditambah `workflow_dispatch`. Tidak
   dipanggil dari `daily.yml`.

Commit 2 baru dimulai setelah commit 1 hijau dan setelah suite lokal hijau dua
kali berturut-turut.

Rencana ini **tidak** mengubah `SCHEMA.md`, `REQUIREMENTS.md`, atau keluaran
edisi.

## 4. Kontrak

```
Lapisan murah (commit 1):  npm test
Lapisan browser (commit 2): npm run test:ui
```

Keduanya tanpa jaringan keluar. Server lapisan browser berjalan di
`http://127.0.0.1:<port>/edisi-pagi/` dengan port acak (`PORT=0`).

Asersi wajib. Kolom **Lapisan** menentukan di mana asersi tinggal (`DEC-0014`):

| # | Asersi | Lapisan | Kenapa |
|---|---|---|---|
| UI-01 | Tidak ada atribut `href`/`src` di `index.html` yang diawali `/` | `tests/` | bug “Memuat…”; hanya muncul di subpath produksi |
| UI-02 | `app.js` dan `style.css` dimuat dengan `?v=<sha1>` | `tests/` | cache 10 menit Pages |
| SRV-01 | Dengan `BASE_PATH=/edisi-pagi`: `/edisi-pagi/` → `text/html` berisi `id="feed"`, `style.css` → `text/css`, `app.js` → javascript; `/style.css` di luar prefix → **404** | `tests/` | tanpa 404 itu, suite bisa lulus sambil menguji akar domain |
| SRV-02 | Tanpa `BASE_PATH`, server tetap melayani di akar | `tests/` | jaga perilaku `npm run serve` |
| PUSH-01 | Payload `push.ts --dry` memakai `url: "./"`, bukan `/` | `tests/` | push membuka halaman salah |
| UI-03 | Nav bawah memuat `Edisi`; `Atur` membuka `#/atur` dengan panel Pasang, Notifikasi, Tentang | `tests-ui/` | `AGENTS.md` §8.3 |
| UI-04 | Edisi fixture ter-render: minimal satu `.card` terlihat, judul tidak kosong | `tests-ui/` | pembuktian jalur data |
| UI-06 | SW mendaftar; setelah `offline: true` + reload, shell tetap tampil dan edisi terakhir ter-render | `tests-ui/` | SW v4 |
| UI-07 | Kartu `misread` menampilkan chip “Kata yang hilang dari judul” | `tests-ui/` | `AGENTS.md` §8.4 |

UI-06 dan UI-07 hanya berjalan bila fixture memuat kartu bertipe itu; fixture
wajib menyertakan minimal satu `misread` dan satu `change`.

## 5. Tes

Harness ini sendiri adalah tesnya.

**Commit 1 — sudah dijalankan (2026-11-11):**

1. `npm test` — 195 lulus, 0 gagal (190 uji lama + 5 baru). `npm run typecheck` bersih.
2. **Uji negatif UI-01/02:** `src="app.js?v=…"` diubah menjadi `src="/app.js?v=…"`
   → UI-01 dan UI-02 gagal. Dipulihkan; hijau lagi.
3. **Uji negatif PUSH-01:** `url: "./"` diubah menjadi `url: "/"` di
   `scripts/push.ts` → PUSH-01 gagal. Dipulihkan; hijau lagi.
4. **Uji negatif SRV-01** (implisit): dengan `BASE_PATH` kosong, `SRV-02`
   membuktikan aset terlayani di akar — jadi asersi 404 di SRV-01 tidak mungkin
   lulus tanpa penolakan prefix yang benar.

**Commit 2 — sudah dijalankan (2026-11-11):**

5. `npm run test:ui` — 4 lulus (4,0 detik) atas `fixtures/ui/public/` di
   `/edisi-pagi/`: UI-03, UI-04, UI-06, UI-07.
6. **Uji negatif UI-06:** registrasi di `app.js` diubah menjadi `sw-tidak-ada.js`
   → UI-06 gagal (`page.waitForFunction` timeout 30 detik), tiga uji lain lulus.
   Dipulihkan; hijau lagi.
7. Suite lokal dijalankan dua kali berturut-turut sebelum `ui.yml` dipasang.
8. Satu run `ui.yml` di GitHub Actions — **hijau, 45 detik** (run `42959300632`),
   termasuk unduh browser dan cache `ms-playwright`.

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| Browser test rapuh memblokir deploy | workflow terpisah (`DEC-0013`); `daily.yml` tidak menyentuhnya |
| Unduh browser memperlambat CI | cache `~/.cache/ms-playwright`, pin versi `@playwright/test` |
| SW membuat tes tidak deterministik | konteks browser baru per spec; hapus cache eksplisit di `beforeEach` |
| Fixture memakai tanggal edisi terbit | fixture hanya **dibaca**, tidak di-build; `fixtures/valid/` sudah ada dan tidak diubah |
| `serve.ts` berubah perilaku | `BASE_PATH` default `/`; tambah satu unit test untuk perilaku default |

Rollback: hapus `ui.yml` dan `tests-ui/`. `serve.ts` dengan `BASE_PATH` default
tetap kompatibel.

## 7. Revisi

### v2 — 2026-11-11 — asersi dipisah per lapisan

**Sebab.** Saat memeriksa `public/index.html` sebelum implementasi, tiga dari
tujuh asersi ternyata tidak butuh browser sama sekali: UI-01 dan UI-02 cukup
membaca file, SRV-01 cukup `fetch` ke server lokal. Menempatkannya di
`tests-ui/` berarti regresi path hanya tertangkap di `ui.yml` — yaitu **setelah
push**, di workflow terpisah. Itu terlambat untuk bug yang paling mahal di
proyek ini.

**Perubahan.** `DEC-0014`: asersi tanpa browser pindah ke `tests/` sehingga ikut
`npm test` di setiap commit. Asersi browser tetap di `tests-ui/`. Satu asersi
baru (PUSH-01) ditambahkan karena `scripts/push.ts` mengunci `url: "./"` di dua
tempat tanpa tes apa pun, dan itu bug yang sudah pernah terjadi.

**Yang berubah:** §3 (dipecah dua commit), §4 (kolom Lapisan, penomoran
UI-/SRV-/PUSH-), §5 (bukti commit 1). **Yang tidak berubah:** §1 masalah, §2
keputusan, ambisi “tes UI otomatis”.

**Catatan jujur.** Nama rencana “harness tes UI” kini sedikit menyesatkan untuk
commit 1: commit 1 menguji *penyajian* dan *kontrak aset*, bukan render. Render
baru diuji di commit 2.

### v3 — 2026-11-11 — `ROOT` pada `serve.ts`

**Sebab.** Suite browser perlu melayani `fixtures/ui/public/`, sedangkan
`serve.ts` mengunci `public/`. Membuat server kedua khusus tes berarti suite
menguji server yang berbeda dari `npm run serve` — persis kelas penyimpangan
yang ingin dicegah.

**Perubahan.** `ROOT` (relatif ke akar repo, default `public`) ditambahkan ke
`serve.ts`. Satu server untuk pengembangan dan tes. Perilaku default tidak
berubah. Tercatat di `DEC-0015`.

**Konsekuensi.** `ROOT` adalah pintu yang bisa menyajikan direktori mana pun di
dalam repo, termasuk `data/` dan `.env.local` tidak (bukan di bawah `public/`
maupun fixture). Risikonya terbatas pada mesin lokal dan CI, bukan produksi
(GitHub Pages tidak menjalankan `serve.ts`).

---

## Riwayat

- `2026-11-11` — `plan-draft` — dibuat dari temuan bahwa tidak ada tes UI.
- `2026-11-11` — `plan-approved` — disetujui manusia.
- `2026-11-11` — `mockup-approved` — kontrak §4 v2 disetujui (kelas infra: tidak
  ada file mockup). Revisi: asersi dipisah per lapisan (§7 v2).
- `2026-11-11` — `implementing` — commit 1: `scripts/serve.ts` `BASE_PATH` +
  `tests/ui-static.test.ts` (UI-01, UI-02, SRV-01, SRV-02, PUSH-01). 195 uji
  lulus, typecheck bersih, 3 uji negatif terbukti gagal saat perilakunya dirusak.
- `2026-11-11` — **belum `shipped`** — commit 2 (Playwright) belum dikerjakan.
- `2026-11-11` — `tested` — commit 2: `playwright.config.ts`, `tests-ui/shell.spec.ts`
  (UI-03, UI-04, UI-06, UI-07), `fixtures/ui/`, `scripts/prepare-ui-fixture.ts`,
  `.github/workflows/ui.yml`, `ROOT` di `serve.ts` (§Revisi v3).
  Hasil: 4 lulus (4,0 detik). Uji negatif UI-06 dijalankan: registrasi SW
  dirusak → UI-06 gagal (timeout 30 detik).
- `2026-11-11` — `shipped` — `ui.yml` hijau di GitHub (run `42959300632`,
  45 detik, termasuk unduh browser).

## 8. Pelajaran

Tiga asersi dari tujuh tidak butuh browser, dan tiga uji negatif membuktikan
sisanya benar-benar menguji sesuatu. Yang paling berharga bukan Playwright-nya,
melainkan asersi 404 di luar prefix: tanpa itu suite bisa lulus sambil menguji
akar domain, dan bug path absolut — alasan harness ini dibuat — tidak pernah
tereproduksi.

Rencana ini juga membuktikan alurnya sendiri: `plan-draft` yang dibiarkan
sebentar sebelum implementasi mengubah bentuk rencana secara material
(§Revisi v2 dan v3).
