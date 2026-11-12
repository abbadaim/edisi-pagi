# 011 — Cache prompt terukur + prefix penulis yang stabil

```
Status: tested
Kelas: pipeline
Dibuat: 2026-11-12
Diperbarui: 2026-11-12
Mockup: — (kelas pipeline; artefak = kontrak §4)
```

---

## 1. Masalah

Dasbor DeepSeek untuk 2026-11-11:

| | Token |
|---|---:|
| Input (cache hit) | 659.328 |
| Input (cache miss) | 1.892.309 |
| Output | 687.586 |

Hit rate = 659.328 / 2.551.637 = **25,8%**.

Dua masalah, satu besar satu kecil:

1. **Pipeline tidak bisa melihat angka itu.** `src/adapters/llm/deepseek.ts` hanya
   membaca `prompt_tokens` dan `completion_tokens`; `prompt_cache_hit_tokens`
   dibuang. Hit rate hanya ada di dasbor vendor.
2. **Prefix penulis dipotong data per-kartu.** `src/core/newsroom/write.ts:126`
   menyisipkan `ctx.assignment.answers` ke dalam **system prompt**. Setiap kartu
   punya system berbeda, sehingga cache meleset tepat di titik itu.

**Koreksi estimasi awal.** Sebelum angka dasbor ada, dokumen ini memperkirakan
plafon hit ~8% (system ±1,2k dari total ±15k per panggilan). Angka sebenarnya
**25,8%**, menyiratkan prefix bersama ±4,3k token per panggilan — lebih besar
dari perkiraan, kemungkinan karena blok latar/glosarium yang sama ikut di awal
`user`. Pelajaran: hit rate tidak boleh ditebak dari bentuk prompt; harus diukur.

## 2. Keputusan yang akan diambil

Mengukur dulu, lalu memperbaiki prefix yang murah dan aman. **Tidak** membalik
urutan `[bahan][instruksi peran]` — itu satu-satunya perubahan yang bisa
menaikkan hit secara besar, tetapi menaruh instruksi setelah data menaikkan
risiko prompt injection dari teks artikel. Itu butuh gerbang kualitas sendiri
(§6).

`pertanyaan_wajib` tetap sampai ke model: ia sudah ada di `user` (baris 145),
jadi baris di `system` memang redundan — dihapus, bukan dipindahkan.

## 3. Rencana

1. `migrations/008_llm_cache_tokens.sql` — kolom `cached_tokens` (default 0).
2. `src/adapters/llm/types.ts` — `Usage.cached_tokens?`.
3. `src/adapters/llm/deepseek.ts` — baca `prompt_cache_hit_tokens`.
4. `src/adapters/llm/opencode.ts` — baca `tokens.cache.read` bila dilaporkan
   (0 bila tidak; tidak semua penyedia mengisi).
5. `src/core/telemetry.ts` — simpan `cached_tokens`, tambahkan `cachedTokens`
   ke `summary()`.
6. `scripts/build.ts` — baris log menyertakan cache dan hit rate.
7. `src/core/newsroom/write.ts` — hapus baris `answers` dari system prompt.

## 4. Kontrak

Baris log build:

```
sebelum: llm: 153 panggilan · 2551637/687586 token · $0.0000 · max 110873 ms
sesudah: llm: 153 panggilan · 2551637/687586 token · cache 659328 (26%) · $0.0000 · max 110873 ms
```

| Keadaan | `usage.cached_tokens` |
|---|---|
| DeepSeek melaporkan `prompt_cache_hit_tokens` | nilai itu |
| penyedia tidak melaporkan | `0` (bukan `undefined`) |
| adapter lama / non-JSON | `0` |

Invarian prompt: `buildWriterPrompt(ctxA).system === buildWriterPrompt(ctxB).system`
untuk dua kartu berbeda dengan kedalaman, lokalitas, dan bobot yang sama.

## 5. Tes

`tests/llm-cache.test.ts` (4 uji baru):

1. `prompt_cache_hit_tokens` → `usage.cached_tokens`.
2. Tanpa laporan cache → `0`, bukan `undefined`.
3. `system` penulis identik untuk dua kartu berbeda; `user` berbeda.
4. Pertanyaan wajib tidak ada di `system`, tetapi ada di `user`.

`tests/telemetry.test.ts` diperbarui: fixture memuat migrasi 008, dan assert
`cached_tokens` tersimpan serta terjumlah di `summary()`.

`npm test` = **248 lulus**; `npm run typecheck` bersih. `npm run migrate`
menerapkan 008 ke `local.db` (kolom terverifikasi lewat `pragma_table_info`).

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| Migrasi 008 belum jalan → telemetri mati | `telemetry.record` sudah menangkap error dan mencetak `jalankan npm run migrate`; CI menjalankan migrasi sebelum build |
| `cost_usd` tetap memakai harga miss untuk token hit | harga cache belum dikonfigurasi; `cost_usd` memang sering 0. Catat sebagai keterbatasan, jangan pakai untuk keputusan |
| Menghapus baris `answers` dari system menurunkan kepatuhan | pertanyaan tetap ada di `user.pertanyaan_wajib`; uji 4 mengunci keberadaannya |
| Harapan berlebih pada penghematan | lihat §8: cache hanya ±17% dari total biaya |

Rollback: hapus migrasi 008 dan kolom; kode tetap jalan karena `cached_tokens`
opsional. Baris `answers` di system bisa dikembalikan tanpa migrasi.

**Belum dikerjakan (butuh gerbang sendiri).** Membalik urutan menjadi
`[bahan][instruksi peran]` untuk berbagi prefix antar-peran (write→edit→repair→desk
memakai bahan yang sama). Perkiraan: hit 26% → 50–60%. Syarat: ukur tingkat
`E-FACT` pada fixture tetap sebelum/sesudah; bila memburuk, batalkan.

## 7. Riwayat

- `2026-11-12` — `plan-draft` — dibuat setelah pemilik proyek memeriksa dasbor
  DeepSeek dan menemukan cache miss dominan.
- `2026-11-12` — `mockup-approved` — kontrak §4 disetujui lewat instruksi:
  “do the plan 011 for cache instrumentation + prompt reordering”.
- `2026-11-12` — `tested` — migrasi 008, instrumentasi, penghapusan baris
  `answers` dari system prompt, 4 uji baru; 248 lulus.

## 8. Pelajaran

**Hit rate tidak bisa ditebak.** Estimasi 8% salah; angka sebenarnya 25,8%.
Bentuk prompt memberi batas atas, tetapi blok yang ikut terbawa (latar,
glosarium) menentukan hasil nyata. Instrumentasi dulu, baru optimasi.

**Output adalah biaya terbesar, bukan input.** Dengan 687.586 token keluaran
dan harga keluaran beberapa kali harga masukan, keluaran kira-kira 58% dari
tagihan; masukan 42%. Menaikkan hit rate dari 26% ke 60% memangkas sekitar
**17% total**, bukan setengah. Penghematan yang jauh lebih besar ada di jumlah
dan panjang keluaran: revisi 2 → 1, dan kedalaman kartu — bukan di cache.

**Pemeriksaan lanjutan: planner sudah benar.** `buildPlannerPrompt` menaruh
seluruh aturan di `system` (statis) dan seluruh kandidat di `user`. Jadi 13k
token masukan planner memang tidak bisa di-cache — bukan bug, melainkan sifat
data. Yang bisa diperbaiki hanya prefix bersama, bukan muatan unik.

**Prefix bersama adalah kontrak byte, bukan niat.** Dua prompt yang “terasa
sama” tidak menolong bila satu baris berbeda di tengah; uji 3 mengunci
kesamaan `system` secara literal.
