# 012 — Buat OpenCode layak untuk build harian

```
Status: tested
Kelas: pipeline
Dibuat: 2026-11-12
Diperbarui: 2026-11-12
Mockup: — (kelas pipeline; artefak = kontrak §4)
```

---

## 1. Masalah

OpenCode memakai `opencode-go/deepseek-v4.1-flash`, yang jauh lebih lambat
per panggilan daripada `deepseek-chat` langsung:

| Edisi | Penyedia | Panggilan | Rata-rata |
|---|---|---:|---:|
| 2026-11-11 | deepseek langsung | 153 | 7,5 s |
| 2026-11-12 | opencode | 23 | 46,6 s |

Dengan 153 panggilan berurutan, satu edisi butuh **±119 menit**, sedangkan job
dibatasi 45 menit. Dua panggilan menembus timeout 180 s (planner, writer), dan
build berjalan 22 menit tanpa menyelesaikan satu pun kartu sah.

Pengukuran lokal (2026-11-12):

| Beban | Waktu |
|---|---:|
| prompt sepele | 3,66 s |
| 300 kata | 23,78 s |
| 1.200 kata | 87,82 s |
| 3 × 300 kata berurutan | 154,44 s |
| 3 × 300 kata **paralel** | 46,76 s (**3,3×**) |

Latensi ikut panjang keluaran, dan konkurensi berskala hampir linear. Jadi
masalahnya bukan OpenCode yang "rusak", melainkan pipeline yang memanggil
berurutan.

## 2. Keputusan yang akan diambil

1. Kartu dibangun **paralel dengan batas 3** (`CARD_CONCURRENCY`, default 3).
2. Timeout panggilan dinaikkan 180 s → 300 s, dan **timeout tidak diulang**.
3. Batas job 45 → 75 menit sebagai margin, bukan sebagai perbaikan.

Syarat mutlak: telemetri tidak boleh salah label saat paralel. `telemetry.set()`
kini menyimpan konteks di objek global; dengan dua kartu berjalan bersamaan,
panggilan kartu A bisa tercatat atas nama kartu B — tepat metrik yang baru saja
kita bangun (`DEC-0024`).

## 3. Rencana

1. `src/core/pool.ts` — `pool(items, limit, fn)` dari `material.ts`, dipakai
   bersama. Urutan hasil dipertahankan.
2. `src/core/newsroom/material.ts` — impor `pool` dari modul baru.
3. `src/core/telemetry.ts` — konteks per-async (`AsyncLocalStorage`):
   `run(ctx, fn)`; `set()` mengubah konteks milik jalur itu saja.
4. `scripts/build.ts` — `renderCards`: pra-tentukan `deep` dan catatan sebelum
   fan-out, lalu `pool(…, CARD_CONCURRENCY, …)` di dalam `telemetry.run`.
5. `src/adapters/llm/opencode.ts` — timeout default 300 s, dapat ditimpa
   `OPENCODE_TIMEOUT_MS`.
6. `src/core/writer-llm.ts` — jangan ulangi panggilan yang timeout (dulu 4×).
7. `.github/workflows/daily.yml` — `timeout-minutes: 75`.

## 4. Kontrak

```
CARD_CONCURRENCY=3   # default; 1 = perilaku lama (berurutan)
```

| Keadaan | Hasil |
|---|---|
| `CARD_CONCURRENCY=1` | urutan dan isi kartu identik dengan sebelum perubahan |
| `CARD_CONCURRENCY=3` | jumlah kartu sama; urutan sama; isi bisa berbeda antar-jalan hanya bila model nondeterministik |
| dua kartu paralel | tiap baris `llm_calls` memakai `topic_id` milik kartunya sendiri |

Perkiraan waktu: 153 panggilan ÷ 3 × 46,6 s ≈ **40 menit** (dari 119 menit).
Dengan timeout 300 s, panggilan lambat tidak lagi langsung gagal.

## 5. Tes

1. `tests/pool.test.ts` — urutan hasil dipertahankan, batas konkurensi tidak
   dilampaui, error diteruskan.
2. `tests/telemetry.test.ts` — **dua `run()` bersamaan** dengan role/topik
   berbeda; tiap baris harus memakai topiknya sendiri. Tanpa `AsyncLocalStorage`
   uji ini gagal.
3. `npm test` dan `npm run typecheck` lulus.
4. `CARD_CONCURRENCY=2 npm run build -- --newsroom-limit 2 --thin --date
   2026-11-12` → **12 kartu dalam 482,7 s**, `max 110873 ms`, satu kartu jatuh
   ke penulis lama karena timeout (sebelum v2), `cache 68736 (16%)`.
5. Uji invarian v2: batas token tiap kedalaman < timeout.

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| Label telemetri tertukar | `AsyncLocalStorage` + uji 2 |
| ID kartu bentrok | ID diberikan setelah semua kartu terkumpul, urutan hasil `pool` dipertahankan |
| SQLite ditulis bersamaan | driver sinkron; tidak ada transaksi yang melintasi `await` |
| Rate limit penyedia | batas 3, dapat diturunkan lewat env tanpa mengubah kode |
| Dua kartu memakai catatan yang sama | `usedNoteIds` dipra-tentukan sebelum fan-out |
| `deep` dipakai dua kali | `deepUsed` dipra-tentukan sebelum fan-out |

Rollback: `CARD_CONCURRENCY=1`. Tidak ada migrasi, tidak ada perubahan skema.

## 7. Revisi

### v2 — 2026-11-12 — batas keluaran harus muat di anggaran waktu

**Ditemukan saat uji ujung-ke-ujung** (`CARD_CONCURRENCY=2`, `--newsroom-limit 2
--thin`, `--date 2026-11-12`):

```
planner newsroom: 8 tugas
! writer gagal: opencode timeout 240000ms
! newsroom tidak menghasilkan kartu sah — fallback writer lama
kartu: news:5 news:4 debate:2 hoax_roundup:1
llm: 36 panggilan · cache 68736 (16%) · max 110873 ms
real 482.70
```

Paralelisasi bekerja (12 kartu, 8 menit), tetapi satu panggilan **tetap**
menembus 240 s.

**Sebabnya bukan penyedia, melainkan batas yang kita izinkan sendiri.**
`writeDraft` memakai `maxTokens: 8000` untuk `deep`. Pada laju terukur 28
token/detik (3.104 token dalam 110,9 s), 8.000 token = **±285 s** — panggilan
yang mustahil selesai di timeout 240 s. Batas itu menjanjikan hal yang tidak
bisa ditepati.

**Perubahan.** `WRITER_MAX_TOKENS = { brief: 1200, standard: 2400, deep: 5600 }`,
diturunkan dari target kata (`AGENTS.md` §4.2) dengan margin ±1,6×. `deep` 5.600
token ≈ 200 s. Uji baru mengunci invarian: **batas token tiap kedalaman harus
muat di timeout**, bukan sekadar “terasa cukup”.

**Koreksi pembacaan.** “newsroom tidak menghasilkan kartu sah — fallback writer
lama” bersifat **per kartu** (`scripts/build.ts:389`), bukan per edisi. Satu
timeout menurunkan satu kartu, bukan seluruh edisi. Catatan ini ditulis karena
pembacaan pertama menyimpulkan yang lebih buruk daripada kenyataan.

---

## 8. Riwayat

- `2026-11-12` — `plan-draft` — dibuat setelah build 2026-11-12 dibatalkan pada
  22 menit tanpa satu kartu sah.
- `2026-11-12` — `mockup-approved` — kontrak §4 disetujui lewat instruksi:
  “let's fix the opencode”.
- `2026-11-12` — `tested` — pool bersama, telemetri per-async, kartu paralel,
  timeout 240 s, batas job 75 menit.
- `2026-11-12` — `tested` — v2: `WRITER_MAX_TOKENS` dibatasi agar muat di
  timeout; 255 uji lulus.

## 9. Pelajaran

**Paralelisme membongkar asumsi state bersama.** `telemetry.set()` terlihat
tidak berbahaya saat berurutan; ia menjadi bug senyap begitu ada dua pekerja.
Yang membuatnya berbahaya: ia merusak metrik yang dipakai untuk mengambil
keputusan berikutnya.

**Konkurensi bukan pengganti efisiensi.** 3× hanya menutup selisih; 153
panggilan tetap 153 panggilan. Kalau ingin lebih cepat lagi, jumlah dan panjang
keluaran yang harus turun — bukan konkurensi dinaikkan terus.
