# Skema Data — `edition.json` dan Artefak Terkait

**Versi dokumen:** 0.2
**Versi skema:** 1
**Status:** kontrak pipeline ↔ aplikasi
**Bergantung pada:** `REQUIREMENTS.md` v0.1
**Model notifikasi:** A (pipeline menerbitkan, aplikasi memutuskan)
**Sinkronisasi:** tidak ada di v1. Rencana: sinkronisasi. Lihat §12.

---

## 0. Invarian

Tujuh aturan yang tidak boleh dilanggar. Semuanya mengikat pipeline *dan* renderer.

| # | Invarian |
|---|---|
| I1 | `editions/*.json` bersifat **immutable** setelah diterbitkan. Koreksi = edisi baru, bukan suntingan. |
| I2 | `topic_id` **stabil antar hari** dan bersifat **thread-level** (satu isu yang berjalan), bukan per-kejadian. Irisan harian dinyatakan oleh `angle`. Lihat `CLUSTERING.md` §0. |
| I3 | Renderer **wajib mengabaikan** field yang tidak dikenal, dan tetap menampilkan kartu bertipe tidak dikenal dalam bentuk minimal (judul + sumber). |
| I4 | Semua timestamp ISO 8601 dengan offset `+07:00`. `edition_id` = tanggal lokal `YYYY-MM-DD`. |
| I5 | Aplikasi **tidak pernah** membaca database pipeline. Hanya berkas statis. |
| I6 | Tidak ada data personal di dalam edisi. Lokasi hanya nama kabupaten. |
| I7 | `schema_version` naik hanya untuk perubahan yang **merusak**. Penambahan field tidak menaikkannya. |

---

## 1. Tata letak berkas

```
data/
├── manifest.json                     daftar edisi (diperbarui tiap terbit)
├── search/
│   ├── hot.json                      indeks 90 hari terakhir (dimuat saat buka)
│   └── 2026-Q3.json                  arsip per kuartal (dimuat sesuai kebutuhan)
├── editions/
│   └── 2026-11-10.json               satu berkas per hari, immutable
├── topics/
│   └── t_gibran_hmp.json             riwayat topik (diambil saat kartu dirender)
└── assets/
    └── a1b2c3d4.webp                 gambar WebP, disimpan lokal, diberi hash
```

Aplikasi mulai dari `manifest.json`, lalu mengambil berkas lain sesuai kebutuhan.

---

## 2. `edition.json`

### 2.1 Root

```jsonc
{
  "schema_version": 1,
  "edition_id": "2026-11-10",
  "scope": "nasional",
  "published_at": "2026-11-11T05:45:00+07:00",
  "coverage": { "from": "2026-11-10T05:00:00+07:00", "to": "2026-11-11T05:00:00+07:00" },
  "generated_at": "2026-11-10T05:52:13+07:00",
  "locale": "id-ID",
  "place": { "kabupaten": "Sleman", "province": "DI Yogyakarta" },
  "reading_time_min": 4,
  "generated_by": {
    "adjudicate": { "provider": "deepseek", "model": "deepseek-flash" },
    "write":      { "provider": "deepseek", "model": "deepseek-flash" },
    "verify":     { "provider": "deepseek", "model": "deepseek-v4-pro" },
    "embed":      { "provider": "local",    "model": "multilingual-e5-small" }
  },
  "card_count": 8,
  "truncated_reason": null,
  "cards": [ /* 6–8 kartu */ ]
}
```

| Field | Tipe | Wajib | Aturan |
|---|---|---|---|
| `schema_version` | int | ✅ | `1` untuk versi ini |
| `edition_id` | string | ✅ | `^\d{4}-\d{2}-\d{2}$`, unik per `scope` |
| `scope` | enum | ✅ | `nasional` \| `lokal` \| `mingguan` |
| `coverage` | object | ✅ | `{ from, to }` — jendela liputan, ISO 8601. `edition_id` = hari baca, `coverage` = hari yang diliput |
| `published_at` | string | ✅ | Waktu edisi tersedia untuk pengguna |
| `generated_at` | string | ✅ | Waktu pipeline selesai |
| `locale` | string | ✅ | `id-ID` |
| `place` | object | ✅ | Hanya nama; tanpa koordinat |
| `reading_time_min` | int | ✅ | `ceil(total_kata / 200)` |
| `generated_by` | object | ✅ | `{ adjudicate, write, verify, embed }` — masing-masing `{ provider, model }` |
| `card_count` | int | ✅ | nasional 5–8 (target 8) · lokal 2–5 · mingguan 3–6 |
| `truncated_reason` | string \| null | ✅ | Wajib terisi jika `card_count < 8` |
| `cards` | array | ✅ | 6–8 item, lihat §2.2 |

### 2.2 Kartu — field bersama

| Field | Tipe | Wajib | Aturan |
|---|---|---|---|
| `id` | string | ✅ | `^c[1-8]$`, unik dalam edisi |
| `type` | enum | ✅ | Lihat §3 |
| `topic_id` | string | ✅ | `^t_[a-z0-9_]{2,48}$`, thread-level |
| `angle` | string | ✅ | ≤ 90 karakter; kejadian hari ini di dalam thread |
| `kicker` | string | ✅ | Maks 20 karakter (`Nasional`, `Sleman`, `Ekonomi`) |
| `title` | string | ✅ | Maks 70 karakter, tanpa kapital semua |
| `status` | enum | ✅ | `terkonfirmasi` \| `sebagian` \| `belum` \| `dibantah` |
| `truth` | object \| null | ✅ | Blok kebenaran (§2.5). `null` untuk opini, prediksi, dan kartu non-berita |
| `body` | string[] | ✅ | 1–3 paragraf, tiap paragraf ≤ 480 karakter |
| `explain` | ExplainItem[] | — | 2–4 pertanyaan konteks; wajib untuk `news`/`good_news` (E017, §2.6) |
| `action` | string | ✅ | Satu kalimat, ≤ 160 karakter, imperatif |
| `image` | object \| null | ✅ | `{ url, credit, alt, fallback? }`; `url` relatif ke `/assets/`, format `.webp` |
| `sources` | Source[] | ✅ | ≥ 1 |
| `revision` | int | ✅ | ≥ 1; naik saat klaim berubah |
| `first_seen` | string | ✅ | `YYYY-MM-DD`, tanggal topik masuk sistem |
| `previous_edition` | string \| null | ✅ | `null` jika topik baru |
| `changes` | Change[] | ✅ | Boleh kosong |

### 2.3 `Source`

```jsonc
{
  "outlet": "detik.com",
  "url": "https://news.detik.com/berita/d-8746364/...",
  "published_at": "2026-11-10T12:34:00+07:00",
  "tier": 1,
  "accessed_at": "2026-11-10T05:40:00+07:00"
}
```

| Field | Tipe | Aturan |
|---|---|---|
| `outlet` | string | Nama domain atau lembaga |
| `url` | string | Wajib absolut dan dapat diakses |
| `published_at` | string \| null | `null` jika sumber tidak bertanggal |
| `tier` | 1 \| 2 \| 3 | 1 = sumber primer (polisi, pemda, BNPB, OJK, MUI); 2 = media kredibel; 3 = lainnya |
| `accessed_at` | string | Waktu pengambilan |

**Aturan:** kartu dengan `status: "terkonfirmasi"` wajib punya ≥1 sumber `tier: 1`.

### 2.4 `Change`

```jsonc
{
  "field": "status",
  "from": "belum",
  "to": "sebagian",
  "at": "2026-11-10T12:36:00+07:00",
  "basis": { "outlet": "detik.com", "url": "https://..." }
}
```

| Field | Tipe | Aturan |
|---|---|---|
| `field` | enum | `status` \| `label` \| `number` \| `title` \| `scope` |
| `from` | string \| number \| null | Nilai sebelumnya |
| `to` | string \| number | Nilai baru |
| `at` | string | Waktu sumber yang menyebabkan perubahan |
| `basis` | object | `{ outlet, url }` — wajib |

**Aturan:** `changes` tidak boleh berisi perubahan tanpa `basis`. Perubahan tanpa sumber resmi = bukan perubahan, tapi dugaan.

### 2.5 `truth` — kebenaran dan keyakinan

Blok ini menilai **satu pernyataan yang bisa diperiksa** di dalam kartu, bukan seluruh cerita.

```jsonc
{
  "claim": "50 anggota DPR telah menandatangani usulan HMP",
  "status": "sebagian",
  "confidence": 0.72,
  "band": "belum_pasti",
  "basis": {
    "strongest": "two_independent_tier2",
    "primary": 0,
    "tier2": 4,
    "independent_outlets": 3,
    "contradicting": 0
  },
  "gaps": ["Belum ada daftar nama resmi yang dipublikasikan"],
  "would_change_if": "DPR mempublikasikan daftar penandatangan",
  "assessed_at": "2026-11-11T05:12:00+07:00"
}
```

**Kapan diisi.** Hanya untuk pernyataan asertif dan terperiksa:

| Diisi | Tidak diisi (`null`) |
|---|---|
| "X mengatakan Y" (dengan rekaman/rilis) | "seharusnya pemerintah…" (opini) |
| Angka, tanggal, nama, jabatan | "akan terjadi…" (prediksi) |
| Kebijakan yang sudah/ belum berlaku | Pertanyaan retoris |
| Status hukum seseorang | Penilaian moral |

**Perhitungan `confidence`.** Berbasis kelas bukti, bukan penilaian model:

```
dasar (ambil yang terkuat):
  primary_confirms       0,95
  two_independent_tier2  0,85
  one_tier2              0,70
  tier3_only             0,40
  primary_contradicts    0,05

penyesuaian:
  tidak ada sumber primer          −0,05
  ≥3 outlet independen             +0,03
  semua sumber dari satu grup      −0,10
  klaim berupa angka               −0,03
  tidak berubah >48 jam            −0,02
  ada bantahan resmi yang belum
    ditindaklanjuti                −0,05

clamp [0,05 ; 0,97]
```

**`band`** diturunkan dari `confidence`, dan **hanya `band` yang ditampilkan**:

| `confidence` | `band` | Tampilan |
|---|---|---|
| 0,90–0,97 | `hampir_pasti` | Hampir pasti |
| 0,75–0,89 | `kemungkinan_besar` | Kemungkinan besar |
| 0,55–0,74 | `belum_pasti` | Belum pasti |
| 0,30–0,54 | `diragukan` | Diragukan |
| < 0,30 | `kemungkinan_tidak` | Kemungkinan tidak benar |

**Aturan tampilan:** angka `confidence` **tidak pernah** ditampilkan sebagai persentase. Angka itu hanya untuk pengurutan internal. Menampilkan "72%" menyiratkan presisi yang tidak dimiliki skor berbasis aturan.

**Batas penting.** Blok ini menilai pernyataan **di dalam pemberitaan**. Ia tidak pernah dipakai untuk memutuskan apakah konten viral itu hoaks — itu tetap hanya dari `hoax_roundup` dan sumber fact-check (§3.2).

### 2.6 `explain` — konteks

```jsonc
[
  {
    "q": "Apa itu HMP?",
    "a": "Hak Menyatakan Pendapat adalah hak konstitusional DPR (Pasal 20A UUD 1945) untuk menyatakan pendapat atas kebijakan pemerintah atau peristiwa luar biasa.",
    "source": { "outlet": "DPR RI", "url": "https://www.dpr.go.id/" }
  }
]
```

| Field | Aturan |
|---|---|
| `q` | 8–90 karakter, diakhiri `?` |
| `a` | 40–420 karakter, 1–3 kalimat |
| `source` | `{ outlet, url }`; boleh berbeda dari `sources` kartu |
| jumlah | 2–4 untuk `news`/`good_news`; maksimum 4 untuk tipe lain |

**Aturan isi:** jawaban menjelaskan latar — istilah, orang, lembaga, prosedur — bukan mengulang `body`. Tidak ada opini atau prediksi. Satu pertanyaan yang benar-benar menjelaskan lebih berharga daripada empat yang mengulang kalimat pembuka.

**Koherensi.** Jika satu klaster memuat beberapa peristiwa terkait, penulis memilih satu. `angle` dan `claim` yang tidak nyambung dengan `title` (kemiripan token di bawah 0,12 / 0,10) diganti dengan judul itu sendiri, supaya kartu tidak membicarakan dua hal sekaligus.

**Kenapa sumber terpisah:** menjawab "apa itu HMP" wajar merujuk ke situs DPR atau UUD, bukan ke artikel berita hari itu. Menempelkan seluruh blok ke `sources` kartu akan memaksa sumber berita menanggung klaim latar yang tidak pernah ia buat.

---

## 3. Tipe kartu

Tujuh tipe. Setiap tipe mewarisi semua field §2.2 dan menambah field sendiri.

| `type` | Slot | Field tambahan |
|---|---|---|
| `news` | berita | `place` |
| `deep_dive` | 1 | `dek`, `stats[]`, `optional`, `read_min` |
| `hoax_roundup` | 1 | `items[]`, `pattern` |
| `good_news` | 1 | `place` |
| `gap` | meta | `social`, `coverage`, `gap_rank`, `absent_angle` |
| `change` | meta | `before`, `after`, `what_changed`, `what_unknown` |
| `debate` | meta | `volume`, `tone`, `quotes[]`, `comparison`, `reading` |
| `misread` | meta | `claim`, `truth`, `missing[]`, `trigger` |

### 3.1 `news`

```jsonc
{ "place": "nasional" }   // "nasional" | "lokal"
```

Kartu dengan `place: "lokal"` wajib punya ≥1 sumber dengan domain media lokal DIY.

### 3.2 `hoax_roundup`

```jsonc
{
  "items": [
    {
      "claim": "Rekaman suara Prabowo hasil penyadapan",
      "verdict": "salah",
      "reason": "Potongan wawancara tvOne 15 Sep 2014, menit 05.14–06.55",
      "outlet": "turnbackhoax.id",
      "url": "https://turnbackhoax.id/articles/37415-..."
    }
  ],
  "pattern": "Tiga dari sepuluh fact-check hari ini adalah rekaman lama yang diberi tanggal baru."
}
```

| Field | Aturan |
|---|---|
| `claim` | Klaim seperti yang beredar, ≤ 140 karakter |
| `verdict` | `salah` \| `parodi` \| `menyesatkan` \| `konteks_hilang` |
| `reason` | **Wajib spesifik** — tanggal, menit, nama, angka |
| `outlet`, `url` | Wajib; hanya dari daftar sumber fact-check yang diizinkan |

**Aturan:** `items` boleh kosong **hanya jika** `pattern` terisi.

### 3.3 `good_news`

Sama dengan `news`, tanpa tambahan.

### 3.4 `gap` — Yang Luput

```jsonc
{
  "social": { "reddit_score": 907, "reddit_comments": 102, "trend_interest": 500, "tiktok_delta": null },
  "coverage": { "article_count": 1, "outlets": ["tirto.id"] },
  "gap_rank": 6,
  "absent_angle": "Siapa yang menandatangani kontrak, dan untuk kampanye apa",
  "first_detected": "2026-11-09T14:38:00+07:00",
  "days_watched": 2,
  "state": "mulai_diliput",
  "coverage_timeline": [
    { "at": "2026-11-10T16:20:00+07:00", "outlet": "tirto.id", "url": "https://tirto.id/..." }
  ]
}
```

| Field | Aturan |
|---|---|
| `social` | Semua angka; `null` jika tidak tersedia |
| `coverage.article_count` | Jumlah artikel unik setelah dedupe |
| `gap_rank` | `peringkat(amplifikasi) − peringkat(liputan)`, bilangan bulat |
| `absent_angle` | Wajib; satu hal konkret yang tidak diliput |
| `first_detected` | Saat pertama kali masuk watchlist |
| `days_watched` | 0–14 |
| `state` | `luput` \| `mulai_diliput` \| `ditutup` |
| `coverage_timeline` | 0–5 entri, urut waktu; satu entri per outlet baru |

`gap_rank ≥ +5` → "ramai, tidak diliput". `≤ −5` → "diliput, tidak dibaca". Di antaranya, kartu tidak boleh diterbitkan.

**Siklus hidup** (`RANKING.md` §6.5): kartu tetap di watchlist sampai ditutup, dan setiap liputan baru dicatat sebagai `changes[]` dengan `field: "scope"`.

### 3.5 `change` — Yang Berubah

```jsonc
{
  "before": {
    "at": "2026-11-09T19:36:00+07:00",
    "label": "Bang Jago",
    "quote": "Bang Jago Dihajar Warga",
    "source": { "outlet": "detik.com", "url": "https://..." }
  },
  "after": {
    "at": "2026-11-10T12:36:00+07:00",
    "label": "Korban",
    "quote": "Korban diketahui berinisial GIJ (21)… pekerjaan sebagai mahasiswa",
    "source": { "outlet": "detik.com", "url": "https://..." }
  },
  "what_changed": "Label pelaku → korban; identitas: preman → mahasiswa",
  "what_unknown": "Klaim 'mabuk' masih keterangan warga, bukan hasil pemeriksaan"
}
```

**Aturan:** `changes` wajib ≥1 dan harus konsisten dengan `before`/`after`.

### 3.6 `debate` — Yang Diperdebatkan

```jsonc
{
  "volume": { "platform": "detik.com", "count": 30 },
  "tone": "Mayoritas menuntut mundur",
  "quotes": [
    { "author": "Wahjana", "platform": "detik.com", "text": "mundur aja lah kl msh punya malu" }
  ],
  "comparison": { "platform": "reddit", "count": 1, "note": "nyaris tidak bergerak" },
  "reading": "Publik vokal, komunitas Reddit tidak."
}
```

**Aturan:** `reading` ditandai sebagai interpretasi. `platform` wajib disebut pada setiap kutipan.

### 3.7 `misread` — Yang Salah Dipahami

```jsonc
{
  "claim": "Vape sudah dilarang",
  "reality": "Fatwa adalah ketetapan keagamaan; belum ada UU dan belum ada sanksi",
  "missing": ["MUI meminta Presiden dan DPR menyusun UU pelarangan"],
  "trigger": "headline_body_gap"
}
```

| Field | Aturan |
|---|---|
| `trigger` | `headline_body_gap` \| `repeat_question` \| `search_query` \| `fact_check` |
| `missing` | 1–3 fakta yang hilang saat dikutip ulang |

**Catatan penamaan:** field ini bernama `reality`, bukan `truth`, karena `truth` sudah dipakai untuk blok keyakinan (§2.5) di semua kartu.

### 3.8 `deep_dive` — Mendalam

Satu per edisi nasional. Berasal dari thread berumur 7–30 hari, bukan dari siklus harian.

```jsonc
{
  "dek": "Pemerintah menyiapkan satu juta ton. Harga di 84 daerah belum bergerak. Masalahnya bukan pasokan.",
  "optional": true,
  "read_min": 7,
  "stats": [
    { "value": "Rp13.100", "label": "harga SPHP per kg" },
    { "value": "84", "label": "daerah lonjakan harga" },
    { "value": "1 jt ton", "label": "stok SPHP disiapkan" }
  ]
}
```

| Field | Aturan |
|---|---|
| `dek` | 1 kalimat, ≤ 160 karakter, menyatakan tesis |
| `optional` | Selalu `true`. Tidak dihitung dalam `reading_time_min` edisi |
| `read_min` | 4–8 menit |
| `stats` | 2–3 item; `value` maks 12 karakter |
| `body` | 2–4 paragraf (lebih panjang dari `news`) |
| `sources` | ≥ 3 (harian) / ≥ 2 (mingguan), mencakup rentang waktu ≥ 7 hari |

**Aturan:** `optional: true` berarti kartu ini tidak masuk hitungan "±5 menit" di header. Aplikasi menampilkannya dengan penanda bacaan panjang, dan pengguna boleh melewatinya tanpa kehilangan sisa edisi.

---

## 4. `topics/{topic_id}.json`

Riwayat satu topik. **Diambil saat kartu dirender** (D2), bukan saat disimpan.

```jsonc
{
  "schema_version": 1,
  "topic_id": "t_pajero_gejayan",
  "title": "Pemuda Pajero di Gejayan",
  "first_seen": "2026-11-09",
  "last_updated": "2026-11-10T12:40:00+07:00",
  "entities": ["Pajero", "Gejayan", "Depok", "Sleman"],
  "revisions": [
    {
      "revision": 1,
      "edition_id": "2026-11-09",
      "status": "belum",
      "label": "Bang Jago",
      "summary": "Pemuda diamuk massa setelah menggeber Pajero",
      "sources": [ /* Source[] */ ]
    }
  ]
}
```

Batas ukuran: ≤ 8 KB. Jika revisi > 30, pangkas yang tertua dan set `truncated: true`.

**Sifat:** append-only. `last_updated` berubah setiap revisi, sehingga aman di-cache dengan kunci `topic_id + last_updated`.

---

## 5. `manifest.json`

Satu-satunya berkas yang dibaca saat aplikasi dibuka.

```jsonc
{
  "schema_version": 1,
  "generated_at": "2026-11-10T06:00:00+07:00",
  "latest": "2026-11-10",
  "retention": { "years": 2, "oldest": "2024-11-10" },
  "editions": [
    { "edition_id": "2026-11-10", "scope": "nasional", "published_at": "…", "card_count": 8, "reading_time_min": 4 },
    { "edition_id": "2026-11-10", "scope": "lokal",    "published_at": "…", "card_count": 4, "reading_time_min": 2 }
  ]
}
```

Batas: 800 entri (2 tahun + margin). Ukuran ± 70 KB.

---

## 6. Pencarian

Dua lapis, agar 2 tahun arsip tidak perlu diunduh sekaligus.

### 6.1 `search/hot.json` — 90 hari terakhir

```jsonc
{
  "schema_version": 1,
  "generated_at": "2026-11-10T06:00:00+07:00",
  "window": { "from": "2026-08-12", "to": "2026-11-10" },
  "docs": [
    {
      "id": "2026-11-10/c1",
      "edition_id": "2026-11-10",
      "topic_id": "t_gibran_hmp",
      "type": "news",
      "title": "DPR: 50 anggota teken HMP",
      "text": "…teks isi tanpa markup, ≤ 600 karakter…",
      "date": "2026-11-10"
    }
  ]
}
```

± 720 dokumen, ± 1,4 MB. Dimuat sekali saat aplikasi dibuka, disimpan di IndexedDB.

### 6.2 `search/{YYYY}-Q{n}.json` — arsip per kuartal

Struktur sama. ± 1,4 MB per kuartal. **Hanya diunduh** ketika pencarian di indeks panas tidak menghasilkan apa pun, atau ketika pengguna meminta "cari di arsip".

### 6.3 Biaya

| Arsip | Dokumen | Ukuran |
|---|---|---|
| 2 tahun | 5.840 | ± 11,7 MB (terbagi 8 shard) |
| Dimuat saat buka | 720 | ± 1,4 MB |

Yang ditanggung pengguna saat membuka aplikasi hanya 1,4 MB, bukan 11,7 MB.

---

## 7. Aturan validasi

Berkas edisi **ditolak** jika salah satu terpenuhi:

1. `card_count ≠ cards.length`, atau di luar rentang: nasional 5–8, lokal 2–5, mingguan 3–6
2. Ada `card_count < 8` tanpa `truncated_reason`
3. Ada kartu tanpa `sources`, atau `action`/`angle` kosong
4. Ada kartu `status: "terkonfirmasi"` tanpa sumber `tier: 1`
5. Ada `changes[]` berisi entri tanpa `basis`
6. Ada `gap` dengan `|gap_rank| < 5`
7. Ada `hoax_roundup` dengan `items` kosong **dan** `pattern` kosong
8. Ada `hoax_roundup` dengan item tanpa `url`
9. Kartu meta (`gap`/`change`/`debate`/`misread`) lebih dari 2
10. Ada `place: "lokal"` tanpa sumber domain lokal DIY
11. `topic_id` duplikat dalam satu edisi
12. `revision > 1` tetapi `previous_edition` null
13. Ada `image.url` yang bukan `.webp`
14. `deep_dive` lebih dari 1 (nasional maupun lokal)
15. Ada `deep_dive` dengan `< 4` sumber atau `optional != true`
16. `coverage.to − coverage.from` bukan ±24 jam (harian) atau ±168 jam (mingguan)
17. `news`/`good_news` tanpa `explain`, atau jumlah pertanyaan di luar 2–4, atau pertanyaan duplikat

### 7.1 Tampilan status

Enum disimpan seperti di atas; teks yang ditampilkan berbeda.

| Enum | Tampilan | Warna |
|---|---|---|
| `terkonfirmasi` | Terkonfirmasi | hijau |
| `sebagian` | **Terkonfirmasi sebagian** | kuning |
| `belum` | Belum terkonfirmasi | abu |
| `dibantah` | Dibantah | merah |

Validator dijalankan sebelum terbit. Edisi yang gagal tidak dipublikasikan.

---

## 8. Aturan versi

| Perubahan | `schema_version` |
|---|---|
| Tambah field opsional | tetap |
| Tambah tipe kartu baru | tetap (renderer punya fallback, I3) |
| Tambah nilai enum baru | tetap |
| Hapus field, ubah tipe, ubah arti field | **naik** |
| Ubah struktur `cards[]` | **naik** |

Renderer wajib menangani `schema_version` yang lebih tinggi dengan mode aman: tampilkan hanya field yang dikenalnya.

---

## 9. Anggaran ukuran dan retensi

| Artefak | Target | Batas | Retensi |
|---|---|---|---|
| `edition.json` | 25 KB | 60 KB | 2 tahun |
| `topics/{id}.json` | 4 KB | 8 KB | 2 tahun |
| `manifest.json` | 70 KB | 120 KB | — |
| `search/hot.json` | 1,4 MB | 2 MB | 90 hari bergulir |
| `search/{YYYY}-Qn.json` | 1,4 MB | 2 MB | 2 tahun |
| `assets/` | 720 KB/hari | — | 2 tahun |

### 9.1 Gambar

- Format **WebP**, kualitas 78; lebar maksimum 1200 px.
- Target 90 KB per gambar, batas 200 KB.
- 8 gambar/hari → ± 720 KB/hari → ± 260 MB/tahun.
- Disimpan lokal, bukan hotlink, agar edisi lama tidak rusak saat sumber menghapusnya.
- Nama berkas content-addressed (`{sha1_8}.webp`) dan immutable.
- Cache ponsel: maksimum 200 MB, hapus berdasarkan edisi tertua.

**Pemangkasan 12 bulan.** Gambar yang lebih tua dari 365 hari dihapus dari repo. Kartu tidak menjadi `null`; ia memakai **gambar fallback per kategori**:

```
/assets/fallback/{category}.webp     policy economy safety health culture crime disaster sport
/assets/fallback/default.webp
```

Sembilan berkas statis, masing-masing ≤ 20 KB. Kartu menandai `image.fallback: true` sehingga renderer dapat memperlakukannya berbeda (tanpa atribusi, boleh diberi overlay). Edisi lama tetap terbaca dan tetap terlihat disengaja, bukan rusak.

### 9.2 Retensi 2 tahun

Setelah 2 tahun, edisi tertua dihapus dari `manifest.json` dan `search/`, tetapi berkas `editions/` dan `assets/` boleh tetap disimpan di host (biaya penyimpanan kecil, dan menghapusnya tidak memberi manfaat).

---

## 10. State sisi aplikasi (IndexedDB)

Empat object store. Tidak ada di dalam edisi; murni lokal.

```ts
// 1. Simpanan pengguna
saved_topics: { topic_id: string; saved_at: string; note?: string }

// 2. Posisi baca — inti Model A
read_state: {
  topic_id: string;
  last_revision_seen: number;
  last_edition_id: string;
  was_opened: boolean;        // kartu benar-benar dibuka, bukan hanya tampil
  seen_at: string;
}

// 3. Cache edisi
editions_cache: { edition_id: string; fetched_at: string; payload: Edition }

// 4. Cache topik (kunci: topic_id + last_updated)
topics_cache: { topic_id: string; last_updated: string; payload: Topic }
```

**Alur render kartu (D2):**

```
1. render kartu dari editions_cache        → langsung tampil
2. fetch topics/{topic_id}.json            → 8 request paralel, ±4 KB masing-masing
3. simpan ke topics_cache                  → kunci topic_id + last_updated
4. jika last_updated sama dengan cache     → tidak ada request
```

**Invarian:** `read_state` tidak pernah dikirim ke mana pun. Tidak ada telemetri.

---

## 11. Notifikasi (Model A)

Pipeline mengirim **satu** push per hari dengan payload generik:

```jsonc
{
  "edition_id": "2026-11-10",
  "title": "Edisi 10 Nov siap",
  "body": "8 kartu · 2 pembaruan",
  "updates": 2,
  "url": "/?e=2026-11-10"
}
```

`updates` dihitung pipeline sebagai jumlah kartu dengan `changes.length > 0`. Pipeline tidak tahu dan tidak perlu tahu apa yang sudah dibaca.

Aplikasi yang memutuskan apakah pembaruan itu relevan:

```ts
function followUps(edition: Edition, state: Map<string, ReadState>): Card[] {
  return edition.cards.filter(c => {
    const s = state.get(c.topic_id);
    if (!s) return false;                       // belum pernah dilihat
    if (c.revision <= s.last_revision_seen) return false;
    return s.was_opened || savedTopics.has(c.topic_id);
  });
}
```

Hasilnya ditampilkan di atas edisi sebagai strip "Sejak terakhir kamu baca".

**Batas platform yang diterima:** pada iOS, PWA tidak dapat memunculkan notifikasi tanpa push. Karena itu tidak ada notifikasi per topik. Pembaruan selalu menumpang edisi harian.

---

## 12. Keputusan: satu ponsel, tanpa cadangan (v1)

**Diputuskan 10 November 2026.** Aplikasi hanya dipakai di satu ponsel. Tidak ada akun, tidak ada sinkronisasi, dan **tidak ada ekspor manual** di v1.

| Hal | Akibat |
|---|---|
| `read_state` | Hidup hanya di IndexedDB ponsel |
| `saved_topics` | Sama |
| Ganti ponsel / hapus aplikasi | Riwayat baca dan simpanan **hilang** |
| Notifikasi per topik | Tidak ada (batas iOS, §11) |

**Risiko yang diterima secara sadar:** sampai sinkronisasi dibangun, kehilangan ponsel berarti kehilangan riwayat. Untuk alat pribadi dengan riwayat beberapa bulan, biaya ini dianggap lebih kecil daripada biaya membangun lapisan ekspor yang akan digantikan.

### 12.1 Rencana pengganti: sinkronisasi

Sinkronisasi akan menjadi jalur durabilitas, bukan ekspor berkas. Yang perlu ditambahkan saat itu:

| Komponen | Isi |
|---|---|
| Tabel `read_state`, `saved_topics` | Di backend |
| Autentikasi | Satu pengguna, kunci sederhana |
| Resolusi konflik | `last_revision_seen` = maksimum; `saved_at` = paling awal |
| Langganan push | Hanya jika notifikasi per topik diinginkan |

**Yang tidak berubah:** skema `edition.json`, `topics/`, `search/`, dan seluruh logika `changes[]`. Sinkronisasi hanya menambah lapisan state pengguna.

---

## 13. Contoh edisi minimal

```jsonc
{
  "schema_version": 1,
  "edition_id": "2026-11-10",
  "scope": "nasional",
  "published_at": "2026-11-11T05:45:00+07:00",
  "coverage": { "from": "2026-11-10T05:00:00+07:00", "to": "2026-11-11T05:00:00+07:00" },
  "generated_at": "2026-11-10T05:52:13+07:00",
  "locale": "id-ID",
  "place": { "kabupaten": "Sleman", "province": "DI Yogyakarta" },
  "reading_time_min": 3,
  "card_count": 6,
  "truncated_reason": "Hanya 6 topik lolos ambang hari ini",
  "cards": [
    {
      "id": "c1",
      "type": "news",
      "topic_id": "t_gibran_hmp",
      "angle": "50 anggota DPR menandatangani usulan",
      "kicker": "Nasional",
      "title": "DPR: 50 anggota teken Hak Menyatakan Pendapat",
      "status": "sebagian",
      "body": [
        "Mardani Ali Sera mengonfirmasi 50 anggota DPR menandatangani usulan HMP terkait polemik ijazah Wapres Gibran.",
        "Puan Maharani menyatakan dokumen sudah diterima dan akan ditindaklanjuti setelah paripurna."
      ],
      "explain": [
        {
          "q": "Apa itu HMP?",
          "a": "Hak Menyatakan Pendapat adalah hak konstitusional DPR (Pasal 20A UUD 1945) untuk menyatakan pendapat atas kebijakan pemerintah atau peristiwa luar biasa.",
          "source": { "outlet": "DPR RI", "url": "https://www.dpr.go.id/" }
        },
        {
          "q": "Siapa Puan Maharani?",
          "a": "Ketua DPR RI periode 2024–2029, politikus PDI-P, dan putri Megawati Soekarnoputri.",
          "source": { "outlet": "DPR RI", "url": "https://www.dpr.go.id/" }
        }
      ],
      "action": "Kalau ada yang bilang 'Gibran sudah dimakzulkan', itu belum terjadi.",
      "image": { "url": "/assets/a1b2c3.webp", "credit": "ANTARA", "alt": "Rapat paripurna DPR" },
      "sources": [
        {
          "outlet": "detik.com",
          "url": "https://news.detik.com/berita/d-8746364/...",
          "published_at": "2026-11-10T12:34:00+07:00",
          "tier": 2,
          "accessed_at": "2026-11-10T05:40:00+07:00"
        }
      ],
      "place": "nasional",
      "revision": 2,
      "first_seen": "2026-11-09",
      "previous_edition": "2026-11-09",
      "changes": [
        {
          "field": "number",
          "from": 25,
          "to": 50,
          "at": "2026-11-10T12:34:00+07:00",
          "basis": { "outlet": "detik.com", "url": "https://news.detik.com/berita/d-8746364/..." }
        }
      ]
    },
    {
      "id": "c2",
      "type": "change",
      "topic_id": "t_pajero_gejayan",
      "angle": "Polisi menyebut pengemudi sebagai korban",
      "kicker": "Sleman",
      "title": "Pemuda Pajero: dari 'Bang Jago' jadi korban",
      "status": "sebagian",
      "body": ["Polisi menyebut pengemudi Pajero sebagai korban dugaan penganiayaan, bukan pelaku."],
      "action": "Kalau video ini masuk grup keluarga, sebutkan konteksnya.",
      "image": null,
      "sources": [ /* … */ ],
      "revision": 2,
      "first_seen": "2026-11-09",
      "previous_edition": "2026-11-09",
      "changes": [
        { "field": "label", "from": "Bang Jago", "to": "Korban", "at": "2026-11-10T12:36:00+07:00",
          "basis": { "outlet": "detik.com", "url": "https://..." } }
      ],
      "before": { "at": "2026-11-09T19:36:00+07:00", "label": "Bang Jago",
                  "quote": "Bang Jago Dihajar Warga", "source": { "outlet": "detik.com", "url": "https://..." } },
      "after": { "at": "2026-11-10T12:36:00+07:00", "label": "Korban",
                 "quote": "Korban… mahasiswa asal Tebo", "source": { "outlet": "detik.com", "url": "https://..." } },
      "what_changed": "Label pelaku → korban; identitas: preman → mahasiswa",
      "what_unknown": "Klaim 'mabuk' masih keterangan warga"
    },
    {
      "id": "c3",
      "type": "hoax_roundup",
      "topic_id": "t_hoaks_2026_11_10",
      "angle": "Sepuluh fact-check, semuanya politik",
      "kicker": "Kabar beredar",
      "title": "Sepuluh fact-check, semuanya politik",
      "status": "dibantah",
      "body": ["Tiga dari sepuluh adalah rekaman lama yang diberi tanggal baru."],
      "action": "Balas dengan tautan TurnBackHoax-nya; jangan debat isinya.",
      "image": null,
      "sources": [ { "outlet": "turnbackhoax.id", "url": "https://turnbackhoax.id/", "published_at": null, "tier": 2, "accessed_at": "2026-11-10T05:45:00+07:00" } ],
      "revision": 1,
      "first_seen": "2026-11-10",
      "previous_edition": null,
      "changes": [],
      "items": [
        {
          "claim": "Rekaman suara Prabowo hasil penyadapan",
          "verdict": "salah",
          "reason": "Potongan wawancara tvOne 15 Sep 2014, menit 05.14–06.55",
          "outlet": "turnbackhoax.id",
          "url": "https://turnbackhoax.id/articles/37415-..."
        }
      ],
      "pattern": "Tiga dari sepuluh fact-check hari ini adalah rekaman lama yang diberi tanggal baru."
    }
  ]
}
```

---

## 14. Deliverable yang menyertai skema ini

| # | Berkas | Fungsi |
|---|---|---|
| S1 | `schema/edition.schema.json` | JSON Schema untuk validasi mesin |
| S2 | `scripts/validate.mjs` | Dijalankan sebelum terbit; menolak edisi tidak valid |
| S3 | `schema/types.ts` | Tipe TypeScript bersama, dipakai pipeline dan aplikasi |
| S4 | `fixtures/` | 3 edisi contoh untuk uji renderer |

`S3` adalah yang mencegah pipeline dan aplikasi menyimpang tanpa terlihat.

---

## 15. Keputusan

| # | Pertanyaan | Status | Keputusan |
|---|---|---|---|
| D1 | Lintas perangkat? | **selesai** | Tidak ada di v1; sinkronisasi menyusul (§12) |
| D2 | Kapan `topics/` diambil? | **selesai** | Saat kartu dirender, 8 request paralel, cache `topic_id + last_updated` (§10) |
| D3 | Retensi edisi? | **selesai** | 2 tahun; arsip dipisah per kuartal (§6, §9.2) |
| D4 | Format gambar? | **selesai** | WebP kualitas 78, target 90 KB (§9.1) |
| D5 | Ekspor manual? | **selesai** | Tidak ada; durabilitas lewat sinkronisasi nanti (§12) |
