# 001 — Harness tes UI

```
Status: plan-draft
Kelas: infra
Dibuat: 2026-11-11
Diperbarui: 2026-11-11
Mockup: — (kelas infra; artefak = kontrak §4)
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

1. `scripts/serve.ts` — tambah dukungan `BASE_PATH` (default `/`). Saat
   `BASE_PATH=/edisi-pagi`, server melayani `public/` di bawah prefix itu dan
   mengembalikan 404 untuk path di luar prefix. Perilaku default tidak berubah.
   Ini satu-satunya perubahan kode produksi dalam rencana ini.
2. `fixtures/ui/` — direktori fixture: `manifest.json`, `data/editions/*.json`
   (salin dari `fixtures/valid/`), `config.json`. Dibaca apa adanya; tidak ada
   build, tidak ada LLM, tidak ada jaringan.
3. `scripts/prepare-ui-fixture.ts` — menyusun `fixtures/ui/public/` dari
   `public/` + fixture data. Menulis ulang setiap kali; direktori di-.gitignore.
4. `tests-ui/shell.spec.ts` — asersi di §4.
5. `package.json` — `devDependency: @playwright/test`, script
   `test:ui` dan `test:ui:install`.
6. `.github/workflows/ui.yml` — `push` ke `main` pada `public/**`, `tests-ui/**`,
   `scripts/serve.ts`; ditambah `workflow_dispatch`. Tidak dipanggil dari
   `daily.yml`.
7. `AGENTS.md` §8 — daftar manual menjadi *tambahan* untuk hal yang tidak bisa
   diotomatiskan (mis. `beforeinstallprompt` di Chrome Android), bukan
   pengganti.

Rencana ini **tidak** mengubah `SCHEMA.md`, `REQUIREMENTS.md`, atau keluaran
edisi.

## 4. Kontrak

```bash
npm run test:ui
```

Keluaran yang diharapkan: Playwright melaporkan `N passed`, exit 0, tanpa akses
jaringan keluar. Server uji berjalan di `http://localhost:8099/edisi-pagi/`.

Asersi wajib:

| # | Asersi | Kenapa |
|---|---|---|
| 1 | `index.html` merespons `text/html`, bukan `index.html` yang dipakai sebagai fallback untuk `app.js` | server jatuh ke `index.html` dengan status 200; status saja tidak cukup — assert `content-type` |
| 2 | Tidak ada atribut `href`/`src` di `index.html` yang diawali `/` | bug “Memuat…” |
| 3 | Nav bawah memuat `Edisi`; tombol `Atur` membuka `#/atur` dengan panel Pasang, Notifikasi, Tentang | `AGENTS.md` §8.3 |
| 4 | Edisi fixture ter-render: minimal satu `.card` terlihat, judul tidak kosong | pembuktian jalur data |
| 5 | `app.js` dan `style.css` dimuat dengan query `?v=` | cache 10 menit Pages |
| 6 | SW mendaftar; setelah `offline: true` + reload, shell tetap tampil dan edisi terakhir masih ter-render | SW v4 |
| 7 | Kartu `misread` menampilkan chip “Kata yang hilang dari judul” | `AGENTS.md` §8.4 |

Asersi 6 dan 7 hanya berjalan bila fixture memuat kartu bertipe itu; fixture
wajib menyertakan minimal satu `misread` dan satu `change`.

## 5. Tes

Harness ini sendiri adalah tesnya. Yang harus dibuktikan sebelum `shipped`:

1. `npm run test:ui` lulus pada `public/` yang sekarang.
2. **Uji negatif:** ubah satu `src="./app.js?v=..."` menjadi `src="/app.js"` di
   salinan fixture → asersi 2 gagal. Kembalikan; lulus lagi.
3. **Uji negatif:** matikan SW → asersi 6 gagal.
4. `npm test` dan `npm run typecheck` tetap lulus (190 uji tidak berubah).
5. Satu run `ui.yml` nyata di GitHub Actions hijau, termasuk unduh browser.

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

## 7. Riwayat

- `2026-11-11` — `plan-draft` — dibuat dari temuan bahwa tidak ada tes UI.

## 8. Pelajaran (diisi setelah `shipped`)

—
