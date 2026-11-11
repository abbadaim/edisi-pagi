# Session Learnings — 10–11 November 2026

Catatan ini merangkum apa yang dibangun, apa yang salah, dan apa yang terbukti
bekerja. Untuk aturan operasional, lihat `AGENTS.md`; untuk desain, lihat
`NEWSROOM.md` dan `NEWSROOM-IMPLEMENTATION.md`.

---

## 1. Hasil

- POC lima peran (planner → riset → writer → editor → desk) dibangun dan
  dibandingkan dengan edisi lama.
- Pipeline newsroom menjadi **default produksi**, dengan rollback
  `--no-newsroom`.
- Edisi `2026-11-11` terbit: **8 kartu nasional**, 20 menit baca; lokal sempat
  tidak terbit, lalu run berikutnya menghasilkan 5 kartu lokal.
- **190 tes** lulus; typecheck bersih.
- UI shell: nav bawah, halaman Atur (pasang/notifikasi/tentang), arsip tanggal,
  dan offline shell.
- Kartu meta `change`/`misread` deterministik, memakai bahan newsroom.
- Telemetri per panggilan (`llm_calls`), cache teks artikel
  (`article_text`), ledger catatan (`editor_notes`), dan sumber primer (P4a)
  sudah ada.

Angka POC yang paling penting:

| Metrik | Edisi lama | POC |
|---|---:|---:|
| Rata-rata karakter body | 1.067 | 4.500–7.400 |
| Fakta unik | 16 | 50–100 |
| Sumber/kartu | 3,0 | 4–5 |
| Sitasi per paragraf | tidak ada | 1/paragraf |
| Bahan tersedia | 1.700 char | 8.800 char |

---

## 2. Keputusan yang dikunci

1. **Material dulu, peran kemudian.** Riset teks penuh memberi lompatan
   kualitas terbesar; menambah peran tanpa bahan tidak menolong.
2. **Sitasi per paragraf.** Hanya bahan yang disitasi yang masuk `sources` dan
   `truth`; bahan primer yang tidak dikutip tidak boleh menaikkan status.
3. **Gerbang sempit.** Hanya fakta salah, typo, dan teks terpotong yang
   memblokir. Newsworthiness milik planner.
4. **Konflik sumber terbit dengan disclaimer.** Fakta yang terbukti salah tetap
   digugurkan.
5. **Perbaiki fakta sebelum gugur.** Writer mendapat satu putaran repair;
   mengarang saat repair → terbit dengan catatan, bukan gugur.
6. **Panjang advisory.** 300–600 kata harian, 1.200–2.500 kata mendalam; tidak
   ada retry paksa.
7. **Catatan internal utuh, publik ringkas.** `editor_notes` menyimpan teks
   penuh; `unresolved` 120 dan `disclaimer` 320 hanya untuk tampilan.
8. **Tindak lanjut berkuota.** Maks 2 nasional / 1 lokal; minimal 3/1 berita
   baru; nol berita baru = nol follow-up.
9. **Dedupe kartu akhir.** Adjudikasi bisa memecah satu peristiwa; dedupe
   sebelum `buildEdition`.
10. **Manifest sadar scope.** `latest_by_scope` mencegah edisi lokal kemarin
    tampil sebagai edisi hari ini.

---

## 3. Bug yang ditemukan dan diperbaiki

| Bug | Perbaikan |
|---|---|
| Judul terpotong di tengah kata | repair di batas kata + buang kata sambung |
| Sitasi menunjuk paragraf yang sudah tidak ada | normalisasi membuang indeks di luar body |
| Id bahan (`s1`) bocor ke prosa | writer dilarang menulis id; normalisasi membuang |
| Pertanyaan planner tak bisa dijawab bahan | writer menyatakan belum tersedia; scope narrowing |
| Editor menaikkan koherensi/kedalaman jadi blocking | batas severity ditegakkan kode |
| Editor “menemukan” masalah yang tidak ada di sumber | kutipan diuji ke bahan; gagal → advisory |
| Revisi berjalan tanpa temuan blocking | verdict otomatis `approve` |
| Fakta salah langsung menggugurkan | repair fakta dulu |
| Catatan editor terpotong 120/300 | batas internal dinaikkan; publik tetap skema |
| Disclaimer berhenti di tengah kalimat | template utuh; detail ke `unresolved` |
| Tab lokal menampilkan edisi kemarin | `latest_by_scope` + filter app |
| Log lokal memakai hitungan pre-dedupe | log `topik, kartu unik` |
| CI mengira OpenCode tersedia | `OPENCODE_BIN` kosong; fallback DeepSeek by design |
| Installer CI memasang v1, adapter butuh v2 | ganti ke `https://opencode.ai/v2/install` |
| Dua run/agen push bersamaan | rebase; periksa `origin/main` sebelum push |

---

## 4. OpenCode di CI — pelajaran

> Catatan sejarah: bagian ini mencatat perilaku **sebelum** `DEC-0016/0017/0018`.
> Sejak itu DeepSeek API langsung bukan cadangan otomatis; kegagalan OpenCode
> berakhir di penulis deterministik.

`https://opencode.ai/install` mengarah ke **v1.19.5**. CLI v1 memakai
`opencode import`, bukan `opencode auth import`. Karena itu CI gagal di langkah
auth dan pipeline jatuh ke DeepSeek.

Yang benar:

```bash
curl -fsSL https://opencode.ai/v2/install | bash
opencode --version                  # 2.2.7
opencode --standalone auth import
opencode --standalone auth list
opencode run --model opencode-go/deepseek-v4.1-flash --format json --auto --archived '...'
```

Kredensial:

```bash
# lokal, sekali
opencode auth export > auth.json
gh secret set OPENCODE_AUTH_JSON --repo <owner>/<repo> < auth.json
rm auth.json
```

Smoke test CI berhasil: v2.2.7, auth import, model call mengembalikan
`{"ok":true}`.

Jika install/auth gagal, workflow menulis `OPENCODE_BIN=/nonexistent` supaya
probe gagal cepat dan DeepSeek dipakai.

---

## 5. Sumber primer — pelajaran

P4a berhasil secara arsitektur, tetapi hasilnya nol pada run pertama karena
halaman resmi tidak ramah mesin:

| Sumber | Temuan |
|---|---|
| OJK | 200 tetapi halaman kosong/terblokir |
| DPR | HTML ada, daftar berita JS-rendered |
| BPS | JS-rendered; butuh `BPS_API_KEY` |
| Polri/KPK | fetch gagal |
| BPS DIY | JS-rendered |

Yang berguna: tautan resmi yang sudah ada di klaster/database, dan BPS API
dengan kunci. Langkah berikutnya (P4b): sitemap, PDF, atau API resmi.

---

## 6. Angka run produksi 11 November

- 8 kartu nasional valid; 20 menit baca.
- 47 panggilan LLM; 215.712 token masuk / 68.967 keluar; max 22,4 detik.
- Build 7m28s; workflow 8m11s; timeout 45 menit.
- 4 disclaimer, 1 unresolved.
- Tidak ada sumber tier-1 pada run itu.
- Local sempat tidak terbit pada run 01:00 UTC; run berikutnya menghasilkan
  5 kartu lokal dan `latest_by_scope` sudah terlihat di manifest live.

Biaya tercatat `$0.0000` karena pricing provider belum dikonfigurasi; token dan
latensi tetap tersimpan.

---

## 7. Yang belum selesai

1. **P4b**: sitemap/PDF/API resmi untuk sumber primer.
2. **Desk rework**: masih shadow/advisory.
3. **Concurrency build**: kartu masih diproses berurutan.
4. **Hoax/lokal parity**: hoax sudah punya penulis; sebagian lokal masih
   fallback.
5. **Pricing LLM**: isi tabel harga agar `cost_usd` bermakna.
6. **Evaluasi kualitas**: golden set dan penilaian manusia, bukan hanya metrik
   panjang.
7. **`gap` dan `debate`**: belum ada; butuh amplifikasi (Reddit/komentar
   Detik/Trends/TikTok). Jangan memalsukan dari jumlah artikel.
8. **Paritas mingguan**: `weekly.ts` masih memakai penulis lama, bukan newsroom.
9. **Meta lokal**: `misread` lokal jarang muncul karena teks penuh hanya
   tersedia untuk artikel yang di-fetch newsroom.
10. **Pengiriman push**: UI + sender ada; belum diuji di perangkat nyata.

---

## 8. UI shell, PWA, dan arsip

Yang dibangun:

- Nav bawah nyata: **Edisi / Sleman / Mingguan / Atur**. Scope hanya muncul
  bila edisinya ada untuk tanggal terbaru.
- Halaman **Atur**: pasang aplikasi, notifikasi, dan info arsip.
- Chip tanggal untuk membuka edisi lama (`openScope(scope, index)`).
- Service worker v4: fallback navigasi, `config.json`, fallback aset berversi.
- Install: `beforeinstallprompt` + instruksi iOS/Safari/Chrome Android.

Pelajaran mahal:

| Masalah | Sebab / perbaikan |
|---|---|
| Bar bawah hanya “Edisi” | Tujuan mockup (Cari/Simpan/Atur) tidak pernah dibangun; jangan pasang tombol mati |
| App berhenti di “Memuat…” | Path absolut (`/style.css`) rusak di project page; semua path harus relatif |
| Deploy terlihat tidak berubah | Pages cache `app.js` 10 menit; publish menulis `?v=<sha1>` |
| Offline memuat HTML tanpa aset | SW harus fallback ke `app.js`/`style.css` tanpa query |
| Tombol pasang tidak muncul | Electron/in-app browser tidak punya `beforeinstallprompt`; fallback instruksi wajib |
| Push membuka halaman salah | Payload `url: "/"` membuka akar domain; pakai `./` dan resolve ke scope |
| Tab Mingguan hilang | `latest_by_scope` hanya menampilkan edisi bertanggal terbaru |

## 9. Kartu meta (`change` & `misread`)

Aturan yang dikunci:

- `change` hanya memakai **status** klaim vs edisi sebelumnya dengan
  `topic_id` sama. Angka tidak dipakai: perbandingan naif menghasilkan
  “2026 → 28” (tahun vs jumlah rangkaian).
- `misread` memakai teks penuh `article_text` (≥500 char), bukan lead RSS.
  Kalimat harus berbagi kata subjek dengan judul; halaman artikel memuat
  tautan berita lain, dan deteksi pertama sempat mengutip “Wacana SIM seumur
  hidup” untuk artikel kontrak influencer.
- Judul yang sudah memuat sinonim kualifikasi (`belum`, `wacana`, `rencana`,
  `diduga`, …) tidak layak dianggap misread.
- `missing` berisi fakta (“masih berupa usulan, bukan keputusan”), bukan nama
  kualifikasi (SCHEMA §3.7).
- Dedupe **tidak boleh** menyentuh kartu meta: judulnya mirip karena membahas
  kartu berita yang sama.
- Desk tidak menilai kartu meta dengan standar berita.
- Dua kartu meta memakai satu slot berita; hoax tetap dipertahankan.
- Timestamp sumber harus dari kartu (`+07:00`), bukan `articles.published_at`
  mentah (`Z`) yang ditolak skema.

Debug yang berguna: log `meta: ... · lanjut x/y · teks a/b · celah c`.
`lanjut 0` berarti tidak ada `topic_id` yang berkesinambungan; `teks 0` berarti
cache teks penuh tidak tersedia.

## 10. State CI dan konkurensi

- `.gitignore` pola `local.db` cocok di **kedalaman mana pun**. Itu diam-diam
  mengabaikan `data/state/local.db`, sehingga setiap run CI mulai kosong:
  rekap mingguan/deep dive tidak punya riwayat, langganan push hilang.
- Perbaikan: `/local.db` hanya di akar, `data/state/*.db` diabaikan sengaja,
  lalu `actions/cache` bergulir (`edisi-state-<run_id>`, restore prefix).
  `npm run state:info` membuktikan state terbawa (856 artikel di run kedua).
- Commit bot bukan syarat deploy. Push manusia saat run berjalan menggagalkan
  langkah commit dan melewati deploy. Kini commit retry +
  `continue-on-error`, deploy tetap jalan.
- `continue-on-error: true` tidak selalu menyelamatkan job (terjadi pada
  langkah auth OpenCode). Untuk langkah opsional, tangani kegagalan di dalam
  skrip dan `exit 0`.
- Installer OpenCode v1 (`/install`, 1.19.5) tidak punya `auth import`; v2
  (`/v2/install`, 2.2.7) punya. Smoke workflow membuktikan auth + model call.

## 11. Skill verifikasi

```bash
# edisi live
curl -s https://abbadaim.github.io/edisi-pagi/manifest.json | python3 -m json.tool
curl -s https://abbadaim.github.io/edisi-pagi/data/editions/2026-11-11.nasional.json \
  | python3 -c 'import json,sys; e=json.load(sys.stdin); [print(c["type"], c["title"][:55]) for c in e["cards"]]'

# validasi + tes
npm run validate -- data/editions/2026-11-11.nasional.json
npm test && npm run typecheck

# smoke OpenCode (tanpa menyentuh edisi)
gh workflow run opencode-smoke.yml --repo abbadaim/edisi-pagi
```

Checklist browser:

1. `latest_by_scope` di manifest.
2. Nav: Edisi/Sleman/Mingguan (bila ada)/Atur.
3. `#/atur`: panel Pasang, Notifikasi, Tentang.
4. `misread`: chip “Kata yang hilang dari judul”; `change`: timeline.
5. Offline: matikan server lokal, reload; shell + edisi terakhir tetap tampil.
6. Saat menguji `app.js` baru: hapus cache dan unregister SW dulu.

Jangan menjalankan ulang tanggal yang sudah terbit. Uji dengan
`--newsroom-limit 2 --thin` pada tanggal baru atau POC.

## 12. Cara memulai sesi berikutnya

```bash
git pull --rebase --autostash origin main
npm ci
npm run migrate
npm test
npm run typecheck
```

Baca `AGENTS.md`, lalu `NEWSROOM-IMPLEMENTATION.md`. Periksa run terakhir:

```bash
gh run list --workflow daily.yml --limit 3
```

Jangan mengubah edisi yang sudah terbit. Untuk eksperimen, pakai
`--newsroom-limit` dan `--thin`, atau POC.
