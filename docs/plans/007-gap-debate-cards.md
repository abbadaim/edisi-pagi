# 007 — Kartu `gap` dan `debate`

```
Status: tested (2026-11-11)
Kelas: pipeline
Dibuat: 2026-11-11
Diperbarui: 2026-11-11
Mockup: — (kelas pipeline; artefak = kontrak §4)
```

---

## 1. Masalah

Dua lapisan inti produk belum punya kartu:

- **Yang Luput** (`gap`) — topik ramai di luar media tetapi sedikit diliput.
- **Yang Diperdebatkan** (`debate`) — publik bereaksi keras, media tidak
  mencatatnya.

Tipe, skema, dan validasi (`E006`, `E009`) sudah ada; tidak ada yang
menghasilkan kartu. Butuh data amplifikasi yang selama ini tidak diambil.

## 2. Probe sumber (2026-11-11)

| Sumber | Hasil | Keputusan |
|---|---|---|
| Arctic Shift posts `?subreddit=indonesia&query=kpk&limit=10&sort=desc` | 200, JSON; query lebar 422 “slow down” | pakai query sempit + limit 10; gagal → null |
| Arctic Shift comments `?link_id=t3_<id>&limit=20` | 200, body/author/score | kutipan debat |
| Google Trends RSS `geo=ID` | 200, `<title>` + `approx_traffic` + `pubDate` | interest |
| Detik article HTML | `comment-count="902"` (tidak akurat) | hanya cadangan |
| Detik `apicomment.detik.com/detail-article/sneak-peek/` | 200, `total_comment` + `list_comment` | volume + kutipan debat |
| TikTok `challenge/detail` | 200, `viewCount` kumulatif, `videoCount` 0 | **null** untuk v1; tidak ada delta per topik |

Kutipan debat berasal dari `list_comment` Detik (nama + teks) dan Reddit
bila tersedia. Angka `comment-count` di HTML tidak dipakai bila API memberi
`total_comment`; keduanya bisa berbeda jauh.

## 3. Keputusan

- Amplifikasi v1 = Reddit (`score + 2×comments`) + komentar Detik + interest
  Trends. TikTok `null`, tidak dikarang.
- `gap` hanya arah **positif** (ramai, sedikit diliput) untuk v1; arah negatif
  belum punya semantik kartu yang jelas (`state`).
- `debate` hanya terbit bila ambang terpenuhi: komentar Detik ≥15 **atau**
  skor post Reddit ≥200.
- Data disimpan per `(edition_id, topic_id)` di tabel `social_cache`; build
  ulang tidak memanggil jaringan lagi.
- Maksimum 2 kartu meta per edisi nasional (`E009`). Prioritas:
  `change` > `debate` > `gap` > `misread`. `change` tetap dipertahankan.

## 4. Kontrak

### Data

```jsonc
{
  "reddit_score": 56,
  "reddit_comments": 42,
  "detik_comments": 120,
  "trend_interest": 2000,
  "tiktok_delta": null,
  "posts": [{ "title": "...", "score": 56, "comments": 42, "url": "..." }],
  "quotes": [{ "author": "...", "platform": "reddit", "text": "...", "score": 12 }]
}
```

- Query Reddit: satu kata/entitas paling distintif, `limit=10`, `sort=desc`.
  Post disaring: minimal satu token judul beririsan dengan topik.
- Komentar: hanya untuk post teratas, `limit=20`, urut skor.
- Trends: satu fetch per edisi; topik cocok bila judul tren berbagi token
  dengan topik.
- Detik: maksimum 3 artikel per topik yang punya sumber detik; ambil
  `article_id`/`channel_id` dari HTML lalu panggil sneak-peek. Total dari
  `total_comment`, kutipan dari `list_comment`.

### `gap`

| Field | Aturan |
|---|---|
| `gap_rank` | `rank(amplifikasi) − rank(jumlah artikel)`, 1-based; hanya ≥5 |
| `coverage` | artikel + outlet dari klaster |
| `social` | angka di atas; `tiktok_delta: null` |
| `absent_angle` | satu kalimat deterministik dari angka |
| `state` | `luput` |
| `days_watched` | 1 |
| `coverage_timeline` | maks 5 artikel klaster |
| Sumber | artikel klaster + thread Reddit + Trends |
| Body | 3 paragraf: sinyal sosial, jumlah liputan, cara membaca |

### `debate`

| Field | Aturan |
|---|---|
| `volume` | platform dengan angka terbesar; `count` |
| `tone` | leksikon kritis/mendukung/terbelah dari kutipan |
| `quotes` | maks 3 komentar Reddit (author + platform + teks ≤180) |
| `comparison` | platform lain + count + catatan |
| `reading` | satu kalimat deterministik |
| Sumber | thread Reddit + artikel klaster |
| Ambang | Detik ≥15 **atau** skor post Reddit ≥200 |

### Integrasi

- `build.ts` mengumpulkan kandidat (maks 8 topik nasional, bukan lokal),
  mengambil sinyal (cache), lalu membuat maks 1 `gap` + 1 `debate`.
- Gabungkan dengan `change`/`misread`; pilih 2 teratas menurut prioritas.
- `maxNews` 5 bila dua kartu meta, 6 bila satu.
- Tidak ada perubahan skema `edition.json`; migrasi `007_social_cache.sql`.

## 5. Tes

1. Parser: Trends RSS, Reddit posts JSON, Detik `comment-count`.
2. `amplification()` menjumlahkan sinyal dan mengabaikan null.
3. `computeGap()`: kandidat dengan amplifikasi tinggi & artikel sedikit →
   `gap_rank ≥5`; di bawah ambang → null.
4. `computeDebate()`: ambang Detik/Reddit; tone dari kutipan; tanpa kutipan →
   null.
5. `buildGapCard`/`buildDebateCard` lolos `validateEdition` (E006, E009).
6. Prioritas meta: change + debate dipilih, misread/gap gugur.
7. Tanpa jaringan di tes (fetch palsu); cache DB diuji dengan SQLite memori.

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| Arctic Shift 422/rate limit | query sempit, limit 10, gagal → null, cache |
| Data sosial tidak mewakili publik Indonesia | tulis “tidak representatif” di body |
| Kartu meta melebihi 2 | prioritas + `E009` |
| Build lambat | cache per edisi; maks 8 topik; fetch 10 dtk |
| Sumber berubah | parser defensif; tanpa data → tidak ada kartu |

Rollback: `SOCIAL_SIGNALS=off` (tidak ada fetch, tidak ada kartu gap/debate).
Tidak ada perubahan pada kartu yang sudah ada.

## Riwayat

- `2026-11-11` — `plan-draft` — dibuat setelah probe Arctic Shift, Trends,
  Detik, dan TikTok.
- `2026-11-11` — `plan-approved` / `mockup-approved` — pemilik meminta
  “let's do gap and debate cards”.
- `2026-11-11` — `implementing` — `social.ts` (Reddit/Trends/Detik),
  `meta-social.ts`, integrasi prioritas meta, renderer gap/debate, migrasi
  `007_social_cache.sql`, 12 uji.
- `2026-11-11` — `tested` — 12 uji sosial/meta; 242 uji total. Build lokal
  `--date 2026-11-12 --no-newsroom --thin` menghasilkan **kartu debate nyata**
  (Detik 139 komentar, 3 kutipan, nada kritis). Gap belum terpicu karena
  ambang `gap_rank ≥5` tidak terpenuhi pada data hari itu; jalur gap diuji
  sintetis. Reddit sedang 429/422, jadi debate memakai kutipan Detik.
