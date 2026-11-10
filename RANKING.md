# Desain Pemilihan — 15–20 Topik → Kartu Edisi

**Versi:** 0.1
**Status:** keputusan teknis
**Bergantung pada:** `REQUIREMENTS.md`, `SCHEMA.md`, `CLUSTERING.md`
**Tanggal:** 10 November 2026

---

## 0. Keputusan

| # | Keputusan |
|---|---|
| R1 | Dua edisi terpisah per hari: **Nasional** (8 kartu) dan **Lokal** (2–5 kartu). |
| R2 | Pemilihan kartu meta dilakukan **sebelum** ranking berita. |
| R3 | Ranking murni aritmetika + aturan. **Tanpa LLM.** |
| R4 | `category`, `significance`, `heavy` diisi LLM saat adjudikasi, bisa ditimpa lewat `overrides.yaml`, dan sistem mengusulkan penimpaan. |
| R5 | Edisi lokal terbit hanya jika ada **≥2** topik yang lolos. |

---

## 1. Masukan dan keluaran

```
Masukan  : Topic[] dari CLUSTERING.md §16
Keluaran : Edition.nasional (8 kartu)
           Edition.sleman   (2–5 kartu, atau null)
```

Setiap `Topic` membawa:

```jsonc
{
  "topic_id": "t_penyadapan_prabowo",
  "title": "Penyadapan Prabowo",
  "angle": "Sidang etik Irjen Ahrie Sonta",
  "kind": "ongoing",          // breaking|ongoing|analysis|utility
  "category": "safety",       // policy|safety|economy|health|culture|crime|disaster|sport
  "significance": 5,
  "heavy": false,
  "local": false,
  "horse_race": false,
  "drop": false,
  "articles": 12,
  "outlets": 5,
  "tier1": true,
  "first_seen_at": "2026-11-09T11:04:00+07:00",
  "revision": 4,
  "changes": [ /* Change[] */ ],
  "amplification": { "reddit": 300, "detik_comments": 30, "trend": 200, "tiktok_delta": null }
}
```

---

## 2. Urutan operasi

```
1. Filter keras
2. Hitung kandidat meta
3. Pilih maks 2 meta            ← sebelum ranking berita
4. Pilih 1 deep dive            ← sebelum ranking berita
5. Keluarkan topik meta & deep dive dari pool berita
6. Ranking berita → isi slot
7. Terapkan batas kategori & anggaran suasana hati
8. Rakit 8 kartu
```

Langkah 3 dan 4 harus mendahului 6. Pada 10 November, topik vape adalah berita peringkat 4 **dan** kandidat "Yang Salah Dipahami", sementara topik beras adalah berita peringkat 3 **dan** kandidat deep dive. Kalau berita diranking lebih dulu, keduanya muncul dua kali.

---

## 3. Filter keras

| Buang jika | Alasan |
|---|---|
| `horse_race = true` | Aturan E8 |
| `drop = true` | Iklan, SEO filler, rilis tanpa substansi |
| `articles < 3` **dan** `outlets < 2` | Orphan |
| `>72 jam` tanpa `angle` baru | Basi |
| `kind = "analysis"` dan `outlets = 1` | Opini tunggal |

### 3.1 Edisi lokal (Sleman)

Edisi lokal punya aturan sendiri karena korpusnya berbeda: peristiwa
kecamatan sering diliput **satu media** dan sering didominasi satu tema.

| Aturan | Nilai |
|---|---|
| Sumber | Media DIY (`detik.com/jogja`, `jogja.tribunnews.com`, `harianjogja.com`, `krjogja.com`, …) |
| Penanda lokal | Judul/lead menyebut Sleman, Yogyakarta/Jogja, DIY, Bantul, Kulon Progo, Gunungkidul, atau lembaga lokal (`Polresta Yogyakarta`, `Dinkes Sleman`, UGM) |
| Minimal artikel | **1** — brief satu media tetap terbit |
| Maksimal kartu | 4 |
| Kategori | **1 kartu per kategori** (variasi), dilonggarkan ke 3 hanya bila hasilnya < 2 kartu |
| Heavy | Maksimal 1 (kriminal, bencana, keselamatan) |
| Junk | Advertorial, promo, jadwal siaran, resep, lowongan dibuang |
| Duplikasi nasional | Topik yang sudah dipakai edisi lokal dikeluarkan dari edisi nasional hari itu |

Kicker tiap kartu memakai wilayah sebenarnya (`Sleman`, `Gunungkidul`,
`Bantul`, `Kulon Progo`, `Yogyakarta`), bukan "Sleman" untuk semua.

Berita lokal yang tidak menyebut wilayahnya sama sekali (mis. media Jogja
meliput Gibran) tetap dianggap berita nasional.

---

## 4. Skor berita

### 4.1 Nasional

```
score = 0.30 × coverage
      + 0.25 × significance_n
      + 0.20 × recency
      + 0.15 × tier1
      + 0.10 × amplification
```

```
coverage        = min(1, log(1 + articles) / log(21))
significance_n  = (significance − 1) / 4
recency         = max(0, 1 − jam_sejak_terbit / 48)
tier1           = 1 jika ada sumber tier 1, selain itu 0
amplification   = min(1, (reddit + 2×detik_comments + trend) / 800)
```

Amplifikasi dibatasi 10% dengan sengaja. Reddit tidak representatif; ia boleh mendorong, bukan menentukan.

### 4.2 Lokal

```
score = 0.30 × coverage
      + 0.25 × significance_n
      + 0.20 × recency
      + 0.15 × utility
      + 0.10 × tier1
```

```
utility = 1.0 jika kind = "utility" (lalu lintas, cuaca, lowongan, layanan publik)
          0.5 jika kind = "breaking"
          0.0 selainnya
```

Skor lokal memberi tempat lebih besar pada **kegunaan** daripada drama. Berita Sleman didominasi kecelakaan dan kriminal; tanpa bobot ini edisi lokal akan terasa seperti berita polisi.

---

## 5. Batas setelah ranking

### 5.1 Nasional

| Batas | Nilai |
|---|---|
| Maks kartu per `category` | 2 |
| Maks `heavy` | 2 dari 8 |
| Minimal 1 kartu non-politik | dari 4–6 slot berita |
| Topik yang kemarin di posisi 1–2 dan `changes` kosong | turun 2 peringkat |

### 5.2 Lokal

| Batas | Nilai |
|---|---|
| Maks `heavy` | **1** dari maks 5 |
| Minimal 1 `kind: utility` | jika tersedia |
| Maks 1 topik per `category` | ya |

Batas `heavy` lokal lebih ketat karena proporsi berita kriminal di media lokal jauh lebih tinggi. Dua kartu berat di edisi lima kartu akan menghapus seluruh nilai edisi itu.

### 5.3 Aturan anti-pengulangan

```
jika topic ada di edisi kemarin pada posisi ≤2
   dan changes.length = 0
   maka score -= 0.15
```

Tanpa ini, satu saga berjalan menempati slot 1 selama seminggu dan brief berubah menjadi berita yang justru ingin kamu hindari.

---

## 6. Kartu meta

### 6.1 Kandidat dan ambang

| Tipe | Syarat | Skor dasar |
|---|---|---|
| `change` | `changes[]` ≥1 dengan `basis` | 1.0 |
| `gap` | `\|gap_rank\| ≥ 5` dan ≥2 sumber independen | 0.8 |
| `misread` | ada `trigger` + sumber penjelas | 0.6 |
| `debate` | komentar detik ≥15 **atau** reddit ≥200 | 0.5 |

Skor akhir: `skor_dasar × (0.7 + 0.3 × significance_n)`.

### 6.2 Ketersediaan per edisi

| Tipe | Nasional | Lokal |
|---|---|---|
| `change` | ✅ | ✅ |
| `debate` | ✅ | ✅ |
| `gap` | ✅ | ❌ |
| `misread` | ✅ | ❌ |

`gap` lokal tidak diukur: dengan tiga feed, ketiadaan liputan tidak bisa dibedakan dari kegagalan pemantauan. `misread` lokal hampir selalu hanya mengulang rilis polisi.

### 6.3 Aturan

1. Ambil maksimum **2** kandidat nasional, **1** kandidat lokal.
2. Topik yang menjadi kartu meta **dikeluarkan** dari pool berita.
3. Jika tidak ada yang lolos, `meta_count = 0` dan slot berita bertambah.

### 6.4 Deep dive — Mendalam

Satu per edisi nasional. Berbeda dari semua kartu lain: **bukan dari siklus harian.**

**Kolam kandidat:** topik dengan `first_seen` antara 7 dan 30 hari lalu, yang masih punya sumber baru dalam 7 hari terakhir. Topik yang sudah pernah jadi deep dive dalam 14 hari terakhir dikeluarkan.

**Syarat:**

| Syarat | Nilai |
|---|---|
| Sumber berbeda | ≥ 5 |
| Rentang waktu sumber | ≥ 7 hari |
| Paragraf yang bisa ditulis | ≥ 3 |
| Tidak sedang jadi kartu meta atau berita hari ini | wajib |

**Skor:**

```
deep_score = 0.5 × significance_rata_rata
           + 0.3 × min(1, sumber / 10)
           + 0.2 × kebaruan_mingguan
```

`kebaruan_mingguan` = 1 jika ada sumber baru dalam 3 hari terakhir, 0,5 jika dalam 7 hari, 0 jika lebih.

**Implementasi (`scripts/build.ts`):**

- Klaster dibentuk ulang dengan jendela 7 hari (`maxGapHours: 168`), bukan jendela 24 jam.
- Syarat: ≥5 artikel, ≥3 media, bukan klaster lokal.
- Topik yang sudah dipakai kartu berita hari itu dilewati, begitu juga yang pernah jadi deep dive dalam 14 hari terakhir (dibaca dari edisi di `data/editions/`).
- Kartu ditulis LLM bila tersedia; jika gagal, versi deterministik dari timeline thread dipakai.

**Aturan:**

1. Hanya topik peringkat teratas yang diambil. Tidak ada dua deep dive dalam satu edisi nasional.
2. Topik yang jadi deep dive **dikeluarkan** dari pool berita.
3. Jika tidak ada kandidat yang memenuhi syarat, `deep_dive` dilewati dan `news_slots` bertambah satu. Dicatat di `run_log`.
4. Edisi lokal tidak memakai deep dive — tiga feed lokal tidak cukup untuk menghasilkan tulisan 7 menit yang berbobot.

### 6.5 Siklus hidup Yang Luput

Kartu `gap` bukan potret satu hari. Ia **watchlist** yang berjalan sampai ada yang meliput — atau sampai waktu habis.

**Masuk watchlist** saat pertama kali lolos ambang (`|gap_rank| ≥ 5`). Disimpan di tabel `gap_watch(topic_id, first_detected, first_gap, last_checked, state)`.

**Setiap hari**, sebelum perakitan:

```
coverage_now = jumlah outlet unik yang meliput topik ini
outlet_baru  = coverage_now − coverage_timeline.length

jika outlet_baru > 0:
    tambahkan entri timeline
    tambahkan changes[] { field: "scope", from: n, to: n+outlet_baru }
    state = "mulai_diliput"  (jika coverage_now < 3)

jika coverage_now ≥ 3  dalam 7 hari pertama:
    state = "ditutup", alasan = "diliput"

jika days_watched ≥ 14 dan coverage_now < 3:
    state = "ditutup", alasan = "tidak_pernah_diliput"
```

**Kapan tampil di edisi:**

| Momen | Tampil | Bentuk |
|---|---|---|
| Hari pertama terdeteksi | ya | `gap` — angka 0 media |
| Ada outlet baru | ya | `gap` — `Diliput 0 → 1` |
| Hanya berjalan, tanpa liputan | **tidak** | tetap di watchlist, tidak di edisi |
| Ditutup karena diliput | ya, sekali | `change` — "Akhirnya diliput", dengan outlet pertama dan tanggalnya |
| Ditutup karena 14 hari | ya, sekali | `gap` — "Tetap tidak diliput setelah 14 hari" |

**Batas pengulangan:** maksimum 3 kemunculan per topik dalam 14 hari. Tanpa batas ini, satu celah liputan yang tidak pernah ditutup akan muncul setiap hari selama dua minggu — persis kebalikan dari produk ini.

**Penutupan karena "tidak pernah diliput" adalah temuan, bukan kegagalan.** Kalimatnya harus netral: *"14 hari, nol liputan dari 12 media yang dipantau."* Bukan *"media mengabaikan"*.

---

## 7. Perakitan

### 7.1 Nasional — selalu 8 kartu

```
news_slots = 5 − meta_count        (6 jika deep_dive dilewati)
total      = news_slots + deep_dive + 1 (hoax) + 1 (baik) + meta_count = 8
```

| `meta_count` | Berita | Mendalam | Hoax | Baik | Meta | Total |
|---|---|---|---|---|---|---|
| 0 | 5 | 1 | 1 | 1 | 0 | 8 |
| 1 | 4 | 1 | 1 | 1 | 1 | 8 |
| 2 | 3 | 1 | 1 | 1 | 2 | 8 |

Estimasi waktu baca **tidak menghitung** `deep_dive`, karena kartu itu bertanda `optional: true`. Header aplikasi menulis `±5 menit + 1 bacaan panjang`.

### 7.2 Lokal — 2 sampai 5 kartu

```
kartu = news_lokal + meta_lokal (0..1) + good_news (0..1)
terbit jika kartu ≥ 2
```

| Kondisi | Hasil |
|---|---|
| 5 topik lolos, ada 1 meta | 5 kartu (3 berita + 1 meta + 1 baik) |
| 3 topik lolos, tanpa meta | 3 kartu |
| 1 topik lolos | **tidak terbit** (`local: null` di manifest) |

### 7.3 `good_news`

Hanya dari kategori **budaya** atau **kesehatan**. Laba perusahaan, pertumbuhan ekonomi, atau rilis institusi bukan "hal baik" — menaruhnya di slot ini membuat kartu terasa seperti PR.

Jika tidak ada kandidat yang lolos, slot dilewati. Edisi 7 kartu lebih baik daripada satu kartu yang salah label.

### 7.3.1 `good_news` lokal

Wajib dicoba setiap hari. Sumber: program yang berjalan, layanan baru, perbaikan infrastruktur, rumor lokal yang terbukti salah. Jika tidak ada, `good_news` lokal dilewati dan jumlah kartu berkurang — bukan diisi paksa.

---

## 8. `category`, `significance`, `heavy`

### 8.1 Asal nilai

Diisi LLM pada panggilan adjudikasi (`CLUSTERING.md` §7.2). Tidak ada panggilan tambahan.

### 8.2 `overrides.yaml`

```yaml
# Manusia yang mengedit. Berlaku sebelum ranking.
category:
  - match: "loker|lowongan|rekrutmen|job fair"
    set: { category: utility, significance: 2, heavy: false }

heavy:
  - match: "pembunuhan|penganiayaan|tewas|korban jiwa"
    set: { heavy: true }

significance:
  - match: "bmkg|cuaca ekstrem|peringatan dini|gempa|merapi"
    set: { significance: 4 }

exclude:
  - match: "ucapan selamat|twibbon|link streaming|jadwal siaran"
```

Aturan:

1. `match` adalah regex, diuji terhadap `title + angle` huruf kecil.
2. Aturan pertama yang cocok menang.
3. `exclude` setara dengan `drop = true`.
4. Berkas di-hash dan hash dicatat di `run_log`, sama seperti `aliases.yaml`.

### 8.3 Usulan penimpaan

Sistem menghasilkan usulan, bukan menerapkan.

| Deteksi | Usulan |
|---|---|
| `heavy = false` tapi judul memuat kata kriminal dan `tier1 = false` | `heavy: true` |
| `significance = 5` tapi `outlets ≤ 1` | turunkan ke 3 |
| `significance ≤ 2` tapi topik dibuka ≥80% dalam 30 hari | naikkan 2 |
| Satu kategori dilewati ≥5× berturut-turut | turunkan bobot kategori |
| `category = crime` tapi isinya kebijakan (mis. vonis, regulasi) | ganti ke `policy` |

Disimpan di `overrides.pending`, skor 0–1, maksimum 10 usulan/hari. Hanya bagian `active` yang berlaku.

---

## 9. Diagnostik

Setiap edisi menyimpan alasan pemilihan. Tanpa ini, "kenapa berita ini tidak masuk" tidak bisa dijawab.

```jsonc
{
  "ranking_debug": {
    "topics_considered": 17,
    "filtered": { "horse_race": 3, "drop": 4, "orphan": 2, "stale": 1 },
    "meta_selected": ["t_raffi_buzzer", "t_vape_mui"],
    "news_selected": ["t_gibran_hmp", "t_penyadapan_prabowo", "t_beras", "t_investasi_bodong"],
    "excluded_by_budget": ["t_kriminal_jaksel"],
    "scores": { "t_gibran_hmp": 0.81, "t_penyadapan_prabowo": 0.78 }
  }
}
```

Disimpan di `run_log`, **tidak** dikirim ke aplikasi.

### 9.1 Metrik kesehatan

| Metrik | Target |
|---|---|
| Slot terisi penuh (nasional) | 8/8 |
| `meta_count` | 1–2 paling sering |
| Edisi lokal terbit | ≥5 dari 7 hari |
| Topik yang sama di slot 1 berturut-turut | ≤3 hari |
| `excluded_by_budget` | ≤1/hari |

Jika `meta_count = 2` muncul lebih dari 4 hari berturut-turut, ambang §6.1 terlalu longgar.

---

## 10. Contoh — 10 November 2026

**Kandidat (17) → setelah filter (11):**

| Topik | category | sig | heavy | Cakupan | Skor |
|---|---|---|---|---|---|
| Gibran HMP | policy | 5 | false | 12 art / 5 outlet | 0.81 |
| Penyadapan | safety | 5 | false | 10 / 5 | 0.78 |
| Beras | economy | 4 | false | 8 / 4 | 0.69 |
| Investasi bodong | economy | 3 | false | 4 / 2 | 0.55 |
| Raffi/buzzer | policy | 4 | false | 0 / 0 | — → meta `gap` |
| Vape | health | 3 | false | 6 / 4 | — → meta `misread` |

**Meta terpilih:** `gap` (Raffi, skor 0.94) dan `misread` (vape, 0.72) → `meta_count = 2`
**Kartu berita:** 4 → Gibran, Penyadapan, Beras, Investasi bodong
**Total:** 4 + hoax + baik + 2 meta = **8**

**Edisi lokal:** Pajero (change), Babarsari, Demo DPRD, Job Fair → 4 kartu, 1 heavy (Pajero).

---

## 11. Yang belum diputuskan

| # | Pertanyaan | Dampak |
|---|---|---|
| R6 | Bobot `category` yang dilewati — dipakai untuk menurunkan skor atau hanya untuk usulan? | Personalisasi |
| R7 | Apakah edisi lokal memakai `overrides.yaml` yang sama atau berkas terpisah? | Kemudahan edit |
| R8 | Apakah `good_news` boleh berasal dari topik yang sudah dipakai sebagai `change`? | Duplikasi |
