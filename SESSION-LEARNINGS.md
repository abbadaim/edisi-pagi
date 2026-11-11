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
- **189 tes** lulus; typecheck bersih.
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

---

## 8. Cara memulai sesi berikutnya

```bash
git pull --rebase origin main
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
