# Desain Klastering — Topik, Alias, dan ID Stabil

**Versi:** 0.1
**Status:** keputusan teknis
**Bergantung pada:** `REQUIREMENTS.md` v0.1, `SCHEMA.md` v0.2
**Tanggal:** 10 November 2026

---

## 0. Keputusan yang sudah diambil

| # | Keputusan |
|---|---|
| K1 | `topic_id` bersifat **thread-level**, bukan story-level. Kartu membawa `angle` sebagai irisan harian. |
| K2 | Adjudikasi memakai **satu panggilan LLM per hari** atas 15–30 kandidat klaster, bukan atas seluruh artikel. |
| K3 | Alias **tidak diisi manual di awal**. Sistem mengusulkan, pengguna menyetujui bertahap. |
| K4 | Reddit **tidak pernah** menjadi asal topik. Hanya menempel sebagai bukti amplifikasi. |
| K5 | Semua state hidup di SQLite. `edition.json` adalah turunan, bukan sumber kebenaran. |

---

## 1. Definisi

| Istilah | Arti | Contoh |
|---|---|---|
| **Artikel** | Satu item RSS setelah normalisasi | "50 Anggota DPR Teken HMP" |
| **Klaster** | Grup artikel yang membahas kejadian yang sama pada satu hari | 7 artikel soal penandatanganan HMP |
| **Topik** | Thread yang bertahan lintas hari | `t_penyadapan_prabowo` |
| **Angle** | Irisan harian dari sebuah topik | "Sidang etik Irjen Ahrie Sonta" |
| **Alias** | Nama permukaan lain untuk entitas/topik yang sama | `pakde` → `jokowi` |

Topik tidak pernah dihapus. Topik yang keliru digabung ditandai `merged_into`, tidak di-rename.

---

## 2. Alur

```
1.000 artikel
    │
    ├─ 1. Normalisasi            → teks bersih, entitas, angka, waktu
    ├─ 2. Dedupe sindikasi       → ~400 unik
    ├─ 3. Blok kandidat          → 15–30 blok
    ├─ 4. Klaster harian         → 15–30 klaster
    ├─ 5. Adjudikasi LLM (1×)    → 8–20 topik harian
    ├─ 6. Resolusi registry      → 6–10 topik aktif, ID stabil
    ├─ 7. Diff & revisi          → changes[]
    └─ 8. Usulan alias           → antrean untuk pengguna
```

---

## 3. Langkah 1 — Normalisasi

Untuk setiap artikel simpan **dua** representasi:

| Field | Isi | Dipakai untuk |
|---|---|---|
| `title_display` | Judul asli | Ditampilkan |
| `title_norm` | Huruf kecil, tanda baca dibuang, alias diterapkan | Perbandingan |
| `lead` | 300 karakter pertama badan berita | Embedding & verifikasi |
| `entities[]` | Hasil ekstraksi | Blocking |

**Aturan normalisasi:**

1. Terapkan alias **aktif** pada `title_norm` saja; `title_display` tidak diubah.
2. Ekspansi singkatan dari tabel alias aktif (`hmp` → `hak menyatakan pendapat`).
3. Normalisasi angka: `50-an`, `puluhan`, `50 orang` → `50` dengan flag `approx: true`.
4. Jangan stem. Bahasa Indonesia dengan imbuhan `me-`, `di-`, `-kan` rusak kalau di-stem sembarangan, dan judul berita pendek.
5. Buang boilerplate: "Baca juga:", "Simak:", "Video:", nama media di akhir judul.
6. **Buang artikel di luar jendela 36 jam.** Feed membawa arsip: Tirto memuat 7 hari, Tempo berbulan-bulan. Tanpa filter ini, satu feed bisa menyumbang 50% korpus dan merusak IDF.

---

## 4. Langkah 2 — Dedupe sindikasi

Antara menerbitkan satu berita, lima outlet menyalin. Tanpa dedupe, `coverage.article_count` menggelembung dan klaster terlihat lebih penting dari kenyataan.

**Metode:** SimHash 64-bit untuk penyimpanan dan bucketing, tetapi **keputusan** memakai Jaccard berbobot atas token + bigram.

```
similarity(a,b) ≥ 0,72  → duplikat
simpan sebagai is_duplicate_of = artikel_pertama
```

SimHash saja terlalu sensitif untuk judul pendek: dua judul sindikasi bisa berbeda 19 bit. Pada korpus 688 artikel (10 Nov), similarity tertinggi antar-artikel hanya **0,51** — dan itu dua artikel berbeda dari media yang sama tentang peristiwa yang sama. Ambang 0,72 memberi margin sehat: sindikasi verbatim (0,85–0,95) tertangkap, penulisan ulang peristiwa sama (0,3–0,5) tetap diklaster.

Temuan lapangan: 12 feed ini **tidak** saling menyalin verbatim (0 duplikat dari 688 artikel). Antara menyuplai, tetapi CNN/Detik/Tirto menulis ulang. Dedupe baru akan berguna saat jaringan Tribun regional ditambahkan.

Hasil yang diharapkan: 1.000 → ±400 artikel unik. Ini angka yang wajib dicatat di `run_log`; kalau rasionya berubah drastis, ada yang rusak di feed.

---

## 5. Langkah 3 — Blok kandidat

Tujuan: mengurangi perbandingan O(n²) menjadi beberapa blok kecil, tanpa LLM.

**5.1 Entity IDF**

Hitung IDF setiap entitas atas korpus bergulir 30 hari:

```
idf(e) = log(N / df(e))
```

Entitas dengan `idf < 1.5` dianggap **tidak distintif** dan dibuang dari kunci (contoh: `indonesia`, `jakarta`, `prabowo` saat sedang jadi berita tiap hari). Ini yang mencegah semua berita politik menempel jadi satu.

**Syarat kedua: `df ≥ 2`.** Entitas yang muncul di satu artikel tidak bisa membuat blok (blocking butuh co-occurrence ≥2), tetapi kalau ikut dihitung ia merusak Jaccard berbobot: satu artikel bisa membawa lima singleton ber-IDF maksimum dan menekan J untuk cerita yang sama menjadi ~0,11. Karena itu `df` disimpan di tabel `entities` (migrasi `002_entity_df.sql`) dan bobot dibatasi `min(idf, 4)`.

**5.2 Blocking key**

```
blok = pasangan entitas distintif yang muncul bersama
       di ≥2 artikel dalam jendela 48 jam
```

**5.3 Batas**

- Maksimum 6 entitas distintif per artikel (ambil bobot tertinggi).
- Artikel tanpa entitas distintif → masuk blok `_fallback`, dicocokkan hanya lewat embedding.
- Maksimum 60 blok per hari. Kalau lebih, naikkan ambang IDF dan catat di `run_log`.

---

## 6. Langkah 4 — Klaster harian

**Gerbang bukti.** Sebelum skor dihitung, tiga syarat harus lolos:

```
|Δt|  ≤ 72 jam
shared ≥ 2 entitas distintif        (kecuali C ≥ 0,55 — sindikasi teks)
```

Gerbang ini lahir dari kegagalan nyata: dua berita Turki yang tidak berhubungan mendapat `J = 1,00` dan `C = 0,04`, lalu digabung. Jaccard atas himpunan entitas bernilai 1,0 ketika kedua artikel hanya punya **satu** entitas yang sama. Jumlah entitas bersama adalah bukti; skor hanyalah cara mengurutkan.

**Skor** (setelah gerbang lolos):

```
sim(a,b) = 0,6 × J_entity + 0,4 × C_teks
```

| Istilah | Isi |
|---|---|
| `J_entity` | Jaccard berbobot IDF atas entitas distintif (`df ≥ 2`, bobot `min(idf,4)`) |
| `C_teks` | Kemiripan leksikal `title_norm + lead` — pengganti sementara `C_embedding` sampai M4 |

**Ambang:** gabung jika `sim ≥ 0,30`.

Bobot dan ambang ini dikalibrasi pada korpus 679 artikel (10 Nov): 14 klaster, 74 artikel terklaster, klaster teratas 25 artikel / 5 outlet. Angka ini **wajib dikalibrasi ulang** begitu embedding masuk — `C` akan berubah arti, dan ambangnya ikut berubah.

**Aturan penopang:**

- Single-linkage dengan batas: satu klaster maksimum 25 artikel.
- Klaster harus punya ≥3 artikel **atau** ≥2 outlet independen. Selain itu → `orphan`, tidak masuk adjudikasi tetapi tetap disimpan.
- Klaster yang seluruhnya dari satu domain → turunkan prioritas (kemungkinan sindikasi yang lolos dedupe).

---

### 6.1 Brief lokal (singleton)

Setelah klaster utama terbentuk, artikel dari media DIY yang **tidak masuk
klaster mana pun** diklaster ulang dengan `includeSingletons: true`,
`minArticles: 1`, `minOutlets: 1`. Hasilnya disaring lagi: harus punya
penanda wilayah (Sleman/DIY) dan bukan rubrik junk.

Tanpa langkah ini edisi Sleman tidak pernah terbit: semua berita kecamatan
adalah singleton, dan klaster utama membuang singleton.

### 6.2 Gabung topik kembar

Adjudikasi kadang memecah satu peristiwa menjadi dua topik. Sebelum registry,
pasangan topik digabung bila:

| Sinyal | Ambang nasional | Ambang lokal |
|---|---|---|
| Kemiripan judul + angle | ≥ 0,40 | ≥ 0,28 |
| Judul artikel paling mirip | ≥ 0,55 | ≥ 0,45 |
| Jaccard entitas **dan** kemiripan judul | ≥ 0,50 / ≥ 0,18 | ≥ 0,40 / ≥ 0,14 |

Topik lokal dan nasional tidak pernah digabung. Klaster ikut digabung, jadi
writer melihat seluruh artikel dari kedua sisi peristiwa.

---

## 7. Langkah 5 — Adjudikasi LLM (satu panggilan)

### 7.1 Input

Ringkas, bukan teks penuh. 30 klaster × ±80 token.

```jsonc
{
  "date": "2026-11-10",
  "place": "Sleman",
  "clusters": [
    {
      "cid": "c01",
      "n_articles": 7,
      "outlets": ["detik.com", "kompas.com", "cnnindonesia.com", "tirto.id"],
      "entities": ["gibran", "dpr", "hmp", "ijazah"],
      "titles": [
        "50 Anggota DPR Teken Hak Menyatakan Pendapat",
        "Puluhan Legislator Teken HMP soal Ijazah Gibran",
        "Puan Janji Proses Usulan HMP"
      ],
      "ambiguous": false
    }
  ]
}
```

### 7.2 Output

```jsonc
{
  "topics": [
    {
      "cid": ["c01", "c07"],
      "title": "HMP soal ijazah Gibran",
      "angle": "50 anggota DPR menandatangani usulan",
      "kind": "ongoing",
      "entities": ["gibran", "dpr", "hmp"],
      "local": false,
      "horse_race": false,
      "drop": false,
      "category": "policy",
      "significance": 5,
      "heavy": false,
      "reason": null
    }
  ]
}
```

| Field | Aturan |
|---|---|
| `cid` | Gabungan satu atau lebih klaster; wajib |
| `title` | 3–6 kata, Bahasa Indonesia, tanpa klikbait |
| `angle` | ≤ 90 karakter, kejadian hari ini |
| `kind` | `breaking` \| `ongoing` \| `analysis` \| `utility` |
| `local` | `true` jika menyangkut Sleman/DIY |
| `horse_race` | `true` untuk elektabilitas, manuver partai, peluang |
| `drop` | `true` untuk iklan, SEO filler, siaran pers tanpa substansi |

### 7.3 Aturan

- Output divalidasi terhadap JSON Schema. Gagal → satu retry dengan pesan kesalahan.
- Gagal dua kali → jatuh ke mode deterministik: klaster dipakai apa adanya dengan judul dari artikel terbanyak. Dicatat sebagai `llm_fallback: true`.
- `cid` yang tidak muncul di output dianggap `drop`.
- `cid` ganda di dua topik → ambil yang pertama, catat konflik.

---

## 8. Langkah 6 — Resolusi registry

Ini tempat ID stabil ditentukan. **Bukan pekerjaan LLM secara default.**

Jendela: topik aktif 14 hari terakhir.

**Catatan kalibrasi:** ambang di bawah diturunkan dari `C` yang masih **leksikal** (belum embedding). Saat embedding masuk, `C` berubah arti dan ambang ini wajib dihitung ulang. Diuji pada data nyata: dua run berurutan menghasilkan 14 topik dengan ID identik dan revisi naik ke 2.

```
untuk setiap topik harian T:
  kandidat = topik registry dengan ≥1 entitas sama

  jika ada kandidat dengan
       J ≥ 0,50   ATAU   (J ≥ 0,30 DAN C ≥ 0,40)
    → auto-match, topic_id dipertahankan

  selain itu, jika ada kandidat dengan
       J ≥ 0,35  ATAU  C ≥ 0,70
    → LLM konfirmasi (maks 5 per run)

  jika tidak ada
    → topic_id baru
```

**LLM konfirmasi** menerima dua ringkasan (judul kanonik, angle, 5 entitas, tanggal) dan menjawab `same` / `different` / `unclear`. `unclear` diperlakukan sebagai `different` — lebih baik topik terpecah daripada dua cerita berbeda digabung, karena penggabungan merusak `changes[]` secara diam-diam.

**Alias topik.** Saat match terjadi, simpan nama permukaan baru:

```
topic_aliases(topic_id, alias, source='observed')
```

Ini yang membuat judul minggu depan tetap ketemu walau kata-katanya berubah.

---

## 9. Langkah 7 — Diff dan revisi

Revisi **hanya** naik jika ada perubahan yang bisa dibuktikan.

| Field | Perubahan dianggap nyata jika |
|---|---|
| `status` | ada sumber baru yang lebih tinggi tiernya |
| `number` | angka berubah dan sumbernya bertanggal |
| `label` | kata penanda berubah (pelaku→korban, tewas→selamat) |
| `scope` | cakupan berubah (satu kota → nasional) |

Aturan keras:

1. Tanpa `basis` bertanggal → **bukan perubahan**, hanya dugaan. Tidak masuk `changes[]`.
2. Perubahan dari tier 3 tidak boleh menurunkan status yang ditetapkan tier 1.
3. `revision` maksimum naik 1 per hari per topik. Perubahan ganda digabung.

---

## 10. Langkah 8 — Usulan alias (K3)

Pengguna tidak mengisi 200 entri di awal. Sistem mengusulkan, pengguna menyetujui.

**Sumber usulan:**

| Sumber | Contoh | Skor awal |
|---|---|---|
| Pasangan permukaan berdekatan | `pakde` muncul di artikel yang sama dengan `jokowi` 12× | 0.9 |
| Pola definisi | "Joko Widodo, yang akrab disapa Jokowi" | 0.95 |
| Singkatan dalam tanda kurung | "Hak Menyatakan Pendapat (HMP)" | 0.9 |
| Redirect Wikipedia ID | `Jokowi` → `Joko Widodo` | 0.85 |
| Near-miss registry | Dua topik dengan `J ≥ 0.5` tapi tidak match | 0.6 |
| Usulan LLM saat adjudikasi | "anggap `mbg` = `makan bergizi gratis`" | 0.7 |

**Format berkas** — manusia yang mengedit, bukan aplikasi:

```yaml
# aliases.yaml — aktif dipakai pipeline
active:
  jokowi: [Joko Widodo, Pakde Jokowi, Presiden Jokowi]
  hmp: [Hak Menyatakan Pendapat]
  mbg: [Makan Bergizi Gratis]

# diisi pipeline, dipindah ke active oleh pengguna
pending:
  - a: pakde
    b: jokowi
    score: 0.92
    evidence: "12 ko-occurrence, 3 hari"
```

**Aturan:**

1. Hanya `active` yang memengaruhi klastering. `pending` tidak pernah diterapkan otomatis.
2. Setiap perubahan `aliases.yaml` mencatat hash-nya ke `run_log`, sehingga hasil satu hari bisa direproduksi dengan gazetteer hari itu.
3. Antrean dibatasi 15 usulan/hari, diurutkan skor. Kalau lebih, sisanya ditunda.
4. Usulan yang ditolak dicatat (`rejected`) dan tidak muncul lagi selama 90 hari.

Beban pengguna: ±5–15 keputusan/hari di minggu pertama, turun ke ±2–3/hari setelahnya.

---

## 11. Skema database

```sql
articles (
  id TEXT PRIMARY KEY, url TEXT UNIQUE, outlet TEXT,
  published_at TEXT, title_display TEXT, title_norm TEXT, lead TEXT,
  simhash INTEGER, is_duplicate_of TEXT, topic_id TEXT, fetched_at TEXT
);

entities (
  id TEXT PRIMARY KEY, name TEXT, kind TEXT, idf REAL, last_seen TEXT
);

article_entities (article_id TEXT, entity_id TEXT, surface TEXT, PRIMARY KEY(article_id, entity_id));

topics (
  topic_id TEXT PRIMARY KEY, canonical_title TEXT, kind TEXT,
  first_seen TEXT, last_updated TEXT, revision INTEGER,
  merged_into TEXT, status TEXT
);

topic_aliases (topic_id TEXT, alias TEXT, source TEXT, added_at TEXT, PRIMARY KEY(topic_id, alias));

topic_entities (topic_id TEXT, entity_id TEXT, weight REAL, PRIMARY KEY(topic_id, entity_id));

revisions (
  id INTEGER PRIMARY KEY, topic_id TEXT, revision INTEGER, edition_id TEXT,
  claim_json TEXT, sources_json TEXT, created_at TEXT
);

alias_suggestions (
  id INTEGER PRIMARY KEY, a TEXT, b TEXT, score REAL, evidence TEXT,
  status TEXT, created_at TEXT, decided_at TEXT
);

run_log (
  run_id TEXT PRIMARY KEY, date TEXT, articles_in INTEGER, after_dedupe INTEGER,
  blocks INTEGER, clusters INTEGER, topics_out INTEGER, new_topics INTEGER,
  llm_calls INTEGER, llm_fallback INTEGER, aliases_hash TEXT, cost_usd REAL
);
```

---

## 12. Aturan `topic_id`

```
t_{slug}_{hash4}

t_penyadapan_prabowo_a3f1
t_pajero_gejayan_7b2c
```

| Aturan | Alasan |
|---|---|
| Dibuat sekali, dibekukan | `slug` berubah kalau judul berubah; ID tidak boleh ikut |
| `slug` dari `canonical_title` saat pembuatan | Keterbacaan saat debug |
| `hash4` dari himpunan entitas pendiri | Mencegah tabrakan slug |
| Tidak pernah dipakai ulang | ID yang dihapus tetap mati |
| Penggabungan → `merged_into` | Riwayat tidak hilang |

---

## 13. Metrik kesehatan

Dicatat setiap hari di `run_log`. Ini yang memberi tahu apakah klastering memburuk sebelum edisinya terasa aneh.

| Metrik | Target | Arti kalau melewati |
|---|---|---|
| `after_dedupe / articles_in` | 0,35–0,50 | Dedupe terlalu agresif / terlalu longgar |
| `new_topics` per hari | ≤ 12 | Threshold registry terlalu ketat |
| `merge_rate` (match / total) | ≥ 0,40 | Thread terpecah tiap hari |
| `orphan_rate` | ≤ 0,30 | Blocking gagal |
| `llm_fallback` | 0 | Prompt atau skema rusak |
| `alias_pending_age` | ≤ 7 hari | Antrean menumpuk |

### 13.1 Laporan drift (mingguan)

Skrip 30 baris. Untuk setiap topik aktif, cetak `canonical_title` pada 7 edisi terakhir.

```
t_penyadapan_prabowo   sidang etik Ahrie Sonta
                       Golkar somasi Said Didu
                       LPSK dalami ancaman saksi
```

Kalau judul melompat ke hal yang tidak berhubungan, ID-nya salah dan `changes[]` sudah rusak tanpa terlihat. Ini satu-satunya cara menemukannya.

---

## 14. Reproduksibilitas

| Artefak | Isi |
|---|---|
| `fixtures/day-2026-11-10/articles.json` | Potret 1.000 artikel |
| `fixtures/day-2026-11-10/aliases.hash` | Hash gazetteer saat itu |
| `fixtures/day-2026-11-10/expected.topics.json` | Hasil yang disetujui |
| `scripts/replay.ts` | Jalankan ulang satu hari, bandingkan |

Uji regresi: setiap perubahan prompt atau ambang dijalankan ke 5 hari fixture. Kalau jumlah topik atau ID berubah, perubahan itu harus disengaja.

Determinisme penuh tidak mungkin dengan LLM. Yang dijamin adalah **reproducibility**: input sama + gazetteer sama + prompt sama → output yang bisa dibandingkan.

---

## 15. Biaya

| Item | Per hari |
|---|---|
| Embedding ~1.000 artikel × 100 token | $0,002 |
| Adjudikasi (1 panggilan, ~5k token) | $0,01–0,03 |
| Konfirmasi registry (≤5 panggilan) | $0,01 |
| **Total** | **< $1/bulan** |

---

## 16. Penyerahan ke modul ranking

Klastering berhenti di: daftar topik dengan `title`, `angle`, `kind`, `local`, `horse_race`, jumlah artikel, keragaman outlet, dan `revision`.

Pemilihan 8 kartu **bukan** bagian dari modul ini. Urutan prioritas:

1. Buang `horse_race` dan `drop`
2. Terapkan anggaran suasana hati
3. Peringkat: cakupan × kebaruan × relevansi lokal
4. Sisipkan kartu meta sesuai ambang §8 `REQUIREMENTS.md`

---

## 17. Yang belum diputuskan

| # | Pertanyaan | Dampak |
|---|---|---|
| C1 | ~~Model embedding: OpenAI atau lokal?~~ | ✅ **Lokal** (`multilingual-e5-small`), lihat `INFRA.md` §11.5 |
| C2 | Jendela registry 14 hari — cukup untuk thread panjang? | Risiko thread terpecah |
| C3 | Apakah `angle` ikut jadi kunci pencarian? | Kualitas pencarian arsip |
| C4 | Batas artikel per klaster (25) — cukup untuk isu besar? | Kualitas ringkasan |
