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
