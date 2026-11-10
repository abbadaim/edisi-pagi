# Requirement — Brief Harian "Apa yang Ramai"

**Versi:** 0.1 (draf untuk didiskusikan)
**Tanggal:** 10 November 2026
**Status:** kebutuhan produk, belum teknis
**Lingkup:** pemakaian pribadi, satu pengguna, Kabupaten Sleman, DI Yogyakarta

---

## 1. Tujuan

Membangun **brief harian dan mingguan** yang memberi tahu satu orang — yang jarang membuka media sosial — tentang apa yang sedang terjadi di Indonesia dan di sekitarnya, apa yang benar, apa yang luput, dan apa yang sedang salah dipahami.

### 1.1 Non-tujuan

| Bukan | Alasan |
|---|---|
| Fact-checker publik | Bukan lembaga, tidak punya kredibilitas IFCN, dan risiko hukum tidak sepadan |
| Chatbot | Pengguna tidak mau format percakapan |
| Feed tak terbatas | Bertentangan langsung dengan tujuan mengurangi kelelahan |
| Produk komersial | Belum relevan; memengaruhi keputusan data dan hukum |
| Aplikasi native | PWA cukup untuk satu pengguna |
| Cakupan Instagram | Terbukti tidak mungkin diakses (§7.1) |
| Cakupan WhatsApp | Tidak ada API; hanya bisa didekati lewat proxy |

### 1.2 Kalimat tesis

> Brief untuk orang yang tidak ada di media sosial, tentang apa yang sedang dikatakan media sosial kepada orang lain.

### 1.3 Identitas

| | |
|---|---|
| **Nama** | **Edisi Pagi** |
| `short_name` | Edisi |
| Ikon | Huruf **E** serif di atas bidang `#17150F`, sudut membulat 22% |
| Warna | paper `#FAF7F2` · ink `#17150F` · accent `#B3402A` |
| Berkas | `icons/icon-192.png`, `icon-512.png`, `maskable-512.png`, `apple-touch-icon-180.png`, `favicon-32.png`, `icon.svg` |
| Manifest | `manifest.webmanifest` — `display: standalone`, `theme_color: #17150F` |

**Aturan penamaan:** nama tidak boleh memuat kata "fakta", "cek fakta", atau "hoaks". Produk ini memberi konteks dan bukti; ia tidak mengadili. Nama yang mengklaim otoritas verifikasi menciptakan kewajiban yang tidak bisa dipenuhi alat pribadi — dan mengundang sengketa yang tidak perlu.

---

## 2. Pengguna

| Atribut | Nilai |
|---|---|
| Jumlah | 1 (pemilik) |
| Lokasi | Kabupaten Sleman, DIY |
| Kebiasaan | Jarang membuka media sosial, lelah dengan berita suram |
| Kebutuhan | Catch-up, bukan pemantauan berkelanjutan |
| Waktu baca | ±4 menit/hari |
| Perangkat | Ponsel, notifikasi push |
| Bahasa | Bahasa Indonesia |

**Konsekuensi:** produk harus **selesai**, bukan berkelanjutan. Tidak ada skor, streak, atau ajakan kembali.

---

## 3. Prinsip desain

| # | Prinsip | Konsekuensi konkret |
|---|---|---|
| P1 | **Edisi berakhir** | Nasional tepat 8 kartu, lokal 2–5. Tiap edisi punya akhir sendiri; tidak ada muat ulang, tidak ada "berita lain". |
| P2 | **Anggaran suasana hati** | Maksimal 2 dari 8 kartu bertema bencana/kriminal/konflik. |
| P3 | **Setiap kartu punya tindakan** | Baris "Untuk kamu" wajib ada di setiap kartu berita. |
| P4 | **Bukti dulu, putusan kemudian** | Tidak pernah ada label "HOAKS" tanpa sumber, tanggal, dan alasan. |
| P5 | **Diam itu sah** | Hari sepi menghasilkan edisi pendek, bukan edisi yang dipanjangkan. |
| P6 | **Kesalahan dibedakan dari kejahatan** | Keliru, berubah, dan memfitnah adalah tiga hal berbeda (§6). |
| P7 | **Sumber selalu disebut** | "Dari 30 komentar di detik.com", bukan "kata netizen". |
| P8 | **Tidak merendahkan pembaca** | "Yang sering ditanyakan", bukan "yang orang salah pahami". |
| P9 | **Kelangkaan itu fitur** | Kartu meta muncul maksimal 2 per edisi, dan hanya kalau sinyalnya kuat. |

---

## 4. Struktur edisi

Setiap hari menerbitkan **dua edisi terpisah**. Masing-masing berakhir sendiri; keduanya tidak digabung menjadi satu dokumen panjang.

### 4.0 Jendela liputan

Edisi terbit 05.45 dan **meliput kemarin**. Cron pagi tidak bisa melihat berita yang belum terjadi.

| Field | Nilai |
|---|---|
| `edition_id` | hari baca (mis. `2026-11-11`) |
| `coverage.from` | `2026-11-10T05:00+07:00` |
| `coverage.to` | `2026-11-11T05:00+07:00` |

Header aplikasi menampilkan hari baca; satu baris kecil menyebut jendela liputan. Semua waktu di kartu ditulis relatif ("kemarin 12.36"), bukan "6 jam lalu".

### 4.1 Edisi Nasional — 5–8 kartu (target 8)

| Slot | Kartu | Jumlah |
|---|---|---|
| 1–5 | Berita utama | `5 − meta_count` |
| — | **Mendalam** | **1** |
| 6 | Kabar yang Beredar | 1 |
| 7 | Satu hal yang baik | 1 |
| 8 | Kartu meta | 0–2 |

```
total = (5 − meta_count) + 1 + 1 + 1 + meta_count = 8
```

| `meta_count` | Berita | Mendalam | Hoax | Baik | Meta |
|---|---|---|---|---|---|
| 0 | 5 | 1 | 1 | 1 | 0 |
| 1 | 4 | 1 | 1 | 1 | 1 |
| 2 | 3 | 1 | 1 | 1 | 2 |

**Mendalam** diambil dari thread berumur 7–30 hari, bukan dari siklus harian, dan **tidak dihitung** dalam estimasi waktu baca edisi. Header menulis `±5 menit + 1 bacaan panjang`. Pengguna boleh melewatinya tanpa kehilangan sisa edisi.

Jika tidak ada kandidat yang memenuhi syarat, `news_slots` bertambah satu dan `deep_dive` dilewati — dicatat di `run_log`, bukan dipaksakan.

### 4.2 Edisi Lokal (Sleman) — 2–5 kartu

| Komponen | Jumlah |
|---|---|
| Berita lokal | 1–4 |
| Kartu meta (`change` / `debate` saja) | 0–1 |
| Satu hal yang baik (opsional) | 0–1 |

**Terbit hanya jika ≥2 topik lolos.** Jika kurang, edisi lokal tidak diterbitkan dan `manifest` mencatat `local: null`. Tidak diisi paksa.

Batas `heavy` lokal adalah **1**, bukan 2. Berita Sleman didominasi kriminal dan kecelakaan; dua kartu berat akan menghapus nilai edisi lima kartu.

### 4.3 Kartu meta

Maksimal **2** untuk nasional, **1** untuk lokal, dipilih dari:

| Tipe | Nasional | Lokal |
|---|---|---|
| Yang Luput (celah liputan) | ✅ | ❌ |
| Yang Berubah (koreksi / pergeseran bingkai) | ✅ | ✅ |
| Yang Diperdebatkan (reaksi publik) | ✅ | ✅ |
| Yang Salah Dipahami (kesalahpahaman publik) | ✅ | ❌ |

Topik yang dipakai sebagai kartu meta **dikeluarkan** dari pool berita, agar tidak muncul dua kali. Jika tidak ada kandidat yang melewati ambang (§8.4), `meta_count = 0` dan slot berita bertambah.

### 4.4 Frekuensi terbit

| Edisi | Waktu | Isi |
|---|---|---|
| **Nasional** | 05.45 WIB setiap hari | 8 kartu · ±5 menit + 1 bacaan panjang |
| **Lokal** | 05.45 WIB setiap hari | 2–5 kartu · ±3 menit |
| **Mingguan** | Minggu 07.00 WIB | Pola 7 hari + "apa yang benar-benar berubah" |

### 4.5 Notifikasi

| Jenis | Frekuensi | Aturan |
|---|---|---|
| Edisi siap | 1×/hari, jam tetap pilihan pengguna | `Nasional 8 · Sleman 4` → satu ketukan |
| Ringkasan mingguan | 1×/minggu | |
| **Tindak lanjut** | tidak terjadwal | Menumpang edisi harian; dihitung di sisi aplikasi |
| Peringatan lokal | maks 2×/minggu | Wajib: terkonfirmasi, menyangkut keselamatan/uang, di kabupaten pengguna |

**Dilarang:** notifikasi per berita, "sedang ramai", "kami merindukanmu", ringkasan aktivitas baca.

### 4.6 Edisi mingguan — 3–6 kartu

Terbit Minggu pagi. Isinya **rekap**, bukan berita baru: thread yang berjalan sepanjang pekan, dengan konteks dan angka.

| Komponen | Isi |
|---|---|
| Jendela | 7 hari terakhir |
| Kartu | 3–6, semuanya `deep_dive` |
| Tiap kartu | judul thread, dek, 3 angka (artikel, media, hari berjalan), 2–3 paragraf, konteks |
| Tanpa | Kabar yang Beredar, Satu hal baik, kartu meta |

**Beda dengan harian:** harian menjawab "apa yang terjadi kemarin", mingguan menjawab "apa yang berubah selama sepekan". Karena itu mingguan tidak memakai `changes[]` harian, tetapi menampilkan rentang waktu dan jumlah artikel sebagai bukti bahwa thread itu memang berjalan.

---

## 5. Spesifikasi kartu

### 5.1 Anatomi umum

Setiap kartu wajib memiliki:

| Field | Aturan |
|---|---|
| `judul` | Maks 60 karakter, tanpa klikbait, tanpa huruf kapital semua |
| `meta` | Kategori · waktu · jumlah sumber |
| `isi` | 3–5 kalimat. Wajib memuat minimal satu angka, nama, atau tanggal spesifik |
| `status` | `terkonfirmasi` / `sebagian` / `belum` / `dibantah` |
| `keyakinan` | Band kepercayaan + satu baris dasar bukti. Wajib untuk kartu berita; `null` untuk opini dan prediksi |
| `konteks` | 2–4 pertanyaan penjelas + jawaban latar. Wajib untuk `news` dan `good_news` |
| `untuk_kamu` | Satu kalimat, imperatif, berguna |
| `sumber` | ≥1, dengan tanggal akses |
| `gambar` | Satu, full-bleed, dari `og:image` sumber |

**Larangan:** kalimat tanpa sumber untuk klaim kausal ("karena itu…", "dipicu oleh…") kecuali dinyatakan sebagai inferensi.

### 5.2 Kartu 1–5 — Berita utama

- Dipilih dari klaster topik, bukan dari artikel individual.
- Satu topik = satu kartu, diperbarui di tempat, tidak pernah diduplikasi.
- Wajib lolos filter anggaran suasana hati (P2).
- Tidak boleh memuat horse-race politik (peluang, elektabilitas, manuver partai) kecuali berdampak langsung pada kebijakan.

### 5.3 Kartu 6 — Kabar yang Beredar

**Sumber tunggal yang diizinkan:** TurnBackHoax, CekFakta, Kompas/Liputan6/Tempo/Tirto Cek Fakta, AFP, Reuters, Google Fact Check API (ClaimReview).

**Dilarang keras** menyimpulkan hoaks dari analisis sendiri.

Format per item:
- klaim seperti yang beredar
- putusan (`SALAH` / `PARODI` / `MENYESATKAN`)
- **alasan spesifik** (mis. "potongan wawancara tvOne 15 Sep 2014, menit 05.14–06.55")
- tautan sumber

Jika tidak ada fact-check baru: tampilkan **pola berulang**, bukan item kosong. Contoh: "tiga dari sepuluh hari ini adalah rekaman lama yang diberi tanggal baru."

### 5.4 Kartu 7 — Satu hal yang baik

- Wajib satu per edisi, tanpa kecuali.
- Kriteria: sesuatu yang **benar-benar membaik, selesai, atau terbukti tidak benar**.
- Bukan berita hiburan, bukan PR pemerintah, bukan *toxic positivity*.
- Contoh sah: program yang berjalan, rumor yang ternyata palsu, bencana yang tertangani.

### 5.5 Kartu meta A — Yang Luput

Menampilkan ketidaksesuaian antara perhatian publik dan liputan media.

Wajib memuat:

| Field | Contoh |
|---|---|
| `ramai_di` | Reddit 907 upvote · 102 komentar · Google Trends 500+ |
| `diliput` | 0 dari 12 media yang dipantau |
| `sudut_absen` | siapa yang menandatangani kontrak, untuk kampanye apa |
| `status` | ICW sudah merilis temuan; belum ada bantahan |

Dua subtipe:
- **Ramai, tidak diliput** — celah positif
- **Diliput, tidak dibaca** — celah negatif; tulis sebagai pola institusional, bukan tuduhan

**Tindak lanjut wajib.** Kartu ini berjalan sebagai watchlist sampai ada media yang meliput. Setiap outlet baru dicatat dan ditampilkan sebagai perubahan:

```
Diliput   0 → 1 dari 12 media
Tirto.id · kemarin 16.20 — sudut yang absen mulai dijawab
```

Jika tiga media meliput dalam tujuh hari, kartu ditutup dan muncul sekali sebagai "Akhirnya diliput". Jika 14 hari tanpa liputan, ditutup dengan kalimat netral: *"14 hari, nol liputan dari 12 media yang dipantau."* Maksimum tiga kemunculan per topik dalam 14 hari (`RANKING.md` §6.5).

### 5.6 Kartu meta B — Yang Berubah

Menampilkan perubahan klaim pada topik yang sama antar hari.

Wajib memuat **dua tanggal** dan **dua kutipan**:

```
09 Nov 19.36 : "Bang Jago Dihajar Warga"
10 Nov 12.36 : "Korban dugaan penganiayaan… mahasiswa asal Tebo"
Yang berubah : label pelaku → korban
Yang belum   : klaim "mabuk" masih dugaan, bukan hasil pemeriksaan
```

**Dilarang** menyimpulkan niat. Frasa yang diizinkan: *"judul awal menyebut X; pernyataan resmi kemudian menyebut Y"*. Frasa yang dilarang: *"media berbohong"*, *"sengaja disembunyikan"*.

### 5.7 Kartu meta C — Yang Diperdebatkan

Meringkas reaksi publik terhadap satu berita.

Wajib memuat:

| Field | Aturan |
|---|---|
| `volume` | Jumlah komentar (detik.com) — angka, bukan kesan |
| `nada` | Mayoritas, dinyatakan sebagai observasi |
| `kutipan` | 1–2, dengan nama akun |
| `pembanding` | Volume/nada di sumber lain (mis. Reddit) |
| `bacaan` | Satu kalimat interpretasi, ditandai sebagai interpretasi |

**Batasan sumber:** hanya media dengan basis pembaca arus utama (detik.com) dan Reddit. Keduanya wajib disebut namanya. Tidak pernah ditulis sebagai "kata orang Indonesia".

### 5.8 Kartu meta D — Yang Salah Dipahami

Menampilkan kesalahpahaman publik atas fakta yang **benar**.

Format:

```
Yang beredar        : MUI mengharamkan vape
Yang benar          : fatwa = ketetapan keagamaan; belum ada UU, belum ada sanksi
Yang sering hilang  : "MUI meminta Presiden dan DPR menyusun UU"
```

**Syarat masuk** (minimal satu):
- Jarak judul–badan berita terdeteksi (§8.5)
- Pertanyaan yang sama muncul ≥3× di komentar
- Terdapat related query Google Trends bernada bertanya
- Terdapat fact-check yang mengonfirmasi

**Nada wajib:** "yang sering ditanyakan", **bukan** "yang orang salah pahami".

### 5.9 Konteks — pertanyaan penjelas

Setiap kartu berita diakhiri dengan 2–4 pertanyaan yang menjawab hal yang **tidak** dijelaskan berita: istilah, orang, lembaga, atau prosedur. Bukan ringkasan ulang.

```
KONTEKS
Mengapa ijazah Gibran jadi polemik?
Dokumen pendidikan Gibran dipersoalkan sejak pencalonannya pada 2024...
Apa itu HMP?
Hak Menyatakan Pendapat adalah hak konstitusional DPR (Pasal 20A UUD 1945)...
Siapa Puan Maharani?
Ketua DPR RI 2024–2029, politikus PDI-P, putri Megawati...
Bagaimana wapres bisa diberhentikan?
DPR mengajukan HMP → MPR menyidangkan → keputusan dua pertiga...
```

| Aturan | |
|---|---|
| Jumlah | 2–4 pertanyaan. |
| Bentuk | `q` diakhiri tanda tanya, 8–90 karakter. |
| Jawaban | 1–3 kalimat, 40–420 karakter. |
| Sumber | Setiap pertanyaan punya `source` sendiri: glosarium, Wikipedia, atau sumber latar lain — bukan hanya sumber berita. Model hanya **memilih** dari kandidat yang disediakan; ia tidak boleh mengarang sumber. |
| Isi | Menjelaskan latar, bukan mengulang `body`. |
| Dilarang | Opini, prediksi, penilaian. |

Empat jenis yang sebaiknya ada, pilih yang relevan:

| Jenis | Contoh |
|---|---|
| Konsep | "Apa itu HMP?" |
| Orang / lembaga | "Siapa Puan Maharani?" |
| Proses | "Bagaimana wapres bisa diberhentikan?" |
| Latar | "Mengapa ijazah Gibran jadi polemik?" |

**Kartu tanpa konteks tidak terbit.** Minimal satu pertanyaan harus benar-benar spesifik untuk topik itu (dari glosarium entitas). Sisanya boleh penjelas tingkat kategori. Kalau tidak ada satu pun yang spesifik, kartu dilewati dan topik berikutnya diambil — konteks bukan hiasan, ia bagian dari produk.

**Bentuk di layar.** Kartu menampilkan teaser di akhir — "Konteks · 4 pertanyaan · ±2 menit" dengan chevron. Mengetuk membuka bagian penuh. Ini tetap terbatas: jumlah pertanyaannya tetap dan bagiannya berakhir.

**Kenapa bukan 5W1H ringkas.** Daftar label-jawaban memberi fakta yang sudah ada di teks. Yang dibutuhkan pembaca adalah hal yang **tidak** ada di teks: apa arti istilahnya, siapa orangnya, bagaimana prosedurnya. Itu yang membuat berita bisa dipahami tanpa membaca lima artikel lain.

---

## 6. Taksonomi kesalahan (enam lapis)

Ini yang membedakan brief ini dari agregator berita. Enam pertanyaan berbeda, enam sumber berbeda.

| # | Lapisan | Pertanyaan | Sumber utama |
|---|---|---|---|
| 1 | Apa yang terjadi | Fakta dasar | RSS berita |
| 2 | Apa yang luput | Celah liputan / sudut absen | Metrik §8.2 |
| 3 | Apa yang berubah | Koreksi / pergeseran bingkai | Framing delta §8.3 |
| 4 | Apa yang diperdebatkan | Reaksi publik | Komentar detik.com, Reddit |
| 5 | Apa yang salah dipahami | Kesalahpahaman publik | §8.5 |
| 6 | Apa yang palsu | Fabrikasi | TurnBackHoax, ClaimReview |

**Aturan pemisahan:** sebuah item tidak boleh masuk dua lapisan sekaligus. Jika ragu, pilih lapisan dengan bukti terkuat.

---

## 7. Sumber data dan perannya

### 7.1 Matriks akses (hasil uji langsung, 8–10 Nov 2026)

| Sumber | Akses | Status | Peran |
|---|---|---|---|
| RSS berita nasional | ✅ | stabil | penemuan |
| RSS berita lokal (detikJogja, Tribun Jogja, Harian Jogja) | ✅ | stabil | penemuan lokal |
| TurnBackHoax RSS | ✅ | stabil | lapisan 6 |
| Google Fact Check API | ✅ | stabil | lapisan 6 |
| Google Trends RSS (`geo=ID`) | ✅ | tidak resmi | interest |
| Google Trends API resmi | ⚠️ | alpha, undangan | opsional |
| Wikimedia Pageviews | ✅ | stabil | validasi "benar-benar besar" |
| **Arctic Shift (Reddit)** | ✅ | gratis, tanpa auth | lapisan 4, deteksi anomali |
| **Detik comment (`sneak-peek`)** | ⚠️ | total + 2 komentar | lapisan 4 (volume) |
| TikTok `challenge/detail` | ✅ | kumulatif saja | cek amplifikasi |
| TikTok Creative Center | ❌ | terkunci login (3 item anonim) | — |
| **Instagram** | ❌ | dinding total | **keluar dari lingkup** |
| Google News dengan `after:`/`before:` | ❌ | tidak andal | **jangan dipakai** |

### 7.2 Batasan yang mengikat

| Batasan | Dampak |
|---|---|
| RSS hanya menyimpan 1–2 hari | Backfill wajib pakai Arctic Shift + sitemap outlet |
| TurnBackHoax nol liputan lokal | Koreksi lokal harus dari Polresta/Pemkab/BPBD |
| Subreddit lokal (r/jogja, r/yogyakarta, r/sleman) nol post | Lokal hanya lewat r/indonesia |
| Kualitas komentar bervariasi per tipe thread | Filter flair wajib (§8.6) |
| Statistik TikTok kumulatif | Hanya delta yang bermakna |
| Instagram tidak mungkin | Keluarkan dari desain |

### 7.3 Bobot per sumber berita

| Sumber | Nilai lokal | Catatan |
|---|---|---|
| detikJogja | ★★★ | hampir murni lokal |
| Tribun Jogja | ★★ | ±50% SEO lifestyle |
| Harian Jogja | ★ | ±70% wire nasional |

Bobot per sumber wajib diterapkan; tanpa itu edisi tenggelam oleh konten SEO.

### 7.4 Model bahasa (LLM)

Untuk v1, dua penyedia saja:

| Penyedia | Dipakai untuk | Catatan |
|---|---|---|
| `opencode` | Semua kapabilitas | **Penyedia utama.** Pemilihan model lewat id `provider/model` dari katalog OpenCode |
| `deepseek` | Semua kapabilitas **kecuali** `embed` | **Cadangan.** `https://api.deepseek.com`, format OpenAI, model `deepseek-chat` / `deepseek-v4-pro` |

**Konfigurasi per kapabilitas, bukan satu model global.**

| Kapabilitas | Fungsi |
|---|---|
| `adjudicate` | Penggabungan/pemisahan klaster, judul kanonik, `category`/`significance`/`heavy` |
| `write` | Menulis isi kartu, `action`, `dek`, ringkasan |
| `verify` | Blok `truth`, deteksi `misread`, pemilihan kutipan |
| `embed` | Vektor untuk klastering |

**Aturan yang mengikat:**

1. `embed` **tidak boleh** menunjuk ke `deepseek` — API itu tidak punya endpoint embedding. Validator konfigurasi menolak kombinasi ini sebelum pipeline berjalan.
2. Jika `embed` tidak dikonfigurasi, klastering berjalan dalam mode leksikal (entitas + waktu, tanpa cosine). Kualitas turun; dicatat `embedding: false` di `run_log`.
3. Setiap panggilan mencatat `provider`, `model`, token masuk/keluar, dan biaya ke `run_log`.
4. Setiap edisi mencatat `generated_by: { provider, model }` per kapabilitas, agar satu edisi bisa direproduksi dengan model yang menghasilkannya.
5. Output JSON wajib divalidasi skema. Gagal → satu retry. Gagal lagi → fallback deterministik, `llm_fallback: true`.
6. Kunci API hanya dari environment variable; tidak pernah masuk repo atau `edition.json`.
7. Mengganti model tidak boleh mengubah skema keluaran. Jika sebuah model tidak mendukung JSON mode, adapter wajib menolak saat startup, bukan saat 05.45.

---

## 8. Metrik dan ambang

Semua ambang di bawah bersifat **sementara** dan harus dikalibrasi setelah 5 edisi.

### 8.1 Skor amplifikasi

```
amplifikasi = reddit(score + 2 × num_comments)
            + total_komentar_detik
            + interest_gtrends
            + delta_view_tiktok
```

### 8.2 Coverage gap

Bandingkan **peringkat**, bukan rasio (menghindari pembagian nol):

```
gap = peringkat(amplifikasi) − peringkat(jumlah_artikel)
```

| Nilai | Arti | Kartu |
|---|---|---|
| `gap ≥ +5` | Ramai, tidak diliput | Yang Luput (subtipe positif) |
| `gap ≤ −5` | Diliput, tidak dibaca | Yang Luput (subtipe negatif) |

### 8.3 Framing delta

Untuk setiap topik yang bertahan ≥2 hari, simpan:

- judul pertama + waktu
- judul terbaru + waktu
- label/klaim yang berubah
- sumber resmi terbaru

Perubahan pada salah satu field (`label`, `angka`, `status`) → kandidat **Yang Berubah**.

### 8.4 Ambang kartu meta

| Kartu | Syarat minimum |
|---|---|
| Yang Luput | `\|gap\| ≥ 5` **dan** minimal 2 sumber independen |
| Yang Berubah | ada diff pada `label`/`angka`/`status` **dan** ada sumber resmi |
| Yang Diperdebatkan | `total_komentar ≥ 15` **atau** `reddit_score ≥ 200` |
| Yang Salah Dipahami | 1 sinyal (§8.5) **dan** 1 sumber penjelas |

Jika lebih dari 2 lolos, ambil skor tertinggi.

### 8.5 Deteksi headline–body gap

Tandai jika badan berita memuat penanda kualifikasi yang **tidak** ada di judul:

```
belum · tidak mengikat · usulan · wacana · draf · tahap penyelidikan ·
diduga · menurut keterangan awal · masih dikaji · tidak serta-merta
```

### 8.6 Filter Reddit

| Aturan | Nilai |
|---|---|
| Flair diizinkan | `News`, `Current Affair`, `Politics`, `Serious Discussion` |
| Flair dilarang | `Funny/Memes/Shitpost`, `Ask Indonesian` |
| Tipe media | Jika `i.redd.it` / `v.redd.it` + flair meme → **bukan klaim** |
| Penggunaan skor | Hanya untuk deteksi anomali, **bukan** untuk ranking edisi |
| Komentar | Hanya untuk label bingkai, **bukan** sebagai fakta |

---

## 9. Aturan editorial

| # | Aturan |
|---|---|
| E1 | Setiap klaim punya sumber bertanggal. Tanpa itu, klaim dihapus. |
| E2 | Klaim kausal harus ditandai sebagai inferensi jika bukan kutipan langsung. |
| E3 | Tidak ada penilaian niat terhadap media, lembaga, atau individu. |
| E4 | Angka wajib disertai satuan dan tanggal pengukuran. |
| E5 | Kutipan komentar wajib menyertakan nama akun dan platform. |
| E6 | Bedakan "tidak setuju" dari "salah paham". Hanya yang kedua masuk lapisan 5. |
| E7 | Berita kriminal hanya masuk jika berdampak pada keselamatan/uang pembaca. |
| E8 | Tidak ada horse-race politik. |
| E9 | Jika dua sumber kredibel berbeda, tampilkan keduanya; jangan memilih. |
| E10 | Judul tidak boleh lebih kuat dari isi. |

---

## 10. Di luar lingkup (v1)

- Instagram (tidak dapat diakses)
- WhatsApp (tidak ada API)
- YouTube API (kandidat v1.1)
- Aplikasi native (PWA cukup)
- Multi-pengguna
- Publikasi publik / berbagi
- Penerjemahan ke bahasa lain
- Pencarian arsip oleh pengguna

---

## 11. Batasan teknis dan hukum

| Hal | Status |
|---|---|
| PSE Lingkup Privat | **tidak berlaku** — pemakaian pribadi, tidak melayani publik |
| UU PDP | Minimal — hanya simpan nama kabupaten, jangan koordinat |
| UU ITE / pencemaran nama baik | Risiko rendah karena tidak dipublikasikan; tetap patuhi E3 |
| Hak cipta | Kutipan pendek + tautan; gambar pakai `og:image` dengan atribusi |
| ToS platform | Reddit via arsip publik; detik.com hanya metadata komentar; TikTok hanya statistik tag |
| Data lokasi | Reverse-geocode sekali, simpan string kabupaten, buang koordinat |
| Sinkronisasi | Tidak ada di v1 (satu ponsel, tanpa ekspor manual). Durabilitas menyusul lewat sinkronisasi (§12 `SCHEMA.md`) |
| Retensi | 2 tahun; indeks pencarian dipisah per kuartal |

---

## 12. Kriteria penerimaan v1

Sistem dianggap memenuhi requirement jika, selama **5 hari berturut-turut**:

1. Menghasilkan **edisi nasional 8 kartu** dan **edisi lokal 2–5 kartu** sebelum 06.00 WIB tanpa intervensi manual. Edisi lokal boleh tidak terbit jika <2 topik lolos, dan itu bukan kegagalan.
2. Setiap kartu berita punya ≥1 sumber bertanggal dan baris "Untuk kamu".
3. Tidak ada klaim kausal tanpa penanda inferensi.
4. `Yang Berubah` hanya muncul jika ada diff nyata.
5. **Nol** false positive meme/shitpost di `Kabar yang Beredar`.
6. **Nol** item `Kabar yang Beredar` tanpa sumber fact-check.
7. Notifikasi tindak lanjut terbit ≤24 jam setelah fact-check muncul untuk topik yang pernah ditampilkan.
8. Tidak ada berita kriminal tanpa dampak langsung pada pembaca.
9. Waktu baca terukur ≤5 menit.
10. Pengguna membuka edisi ≥4 dari 5 hari (uji kegunaan, bukan uji teknis).
11. Setiap kartu berita punya 2–4 pertanyaan konteks, masing-masing dengan sumber, dan **tidak ada** yang jawabannya mengulang isi kartu.
12. Tidak ada pertanyaan konteks yang menjawab dirinya sendiri dengan opini atau prediksi.

---

### 12.1 Uji pra-rilis

Sebelum aplikasi dirilis, jalankan dan periksa:

| Uji | Perintah | Yang dilihat |
|---|---|---|
| Harian 7–10 Nov | `npm run build -- --date 2026-11-07` … `2026-11-10` | apakah edisi terbentuk, dan di mana datanya kurang |
| Mingguan (Minggu) | `npm run weekly -- --date 2026-11-08` | apakah rekap punya cukup thread |
| Validasi | `npm run validate -- data/editions/*.json` | semua lolos skema |
| Edisi tipis | tambahkan `--thin` saat build | edisi <5 kartu tetap terbit untuk pengujian |
| Aplikasi | `npm run publish && npm run serve` | buka `http://localhost:8080` |

**Temuan prasyarat:** RSS hanya menyimpan 1–2 hari, jadi hari yang lebih lama tidak bisa direkonstruksi dari feed. Backfill butuh sumber arsip (sitemap per tanggal atau arsip pihak ketiga). Tanpa itu, uji 7–10 Nov hanya bisa memakai hari yang masih tersedia.

## 13. Pertanyaan terbuka untuk fase teknis

| # | Pertanyaan | Menentukan |
|---|---|---|
| Q1 | Strategi klastering: embedding + entity linking, atau LLM langsung? | akurasi & biaya |
| Q2 | Penyimpanan state: SQLite atau file JSON per hari? | kompleksitas |
| Q3 | Model LLM dan anggaran per hari | biaya |
| Q4 | Batch harian vs pipeline bertahap | arsitektur |
| Q5 | Sumber gambar dan penanganan hak cipta | desain kartu |
| Q6 | PWA + web push vs native wrapper | distribusi |
| Q7 | Cara menangani backfill hari pertama | kualitas edisi |
| Q8 | Apakah YouTube API masuk v1 | cakupan |
| Q9 | Format `edition.json` | ✅ selesai — lihat `SCHEMA.md` |

---

## Lampiran A — Contoh edisi (10 Nov 2026)

Diuji dengan data nyata. Delapan kartu:

1. DPR: 50 anggota teken HMP soal ijazah Gibran
2. Sidang etik Irjen Ahrie Sonta dan meluasnya kasus penyadapan
3. Kabar yang Beredar — 10 fact-check, semuanya politik
4. Harga beras belum turun meski 1 juta ton SPHP disiapkan
5. MUI haramkan vape — tapi belum berarti dilarang negara
6. OJK hentikan 16 entitas investasi ilegal
7. Kotaku: 74 aksi demo di Jakarta
8. Satu hal yang baik: ziarah Kalibata + 506 dapur garam di Aceh

Kartu meta yang lolos ambang hari itu:
- **Yang Luput:** Raffi Ahmad / Rp14,7 M — 907 upvote Reddit + Trends 500+, nol liputan di 10 feed
- **Yang Salah Dipahami:** fatwa MUI vs hukum negara

---

## Lampiran B — Contoh edisi lokal (8–10 Nov 2026, Sleman)

| Hari | Temuan |
|---|---|
| 8 Nov | Arsip RSS tidak tersedia — **bukti kebutuhan backfill** |
| 9 Nov | Dua insiden viral di Depok, Sleman, berjarak 3 km, dalam 6 jam |
| 10 Nov | Polisi mengoreksi bingkai: "bang jago" → "korban" dalam 17 jam |

Kartu meta yang lolos:
- **Yang Berubah:** Pajero Gejayan, pelaku → korban
- **Yang Diperdebatkan:** HMP Gibran, 30 komentar detik.com vs 1 di Reddit

---

*Dokumen ini menggantikan catatan riset percakapan. Perubahan berikutnya harus memperbarui nomor versi.*
