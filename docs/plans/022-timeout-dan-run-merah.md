# 022 — Batas waktu per kedalaman, dan run merah bila edisi tidak ada

```
Status: tested
Kelas: infra
Dibuat: 2026-11-17
Diperbarui: 2026-11-17
Mockup: — (kelas infra; kontrak di §4)
```

## 1. Masalah

Build 17 November 2026 (run `44004972321`) gagal terbit karena schema menolak
`frames.owner`, tetapi dua kelemahan lain terlihat di log yang sama:

```
! writer gagal: opencode timeout 240000ms
! newsroom tidak menghasilkan kartu sah — fallback writer lama
…
✗ tidak valid · tidak diterbitkan
```

1. **Satu batas waktu untuk semua kedalaman.** `OPENCODE_TIMEOUT_MS` 240 s
   berlaku untuk `brief` (1.200 token), `standard` (2.400), dan `deep` (5.600).
   Panggilan `brief` yang macet menahan 240 s sebelum fallback; `deep` sudah
   terukur 234 s sehingga nyaris kehabisan waktu.
2. **Run hijau padahal tidak ada yang terbit.** Langkah kesehatan tahu
   (`no-edition`) dan surel terkirim, tetapi status run tetap `success`, jadi
   `gh run list` tidak menunjukkan masalah. Commit dan deploy juga berjalan
   tanpa artefak baru.

## 2. Keputusan yang akan diambil

Batas waktu mengikuti ukuran keluaran, dan `health --strict` memerahkan run bila
edisi tidak terbentuk. Degradasi yang masih menghasilkan edisi (penulis
deterministik, kartu sedikit) **tidak** memerahkan run — itu tetap surel saja.
Tidak ada perubahan pada isi edisi atau gerbang terbit.

## 3. Rencana

1. `src/adapters/llm/types.ts` — `timeoutMs?` pada `JsonRequest`/`TextRequest`.
2. `src/adapters/llm/opencode.ts` — batas waktu per panggilan menimpa setelan
   adapter; pesan timeout menyebut angka yang dipakai.
3. `src/core/newsroom/write.ts` — `WRITER_TIMEOUT_MS` per kedalaman (120/170/320 s)
   dikirim bersama `maxTokens`.
4. `src/core/health.ts` — `FATAL_REASONS` + `fatalReasons()`.
5. `scripts/health.ts` — `--strict` keluar 1 bila ada alasan fatal.
6. `.github/workflows/daily.yml` — langkah kesehatan memakai `--strict`.

## 4. Kontrak

```bash
node scripts/health.ts --date 2026-11-18 --strict
# 2026-11-18 nasional: edisi tidak terbentuk
# {"ok":false,…,"reasons":["no-edition"],…}
# ✗ fatal: no-edition — tidak ada edisi untuk diterbitkan
# exit 1
```

```bash
node scripts/health.ts --date 2026-11-16 --strict   # edisi ada, deterministik
# … ALASAN: deterministic-writer, deterministic-adjudicate, few-cards
# exit 0  (tetap hijau; surel yang memberi tahu)
```

Aturan:

- Fatal hanya `no-edition`. `not-published` tidak fatal karena manifest bisa
  tertinggal satu langkah saat pemeriksaan.
- Langkah surel (`if: always()`) selalu berjalan, termasuk saat fatal.
- Commit dan deploy dilewati saat fatal (perilaku bawaan GitHub untuk langkah
  setelah kegagalan).

## 5. Tes

- `tests/health.test.ts` — dua kasus baru: `no-edition` fatal, penulis
  deterministik tidak fatal. Total 349 uji lulus.
- Verifikasi manual: perintah `--strict` di atas mengembalikan 1 dan 0 sesuai
  kontrak.

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| `deep` 320 s membuat CI lebih lama saat macet | `CARD_CONCURRENCY` 3; batas 75 menit masih jauh |
| Run merah pada hari sepi (memang tidak ada berita) | fatal hanya bila edisi **tidak terbentuk**; hari sepi tetap menghasilkan kartu hoax |
| Surel tidak terkirim saat fatal | langkah surel `if: always()` dan berjalan sebelum commit |
| Perubahan adapter menyentuh jalur lain | `timeoutMs` opsional; tanpa nilai, perilaku lama (240 s) |

Rollback: hapus `--strict` di `daily.yml`; hapus `timeoutMs` dari permintaan
writer.

## 7. Riwayat

- `2026-11-17` — `tested` — batas waktu per kedalaman, `--strict`, 2 uji baru.

## 8. Pelajaran (diisi setelah `shipped`)

—
