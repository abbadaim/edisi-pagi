# Newsroom — Peran LLM dalam Pipeline

**Versi dokumen:** 0.1 (draf untuk didiskusikan)
**Tanggal:** 10 November 2026
**Status:** rencana, belum diimplementasikan
**Bergantung pada:** `REQUIREMENTS.md` v0.1, `SCHEMA.md` v0.2, `RANKING.md`, `INFRA.md` §11

---

## 0. Keputusan yang diusulkan

| # | Keputusan | Alasan singkat |
|---|---|---|
| N1 | Peran dipisah, tetapi **setiap serah-terima berupa artefak JSON**, bukan percakapan | Bisa divalidasi, di-cache, dan diputar ulang |
| N2 | **LLM mengusulkan, aturan menentukan.** Slot, anggaran suasana hati, ambang meta, `truth`, dan gerbang terbit tetap deterministik | Mencegah model mengubah produk secara diam-diam |
| N3 | **Editor menemukan, penulis memperbaiki.** Editor tidak pernah menulis prosa final | Suara tetap satu; temuan bisa diaudit |
| N4 | **Riset adalah alat, bukan agen.** Tidak ada penjelajahan bebas; hanya sumber dalam daftar izin | Biaya, legalitas, dan prompt injection |
| N5 | **Kedalaman direncanakan**, bukan diserahkan pada selera penulis | Depth adalah properti topik, bukan hasil kebetulan |
| N6 | Setiap kalimat faktual wajib menunjuk `source_id` di dalam material pack | Klaim bisa diperiksa mesin, bukan hanya dinilai model |
| N7 | Loop dibatasi dan punya tenggat; edisi selalu terbit | 05.45 tidak boleh menunggu perbaikan tanpa akhir |
| N8 | Perubahan perilaku di balik feature flag, diukur lewat golden set | Tanpa itu, peran tambahan hanya menambah biaya dan kata |

---

## 1. Diagnosis pipeline hari ini

| Fakta | Dampak |
|---|---|
| `articles.lead` rata-rata **138 karakter**, maksimum 299 | Penulis tidak pernah melihat isi artikel. Kedalaman edisi dibatasi ukuran material, bukan kemampuan model |
| Writer menerima maksimal 8 artikel × ~140 karakter | Body 3 paragraf (~1.400 karakter) sebagian berasal dari pengetahuan model, bukan sumber |
| Kedalaman selalu 3 paragraf | Tidak ada bedanya antara berita singkat dan isu yang layak dibahas panjang |
| `verify` sudah dikonfigurasi tetapi **tidak dipakai** | `truth` murni aturan (`computeTruth`); tidak ada pemeriksa independen |
| `category` ditentukan `adjudicate`, dipakai `hardFilter` | Jika editor mengubah kategori setelah seleksi, anggaran suasana hati bisa bocor |
| Tidak ada antrean tindak lanjut | `registry`, `gap_watch`, `previousDeepDives` ada, tetapi tidak ada satu tempat yang menjawab "apa yang perlu ditindaklanjuti hari ini" |
| Tidak ada `run_log` per panggilan | Biaya per peran tidak terlihat, jadi tidak bisa dikalibrasi |

**Kesimpulan.** Menambah peran tanpa memperbaiki material hanya memindahkan halusinasi ke tempat lain. Perbaikan kualitas terbesar, berurutan:

1. artikel penuh + paket material,
2. sitasi per kalimat,
3. pemeriksa independen (editor),
4. perencana tindak lanjut,
5. baru kemudian penambahan peran lain.

---

## 2. Prinsip

| # | Prinsip | Konsekuensi |
|---|---|---|
| P1 | Satu field, satu pemilik | Lihat §5; tidak ada dua peran yang sama-sama "berhak" atas kategori atau kedalaman |
| P2 | Serah-terima = skema | Setiap keluaran peran divalidasi kode sebelum dipakai peran berikutnya |
| P3 | Aturan dulu, model kemudian | Pemeriksaan murah dan pasti dijalankan sebelum memanggil LLM |
| P4 | Sumber adalah data, bukan instruksi | Teks artikel dibungkus penanda data; situs tidak boleh memberi perintah ke model |
| P5 | Gagal ke bawah, bukan gagal total | Editor gagal → terbit dengan tulisan + validasi aturan; riset gagal → kedalaman diturunkan |
| P6 | Bisa diputar ulang | Kunci cache = hash(material + prompt + model); hasil yang sama tidak dibayar dua kali |
| P7 | Diam itu sah | Topik yang tidak lolos editor boleh gugur; jumlah kartu turun, `truncated_reason` diisi |

---

## 3. Alur

```
ingest ──► cluster ──► [PLANNER] ──► aturan seleksi ──► [RISET] ──► [WRITER]
                          │                (slot, mood,        │          │
                          │                 meta, dedupe)      │          ▼
                          │                                     │      [EDITOR]
                          │                                     │       │   ▲
                          │                                     │  revisi│   │ temuan
                          │                                     └────────┘   │
                          │                                                  ▼
                          └──────────────► [DESK] ◄──────── aturan validasi ─┘
                                             │
                              ┌──────────────┴──────────────┐
                          terbit                     kembalikan 1 kartu
                                                       ke WRITER (+temuan EDITOR)
```

Peran dan sifatnya:

| Tahap | Peran | Sifat | Panggilan LLM |
|---|---|---|---|
| 2 | Planner | LLM mengusulkan, aturan memilih | 1 per edisi |
| 3 | Riset | deterministik + pemilih LLM opsional | 0–8 |
| 4 | Writer | LLM | 1 per kartu (+1 bila minta bahan) |
| 5 | Editor | aturan + LLM | 1 per kartu (+1 per revisi) |
| 6 | Desk | aturan + 1 LLM | 1 per edisi |

---

## 4. Kontrak per peran

### 4.1 Planner — meja tugas

**Masukan**

- ringkasan klaster (`summarise()` yang sudah ada),
- riwayat topik: revisi terakhir, sudut yang sudah dipakai, hari sejak terbit,
- antrean tindak lanjut: thread terbuka, `gap_watch`, janji "akan ditindaklanjuti",
- kendala hari ini: jumlah slot per scope, `maxHeavy`, batas kartu meta, target waktu baca,
- hasil fact-check terbaru.

**Keluaran** (per topik)

```jsonc
{
  "cid": ["c03", "c04"],
  "title": "KPK periksa 9 kepala kantor pertanahan",
  "angle": "Setoran yang diduga mengalir ke pejabat",
  "category": "policy",
  "significance": 4,
  "heavy": false,
  "depth": "deep",                  // brief | standard | deep
  "why_now": "Pemeriksaan hari ini; dua pejabat sudah dicegah",
  "follow_up_of": "t_kpk_pertanahan", // null bila topik baru
  "answers": [                      // inventaris sudut, 2–6 butir
    "Apa yang disidik dan sejak kapan",
    "Berapa nilai setoran yang diduga",
    "Siapa yang sudah ditetapkan tersangka",
    "Apa bantahan pihak yang disebut"
  ],
  "missing": ["Nilai setoran belum dirilis resmi"],
  "drop": false,
  "reason": null
}
```

**Yang tidak dilakukan planner:** memilih `card.id`, mengurutkan kartu, menetapkan `status`/`truth`, menulis prosa.

**Aturan setelah planner** (tetap kode yang sudah ada):

- `hardFilter()` + `select()` menentukan kartu final,
- anggaran suasana hati, batas meta, dedupe `topic_id`, dan pemisahan lokal/nasional tidak boleh diserahkan ke model,
- `depth` hanya mengubah target panjang dan kebutuhan material, bukan jumlah slot.

**Heuristik `depth`** (boleh ditimpa planner dengan alasan):

| Nilai | Syarat |
|---|---|
| `deep` | thread ≥3 hari **atau** ≥5 media **atau** ada sumber primer tier 1 **atau** tindak lanjut dengan perkembangan baru |
| `standard` | default berita |
| `brief` | satu media, signifikansi ≤2, atau utilitas singkat |

### 4.2 Riset — meja bahan

Bukan agen yang menjelajah. Pipeline deterministik dengan daftar izin:

| Sumber | Diambil | Batas |
|---|---|---|
| Artikel klaster | teks penuh via ekstraktor bacaan | domain di `config/feeds.yaml` |
| Edisi/topik lampau | apa yang sudah kita katakan | 14 hari |
| Sumber primer | `.go.id`, OJK, BPS, putusan pengadilan | hanya URL yang muncul di klaster atau peta entitas |
| Wikipedia / glosarium | latar | sudah ada (`backgroundCandidates`) |
| Fact-check | TurnBackHoax, ClaimReview | sudah ada |
| GDELT | arsip | sudah ada (`backfill:gdelt`) |

**Keluaran**

```jsonc
{
  "topic_id": "t_kpk_pertanahan",
  "items": [
    {
      "id": "s1", "kind": "article", "outlet": "kompas.com",
      "url": "https://...", "published_at": "2026-11-10T14:02:00+07:00",
      "tier": 2, "text": "…isi terekstrak ≤ 6000 karakter…",
      "fetched_at": "2026-11-11T05:10:00+07:00", "hash": "a1b2c3d4"
    }
  ],
  "missing": ["Nilai setoran yang diduga"],
  "budget": { "fetched": 7, "max": 10 }
}
```

**Bila bahan kurang.** Writer boleh mengembalikan `needs[]` (maksimum 3 butir). Riset menjalankan **satu** putaran tambahan (maksimum 4 pengambilan per topik), lalu writer menulis ulang sekali. Tidak ada putaran ketiga.

**Keamanan**

- teks dibungkus `<<<DATA>>> … <<<END DATA>>>` dan model diberi tahu bahwa isi itu bukan instruksi,
- baris yang menyerupai perintah ("abaikan instruksi", "tulis bahwa…") dibuang sebelum masuk prompt,
- URL hanya boleh berasal dari daftar izin; URL yang diusulkan model tidak pernah diambil,
- `robots.txt` dihormati, tanpa melewati paywall, simpan kutipan secukupnya.

### 4.3 Writer — meja tulis

**Masukan:** topik, `answers[]`, material pack, ringkasan pemberitaan sebelumnya, `depth` target, batas karakter.

**Keluaran**

```jsonc
{
  "title": "…", "angle": "…", "dek": "…",
  "body": ["…", "…", "…"],
  "citations": [
    { "paragraph": 0, "sources": ["s1", "s2"] },
    { "paragraph": 1, "sources": ["s3"] },
    { "paragraph": 2, "sources": ["s1"] }
  ],
  "action": "…",
  "claim": "…",
  "explain": [{ "q": "…", "a": "…", "source_key": "g1" }],
  "depth_achieved": "standard",
  "depth_change": null,
  "needs": []
}
```

**Aturan**

| Depth | Body | Kata | Sumber minimum |
|---|---|---:|---|
| `brief` | 1–2 paragraf | 150–250 | 1 |
| `standard` | 3–6 paragraf | **300–600** | 2 |
| `deep` | 8–18 paragraf | **1.200–2.500** | 3, rentang ≥7 hari untuk `deep_dive` |

Target panjang diukur dalam **kata**, bukan karakter. Tiap paragraf 400–1.000
karakter. `read_min` dihitung 200 kata/menit (4–15 menit untuk `deep_dive`).

**Panjang bersifat advisory.** `D-LEN` tidak memblokir dan tidak memicu retry
otomatis. Writer diberi target di prompt; bila hasilnya lebih pendek, itu dicatat
sebagai advisory. Fakta dan kejelasan lebih penting daripada memenuhi jumlah kata.

- Setiap paragraf wajib punya ≥1 `source_id` yang ada di paket. `source_id` asing → kartu ditolak.
- Kalimat kausal tanpa kutipan wajib ditandai sebagai inferensi.
- `needs` hanya berisi hal yang **tidak ada** di paket, bukan permintaan menambah gaya.
- Writer boleh mengusulkan `depth_change` (+ alasan). Editor yang meratifikasi; writer tidak menaikkan sendiri.

### 4.4 Editor — meja periksa

**Dua lapis.**

Lapis 1 — deterministik (tanpa LLM), memakai `validate.ts` + aturan baru:

| Kode | Periksa |
|---|---|
| `D-LEN` | panjang body sesuai depth |
| `D-CITE` | setiap paragraf punya sitasi valid |
| `D-SRC` | jumlah/tier sumber memenuhi depth |
| `D-EXP` | `explain` 2–4, bersumber, tidak mengulang body |
| `D-TITLE` | tidak terpotong, ≤70, bukan kapital semua |
| `D-CAUS` | regex penanda kausal tanpa atribusi |
| `D-NUM` | angka tanpa satuan/tanggal |
| `D-BAN` | frasa terlarang ("media berbohong", "sengaja disembunyikan") |

Lapis 2 — LLM, hanya untuk yang tidak bisa diputuskan aturan:

```jsonc
{
  "verdict": "revise",              // approve | revise | reject
  "findings": [
    {
      "code": "E-SRC",
      "severity": "blocking",       // blocking | advisory
      "paragraph": 1,
      "quote": "Pemerintah menduga BP memilih fokus…",
      "issue": "Kata 'menduga' tidak punya sumber; s1 hanya memuat pernyataan AKR.",
      "fix": "Hapus atribusi ke pemerintah atau ganti dengan kutipan s1."
    }
  ],
  "answers_covered": [0, 1, 3],
  "answers_missing": [2],
  "depth_check": "deep",            // brief | standard | deep | too_thin
  "category_check": "policy"        // null bila setuju
}
```

Kode temuan: `E-FACT`, `E-SRC`, `E-DEPTH`, `E-COH`, `E-CAUS`, `E-DUP`, `E-CAT`, `E-SAFE`, `E-TONE`, `E-ATTR`, `E-NUM`; aturan: `D-TYPO`, `D-TRUNC`.

**Kebijakan terbit: hanya tiga hal yang memblokir.**

| Kode | Arti | Blokir? |
|---|---|---|
| `E-FACT` | sumber yang disitasi **secara eksplisit bertentangan** dengan klaim; wajib membawa kutipan sumber | ✅ |
| `D-TYPO` | kata ganda, spasi ganda, kutip/kurung tidak seimbang, sisa markdown, id bahan bocor | ✅ |
| `D-TRUNC` | judul terpotong/berakhir di kata sambung, paragraf tanpa tanda akhir, teks berakhir `…` | ✅ |
| `E-SRC` | klaim tidak ditemukan di bahan (belum tentu salah) | ❌ advisory + catatan |
| `E-ATTR`, `E-CAUS` | atribusi/kausal belum terlacak | ❌ advisory + catatan |
| `E-SAFE` | risiko hukum/pencemaran nama baik | ❌ advisory + catatan `risk` |
| `E-DEPTH`, `E-COH`, `E-DUP`, `E-CAT`, `E-TONE`, `E-NUM` | cakupan/gaya/kategori | ❌ advisory |
| `D-LEN`, `D-CITE`, `D-SRC`, `D-EXP`, `D-TITLE`, `D-NUM`, `D-BAN` | panjang, sitasi, konteks | ❌ advisory |

**Kelayakan berita adalah wewenang planner.** Editor tidak boleh menahan terbit
karena artikel "kurang penting", "kurang panjang", atau "sudutnya mirip".
Hal-hal itu menjadi advisory dan catatan, bukan gerbang.

**Penjaga E-FACT.** `E-FACT` hanya blocking bila `quote` berisi kalimat sumber
yang benar-benar ada di bahan yang disitasi (≥60% kata ≥4 huruf cocok). Tanpa
itu, temuan turun ke advisory. Ini mencegah editor memblokir edisi dengan
"fakta salah" yang tidak ada di sumber.

**Fakta bersitasi tidak butuh atribusi prosa.** Kalimat yang sudah punya entri
`citations` tidak perlu "menurut X" di dalam teks. `E-ATTR` hanya untuk kutipan
langsung, angka yang diperdebatkan, dan klaim kausal.

**Kewenangan**

| Temuan | Akibat |
|---|---|
| `E-FACT`, `D-TYPO`, `D-TRUNC` | kartu wajib diperbaiki; bila tetap gagal, **kartu itu** gugur |
| `advisory` | tidak menghalangi; dicatat sebagai catatan atau advisory set |
| `reject` hanya untuk `E-FACT` | kartu gugur; edisi tetap terbit dengan kartu lain |

**Perbaikan fakta sebelum gugur.** `E-FACT` tidak langsung menggugurkan kartu.
Writer mendapat satu putaran perbaikan terarah (`repairFactDraft`) yang hanya
mengubah bagian yang ditandai:

1. hapus klaim yang bertentangan, atau ganti dengan versi yang didukung kutipan;
2. bila sumber saling bertentangan, tulis bahwa versinya belum konsisten;
3. **jangan menambah angka, nama, tanggal, atau peristiwa baru** yang tidak ada di bahan.

Setelah perbaikan, editor memeriksa ulang. Hasilnya:

| Hasil | Tindakan |
|---|---|
| `E-FACT` hilang | kartu lanjut terbit |
| `E-FACT` tetap, sumber **saling bertentangan** | **terbit dengan `disclaimer` kuat**; `E-FACT` turun ke advisory |
| `E-FACT` tetap, **fakta terbukti salah** dan tidak bisa diperbaiki | kartu **gugur** |
| `E-FACT` tetap, tetapi repair menambah angka/detail yang tidak ada di bahan | **terbit dengan disclaimer + `unresolved`**; `E-INVENT` dicatat |

Kasus terakhir adalah keputusan produk: writer yang mencoba mengarang tidak
disembunyikan, tetapi juga tidak otomatis membunuh artikel. Pembaca melihat
"Yang belum terjawab", dan planner menerima catatan verifikasinya.

**Batas loop:** maksimum **2** putaran revisi per kartu, ditambah **1** putaran
perbaikan fakta. Perbaikan dikirim ke **writer**, bukan dikerjakan editor.
Setelah itu: **sempitkan lingkup**, jangan menambah putaran. Kartu yang masih `E-FACT`/typo/terpotong **gugur**, bukan
menahan seluruh edisi.

**Sempitkan lingkup (bukan revisi ketiga).** Bila setelah batas masih ada
`answers_missing`:

1. buang pertanyaan wajib yang tidak dijawab bahan (`answers` ← `answers_covered`),
2. turunkan depth bila editor menilai `too_thin` (`deep → standard → brief`),
3. tulis ulang sekali dengan judul/sudut yang sesuai isi, lalu edit sekali,
4. bila masih ada `E-FACT`/typo/terpotong: kartu **gugur**.

Kartu yang gugur tidak diganti paksa; jumlah kartu turun dan `truncated_reason` diisi.

### 4.5 Desk — meja terbit

**Masukan:** ringkasan edisi saja (id, tipe, judul, dek/kalimat pertama, verdict editor, jumlah sitasi, kategori, depth, tanda suasana hati) + laporan validasi.

**Gerbang deterministik lebih dulu** (`validateEdition()` hari ini, ditambah):

- 5–8 kartu nasional / 2–5 lokal / 3–6 mingguan,
- maksimum 2 kartu meta, `|gap_rank| ≥ 5`, ambang debat,
- tidak ada `topic_id` ganda,
- `reading_time_min` sesuai target,
- `status: terkonfirmasi` punya tier 1.

**Yang tidak lagi memblokir:** sudut kembar, kedalaman tipis, sitasi tidak
lengkap, kategori kurang tepat. Semua itu advisory. Newsworthiness sudah
diputuskan planner, jadi desk tidak boleh mengulanginya.

**Satu panggilan LLM** hanya untuk pertanyaan yang tidak bisa dihitung:

```jsonc
{
  "publish": false,
  "reasons": ["c3 dan c6 membahas sudut yang sama dari isu pertanahan"],
  "rework": [
    { "card_id": "c6", "instruction": "Ambil sudut dampak ke petani, bukan proses hukum" }
  ]
}
```

**Kewenangan:** desk tidak boleh menambah kartu baru di luar hasil seleksi,
tidak boleh menaikkan `status`, dan tidak boleh menerbitkan edisi yang gagal
validasi. Desk **menggugurkan kartu** yang masih `E-FACT`/typo/terpotong, lalu
menerbitkan sisanya. Maksimum **1** putaran rework untuk kartu yang gugur.

Vonis LLM desk bersifat advisory. Publikasi ditentukan aturan; LLM tidak bisa
menahan edisi karena "kurang layak" atau "sudut mirip".

### 4.6 Catatan editor — utang liputan

Temuan editor tidak semuanya cacat tulisan. Sebagian adalah **hal yang tidak bisa
dijawab bahan hari ini**. Bagian itu tidak dibuang; ia disimpan sebagai catatan
dan menjadi kandidat artikel berikutnya.

**Apa yang menjadi catatan, apa yang diperbaiki sekarang:**

| Temuan | Perlakuan |
|---|---|
| `D-*` (panjang, sitasi, judul, frasa terlarang) | cacat tulisan → writer memperbaiki sekarang |
| `E-COH`, `E-TONE`, `E-NUM` | cacat tulisan → advisory, bukan backlog |
| `E-DEPTH` / `answers_missing` | **`coverage_gap`** — pertanyaan pembaca yang belum dijawab bahan |
| `E-SRC` blocking | **`verification_gap`** — klaim yang belum didukung sumber yang disitasi |
| `E-ATTR` blocking | **`verification_gap`** — atribusi yang belum terlacak |
| `E-SAFE` blocking | **`risk`** — catatan hukum, bukan ide artikel |

**Bentuk catatan**

```jsonc
{
  "id": "n_kpk_pertanahan_3f2a1c9d",
  "topic_id": "t_kpk_pertanahan",
  "thread_title": "KPK periksa kepala pertanahan",
  "kind": "coverage_gap",
  "question": "Berapa nilai setoran yang diduga diterima?",
  "detail": "Bahan hanya menyebut dugaan setoran; tidak ada angka resmi.",
  "origin": { "edition_id": "2026-11-10", "card_title": "KPK periksa…", "code": "E-DEPTH", "paragraph": 1 },
  "status": "open",
  "first_seen": "2026-11-10T20:00:00+07:00",
  "last_seen": "2026-11-10T20:00:00+07:00",
  "attempts": 1,
  "weight": 3,
  "next_action": "Cari rilis resmi KPK atau putusan pengadilan.",
  "expires_at": "2026-12-25T20:00:00+07:00",
  "resolved_by": null
}
```

**Siklus hidup**

| Status | Arti | Peralihan |
|---|---|---|
| `open` | belum tertutup, layak dikerjakan | dibuat dari temuan editor |
| `waiting` | belum ada bahan baru setelah 14 hari | otomatis; tidak ditawarkan terus-menerus |
| `answered` | draft baru benar-benar menjawabnya | editor mengisi `notes_answered` |
| `dropped` | kedaluwarsa atau tidak relevan | TTL: 45 hari (celah), 21 hari (verifikasi), 30 hari (risiko) |

**Dedupe.** Catatan digabung bila `topic_id` dan `kind` sama serta kemiripan
pertanyaan (Jaccard kata ≥4 huruf) ≥ **0,55**. Penggabungan menaikkan
`attempts`, memperbarui `last_seen`, dan tidak membuat duplikat lintas hari.

**Kontrak planner.** Planner menerima `catatan_terbuka` (maksimum 12, tanpa
`risk`). Aturannya: jadikan tindak lanjut **hanya bila ada bahan baru atau
perkembangan**; bila tidak, biarkan catatan terbuka. Tugas yang menutup catatan
mengisi `note_ids`.

**Kontrak editor.** Editor menerima catatan yang relevan dengan topik dan
mengisi `notes_resolved` hanya jika body benar-benar memuat jawabannya, dengan
`quote` kalimat draft yang menjawab. Sistem memverifikasi bahwa kutipan itu ada
di body (≥70% kata ≥4 huruf cocok). Tanpa kutipan yang cocok, catatan tidak
ditutup. Ini mencegah catatan ditutup karena judulnya mirip.

**Tampilan publik.** Kartu membawa `unresolved: string[]` (0–3 pertanyaan) yang
diturunkan dari catatan `coverage_gap` untuk topik itu. Renderer menampilkannya
sebagai kotak **"Yang belum terjawab"** setelah baris tindakan. Ini bukan
catatan internal: ia memberi tahu pembaca apa yang belum bisa dipastikan, tanpa
mengklaim lebih dari yang bahan mendukung.

**Batas.** Catatan adalah state pipeline, bukan bagian `edition.json`
(edisi tetap immutable, I1). Catatan `risk` tidak pernah menjadi ide artikel dan
tidak pernah ditampilkan ke pembaca. Catatan tidak boleh memuat id bahan atau
nama tersangka di luar konteks yang sudah terbit.

**Catatan internal tidak dipotong.** `editor_notes` menyimpan pertanyaan hingga
1.200 karakter, detail hingga 8.000, dan tindakan hingga 1.200. Temuan editor
disimpan hingga 4.000 karakter. Pemendekan hanya terjadi pada field publik —
`unresolved` (120) dan `disclaimer` (320) — yang memang dibatasi skema. Jadi
catatan yang dibaca planner tidak kehilangan konteks karena batas tampilan.

---

## 5. Kepemilikan field

| Field | Mengusulkan | Memutuskan | Catatan |
|---|---|---|---|
| `title`, `body`, `action` | Writer | Editor (setuju/tolak, tanpa menulis ulang) | satu suara |
| `angle` | Planner | Writer menyempitkan; Editor memeriksa koherensi | |
| `category` | Planner | Editor boleh mengoreksi | koreksi yang mengubah `heavy`/slot memicu seleksi ulang kartu itu |
| `depth` | Planner | Writer boleh mengusulkan, Editor meratifikasi | aturan panjang di §4.3 |
| `sources` | Riset | Editor memvalidasi; Writer mengutip | |
| `status`, `truth`, `confidence` | — | **aturan** (`computeTruth`) | model tidak pernah menilai keyakinan |
| `explain` | Writer memilih | Editor memeriksa | sumber hanya dari kandidat |
| jumlah/urutan kartu | — | **aturan** (`select`) | |
| terbit | — | Desk + `validateEdition` | |

---

## 6. Anggaran, loop, dan tenggat

| Hal | Nilai awal |
|---|---|
| Panggilan per edisi | 20–32 |
| Token per edisi | ~60–90 ribu |
| Putaran riset tambahan | 1 per topik |
| Putaran revisi writer | 2 per kartu |
| Putaran rework desk | 1 per edisi |
| Tenggat lunak | 20 menit setelah mulai |
| Tenggat keras | 25 menit |

**Degradasi berurutan saat anggaran habis:** lewati editor untuk kartu tersisa → pakai writer deterministik → terbitkan kartu yang sudah lolos → `truncated_reason`.

Feature flag:

| Env | Nilai | Arti |
|---|---|---|
| `NEWSROOM_PLAN` | `off` \| `shadow` \| `on` | `shadow`: planner dipanggil, hasil hanya dicatat |
| `NEWSROOM_RESEARCH` | `off` \| `on` | artikel penuh + paket material |
| `NEWSROOM_EDIT` | `off` \| `shadow` \| `on` | `shadow`: temuan dicatat, tidak memblokir |
| `NEWSROOM_DESK` | `off` \| `on` | rework edisi |
| `NEWSROOM_BUDGET_USD` | angka | plafon biaya per edisi |

---

## 7. Penyimpanan dan reproduksibilitas

```sql
-- teks penuh artikel, terpisah dari ingest agar tabel articles tetap ringan
CREATE TABLE article_text (
  url_hash     TEXT PRIMARY KEY,
  article_id   TEXT NOT NULL,
  text         TEXT NOT NULL,
  extractor    TEXT NOT NULL,
  fetched_at   TEXT NOT NULL
);

-- satu baris per panggilan model (INFRA.md §11.7)
CREATE TABLE llm_calls (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  edition_id   TEXT NOT NULL,
  topic_id     TEXT,
  role         TEXT NOT NULL,      -- plan | research | write | edit | review
  attempt      INTEGER NOT NULL,
  provider     TEXT NOT NULL,
  model        TEXT NOT NULL,
  tokens_in    INTEGER NOT NULL,
  tokens_out   INTEGER NOT NULL,
  cost_usd     REAL,
  latency_ms   INTEGER NOT NULL,
  created_at   TEXT NOT NULL
);

-- artefak per peran, agar run bisa diputar ulang tanpa membayar ulang
CREATE TABLE card_work (
  edition_id   TEXT NOT NULL,
  topic_id     TEXT NOT NULL,
  role         TEXT NOT NULL,
  attempt      INTEGER NOT NULL,
  input_hash   TEXT NOT NULL,
  output_json  TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (edition_id, topic_id, role, attempt, input_hash)
);

-- catatan editor (utang liputan); tidak dibaca aplikasi
CREATE TABLE editor_notes (
  id           TEXT PRIMARY KEY,
  topic_id     TEXT NOT NULL,
  kind         TEXT NOT NULL,      -- coverage_gap | verification_gap | risk
  question     TEXT NOT NULL,
  detail       TEXT NOT NULL,
  origin_json  TEXT NOT NULL,
  status       TEXT NOT NULL,      -- open | waiting | answered | dropped
  first_seen   TEXT NOT NULL,
  last_seen    TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 1,
  weight       INTEGER NOT NULL DEFAULT 1,
  next_action  TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  resolved_json TEXT,
  UNIQUE (topic_id, kind, question)
);
CREATE INDEX IF NOT EXISTS idx_notes_status ON editor_notes(status, expires_at);

-- antrean tindak lanjut
CREATE TABLE editorial_queue (
  topic_id     TEXT PRIMARY KEY,
  state        TEXT NOT NULL,      -- open | waiting | closed
  next_angle   TEXT,
  promised_at  TEXT,
  last_checked TEXT,
  closes_at    TEXT,
  close_reason TEXT
);
```

Kunci cache: `sha1(role + prompt_version + model + material_hashes + draft_hash)`.
Artefak mentah juga ditulis ke `data/work/{edition}/{topic}/{attempt}-{role}.json` (gitignored) agar bisa dibaca manusia saat debug.

---

## 8. Perubahan skema

| Hal | Perubahan | `schema_version` |
|---|---|---|
| `generated_by` | tambah **opsional** `plan`, `editor`, `review` | tetap (I7: tambah field opsional) |
| `citations`, `depth`, `answers[]` | **tidak masuk** `edition.json`; hanya artefak internal | — |
| Tabel baru | di luar kontrak aplikasi (I5) | — |

Dengan begitu, `schema/edition.schema.json` hanya perlu `properties` tambahan pada `generated_by`; `required` tidak berubah dan edisi lama tetap valid.

---

## 9. Dampak biaya dan latensi

| Peran | Panggilan | Perkiraan token masuk/keluar |
|---|---|---|
| Planner | 1 | 4k / 2k |
| Riset (pemilih) | 0–8 | 1k / 0,3k |
| Writer | 8–10 | 3k / 2k |
| Editor | 8–10 | 3k / 1k |
| Revisi | 2–4 | 3k / 1,5k |
| Desk | 1 | 5k / 1,5k |

Perkiraan: **~60–90 ribu token/edisi**, sekitar 3–4× pipeline sekarang. Pada `deepseek-chat` masih di kisaran sen per hari; yang perlu dijaga adalah latensi, bukan harga.

Latensi adalah risiko nyata karena adapter `opencode` menyalakan satu proses CLI per panggilan (`INFRA.md` §11.4). Dengan 30 panggilan dan konkurensi 4, perkiraan 3–6 menit. Jika melewati 30 panggilan, pindah ke `opencode serve` + SDK, atau kurangi peran (lihat §13).

---

## 10. Cara membuktikan peran ini berguna

Tanpa pengukuran, "lebih mendalam" hanya berarti "lebih panjang".

**Golden set:** 10 hari yang datanya masih ada, dijalankan dua kali (pipeline lama vs baru) dari klaster yang sama (adjudikasi di-cache).

| Metrik | Cara hitung | Sasaran |
|---|---|---|
| Claim support | % kalimat faktual dengan sitasi valid | ≥95% |
| Angle coverage | butir `answers[]` yang terjawab | ≥80% |
| Source diversity | media independen per kartu | ≥2 (standard), ≥3 (deep) |
| Depth | kata + fakta unik (angka, nama, tanggal) | naik ≥30% |
| Duplication | kemiripan dengan 7 edisi terakhir | turun |
| Revise success | temuan `blocking` yang hilang setelah revisi | ≥70% |
| Human rating | 1–5: berguna, mendalam, bisa dipercaya | ≥4 |
| Guardrail | publish rate, fallback rate, biaya, latensi, gagal validasi | tidak memburuk |

Penilaian manusia tetap diperlukan: `E-TONE` dan `E-DEPTH` mudah dipenuhi dengan prosa yang panjang tetapi kosong.

---

## 11. Fase implementasi

| Fase | Isi | Berkas utama | Selesai bila |
|---|---|---|---|
| **P0** | Instrumentasi: `llm_calls`, artefak kerja, golden set, harness A/B. Tanpa ubah perilaku | `src/core/telemetry.ts`, `scripts/eval.ts`, migrasi 004 | biaya per peran terlihat; A/B bisa dijalankan |
| **P1** | **Material**: ekstraksi teks penuh + material pack + sitasi di draft. Writer melihat isi artikel | `src/adapters/extract.ts`, `src/core/research.ts` | claim support ≥95%; depth naik; tidak ada regresi validasi |
| **P2** | Planner: `answers[]`, `depth`, tindak lanjut; `editorial_queue` | `src/core/plan.ts`, migrasi 005 | tindak lanjut muncul tanpa campur tangan |
| **P3** | Editor: pemeriksaan deterministik + temuan LLM + 1 loop revisi (mode `shadow` dulu) | `src/core/edit.ts` | ≥70% temuan blocking hilang setelah revisi |
| **P4** | Desk: gerbang edisi + 1 rework | `src/core/desk.ts` | tidak ada edisi terbit dengan sudut ganda |
| **P5** | Kalibrasi: ambang, biaya, latensi; editor/desk jadi `on` | konfigurasi | 5 edisi berturut-turut tanpa penurunan metrik |

Setiap fase punya flag dan bisa berhenti tanpa membatalkan fase sebelumnya. Uji memakai `LlmAdapter` palsu seperti `tests/writer-llm.test.ts`; tidak ada jaringan di `npm test`.

---

## 12. Risiko

| Risiko | Mitigasi |
|---|---|
| Editor dan writer berosilasi | maksimum 2 putaran; temuan wajib ber-kode; terima bila `blocking` hilang |
| Model mengarang sumber | `source_id` divalidasi terhadap paket; asing → tolak |
| Prompt injection dari artikel | penanda data, buang baris bergaya perintah, tanpa pengambilan URL dari model |
| Legalitas/ToS | daftar izin, tanpa paywall, simpan kutipan secukupnya, `robots.txt` |
| Tenggat 05.45 terlewat | anggaran, konkurensi, degradasi berurutan, tenggat keras |
| Biaya membengkak | plafon `NEWSROOM_BUDGET_USD`, cache hash, model murah untuk editor |
| Rubrik mengarah ke prosa panjang | metrik fakta unik + penilaian manusia, bukan jumlah kata |
| Kategori berubah setelah seleksi | koreksi editor memicu seleksi ulang satu kartu, bukan seluruh edisi |

---

## 13. Alternatif yang dipertimbangkan

| Opsi | Kelebihan | Kekurangan | Putusan |
|---|---|---|---|
| **A. Lima peran penuh** (usulan awal) | Pemisahan tugas jelas; mudah diaudit | 20–32 panggilan; latensi; lebih banyak tempat gagal | Dijadikan target akhir, bukan langkah pertama |
| **B. Dua peran: writer + editor, dengan material pack dan sitasi** | ~80% manfaat, ~40% biaya; dua loop saja | Perencanaan tindak lanjut tetap manual | **Direkomendasikan untuk P1–P3** |
| **C. Satu model agentic dengan tool** | Fleksibel; sedikit kode orkestrasi | Tidak reproducible; biaya tak terduga; gagal sulit dilokalisasi | Ditolak untuk pipeline harian |
| **D. Deterministik saja** | Nol biaya model; paling stabil | Tidak bisa menulis prosa yang bisa dibaca | Tetap menjadi lapisan validasi dan fallback |

Alasan B lebih dulu: kedalaman lahir dari **bahan dan sitasi**, bukan dari jumlah peran. Editor baru berguna setelah ada bahan untuk diperiksa. Planner baru berguna setelah ada state tindak lanjut.

---

## 14. Pertanyaan terbuka

| # | Pertanyaan | Menentukan |
|---|---|---|
| Q1 | Ekstraksi teks penuh: `@mozilla/readability` + `linkedom`, atau parser per domain? | cakupan & biaya P1 |
| Q2 | Berapa lama teks penuh disimpan? | ukuran DB, kepatuhan |
| Q3 | Editor memakai model yang sama atau lebih kuat dari writer? | biaya vs mutu temuan |
| Q4 | Apakah `E-DEPTH` boleh memblokir terbit, atau hanya menurunkan depth? | produk |
| Q5 | Batas kata `deep` untuk berita (bukan `deep_dive`): 4 paragraf cukup? | waktu baca |
| Q6 | Apakah tindak lanjut wajib muncul setiap kali dijanjikan? | kepercayaan pembaca |
| Q7 | Apakah `citations` ikut disimpan di `topics/*.json`? | audit jangka panjang |

---

## 15. Status POC (10 November 2026)

POC lima peran sudah berjalan untuk edisi `2026-11-10`, dibandingkan dengan
`data/editions/2026-11-10.nasional.json`. Artefak ada di
`data/work/poc-newsroom/` (gitignored), termasuk `report.md`.

```bash
LLM_PROVIDER=deepseek npm run poc:newsroom -- --date 2026-11-10 --limit 3 --revisions 2
```

### 15.1 Hasil

| Metrik | Edisi terbit | POC 5 peran | Perubahan |
|---|---:|---:|---:|
| Rata-rata karakter body | 1.067 | 1.474 | +38% |
| Rata-rata fakta unik (angka + nama) | 16,2 | 48,3 | +198% |
| Rata-rata sumber per kartu | 3,0 | 4,3 | +43% |
| Pertanyaan konteks | 3,0 | 3,0 | — |
| Paragraf bersitasi | 0 (tidak ada field) | 3/3 kartu | baru |
| Bahan tersedia bagi writer | 1.722 karakter | 8.835 karakter | +413% |
| Kartu siap terbit | — | **0/3** | gerbang menolak |

Biaya: **121.666 token masuk / 25.010 keluar**, 26 panggilan, ±4 menit.
Sekitar 3–4× pipeline sekarang.

Perbandingan kualitatif yang paling jelas: `deep_dive` edisi terbit berisi
**390 karakter** dalam 3 paragraf pendek. POC menghasilkan satu `deep_dive`
**1.787 karakter** dengan 6 media, dek, 4 paragraf, dan setiap paragraf
menunjuk bahan. Contoh lain: kartu DPR edisi terbit 3 paragraf tanpa sitasi;
POC 3 paragraf dengan 5 media dan pengakuan terbuka bahwa "delapan fraksi"
masih klaim, bukan kesepakatan resmi.

### 15.2 Yang bekerja

| Peran | Bukti |
|---|---|
| Planner | 10 tugas dari 22 topik; `answers[]` dan `depth` masuk akal; 9–10 detik |
| Riset | 3–4 halaman penuh per topik; bahan naik 5–10×; tanpa ini kedalaman tidak mungkin |
| Writer | Menulis 3–4 paragraf spesifik, menyitasi setiap paragraf, berani menyatakan "belum ada dalam bahan" |
| Editor | Menemukan cacat nyata: sitasi tidak cocok dengan klaim, kutipan dicampur parafrasa, angka diperdebatkan tanpa atribusi, tanggal saling bertentangan |
| Desk | Menolak set yang belum selesai; tidak memaksakan terbit |

### 15.3 Yang belum bekerja

1. **Gerbang terlalu ketat untuk model saat ini.** Setelah 2 revisi + penyempitan
   lingkup, setiap kartu masih menyisakan 2 temuan blocking. Temuannya sah,
   tetapi tidak dapat diselesaikan writer `deepseek-chat` dalam 2 putaran.
2. **Tidak ada kartu yang lolos.** Produk harian tidak boleh menghasilkan nol
   kartu. Perlu ambang terbit eksplisit: mis. blocking hanya untuk
   sumber/keselamatan, sedangkan ambiguitas yang sudah dinyatakan di teks
   menjadi advisory.
3. **Sumber primer nol** pada edisi terbit maupun POC. Riset baru mengambil
   artikel klaster; `.go.id`/OJK/BPS belum dicari aktif.
4. **Editor model sama dengan writer.** Belum ada data untuk memutuskan apakah
   model editor yang lebih kuat menurunkan temuan palsu atau justru menaikkan
   standar.

### 15.4 Bug yang ditemukan POC dan sudah diperbaiki

| Bug | Perbaikan |
|---|---|
| Judul terpotong di tengah kata ("Pendapa") | potong di batas kata + buang kata sambung di akhir |
| Sitasi menunjuk paragraf yang sudah tidak ada setelah revisi | normalisasi membuang indeks di luar body |
| Id bahan (`s1`, `s3`) bocor ke prosa | writer dilarang menulis id; normalisasi membuangnya |
| Pertanyaan wajib yang tidak bisa dijawab bahan | writer wajib menyatakan "belum tersedia"; setelah batas, pertanyaan dibuang |
| Editor menaikkan `E-COH`/`E-DEPTH` menjadi blocking | batas severity ditegakkan kode |
| Editor "menemukan" masalah yang tidak ada di sumber | kutipan temuan diuji ke bahan; gagal → advisory |
| Revisi dijalankan meski tidak ada temuan blocking | verdict otomatis `approve` bila blocking nol |

### 15.5 Catatan editor sebagai backlog

POC menyimpan temuan editor ke `data/work/poc-newsroom/ledger.json`. Pada run
10 November lahir **11 catatan**: 4 `coverage_gap` (partai yang mendukung/menolak
HMP, daftar 25 pati yang dimutasi, posisi LPSK, bantahan Ahrie) dan 6
`verification_gap` (antara lain nomor putusan MA, nilai transaksi BP/AKR, dan
rentang harga BBM). Satu catatan sudah `answered` karena draft berikutnya memuat
isi somasi Golkar.

Planner menerima daftar itu lewat `catatan_terbuka`. Pada uji `--plan-only`
dengan ledger yang sama, planner mengaitkan kembali ketiga tugas utama dengan
10 catatan lewat `note_ids`, tanpa menyalin pertanyaannya menjadi artikel baru.
Editor nanti yang memutuskan apakah catatan benar-benar tertutup
(`notes_answered`), bukan planner.

Alat bantu:

```bash
# bangun ulang ledger dari artefak, tanpa memanggil model
npm run poc:newsroom -- --date 2026-11-10 --rebuild-ledger --fresh-ledger

# lihat bagaimana planner memakai catatan (hanya 1 panggilan model)
LLM_PROVIDER=deepseek npm run poc:newsroom -- --date 2026-11-10 --plan-only
```

Efek yang diharapkan: kartu yang gagal hari ini tidak hilang, tetapi juga tidak
ditulis ulang dengan pertanyaan yang sama besok. Ia menjadi baris di antrean
dengan status, umur, dan tindakan berikutnya.

### 15.6 Gerbang terbit setelah kalibrasi

Percobaan pertama dengan gerbang sempit (hanya fakta/typo/terpotong) tetap
menghasilkan **0 dari 3 kartu**. Penyebabnya: `E-FACT` menyala pada konflik
antar-bahan yang justru sudah dinyatakan terbuka di teks — misalnya "satu
sumber menyebut 30 Oktober, sumber lain 30 November". Itu bukan fakta salah;
itu ketidakpastian yang jujur.

Aturan yang dipakai sekarang:

| Pemeriksaan | Blokir? |
|---|---|
| `E-FACT` + kutipan sumber cocok + paragraf tidak menyatakan konflik | ✅ |
| `E-FACT` + paragraf menyatakan "berbeda/satu menyebut/sumber lain" | ❌ → catatan |
| `E-FACT` yang issue-nya sendiri menyebut "konsisten/pertentangan internal" | ❌ → catatan |
| `D-TYPO` (kata ganda, tanda tak seimbang, id bocor) | ✅ |
| `D-TRUNC` (judul menggantung, paragraf tanpa akhir, `…`) | ✅ |
| lainnya | ❌ advisory |

Kartu yang gagal **gugur sendiri**; edisi tetap terbit dengan kartu lain.
Desk tidak menahan seluruh edisi karena satu kartu.

**Kotak publik.** Setiap kartu membawa `unresolved` (0–3 pertanyaan dari
`coverage_gap`). Renderer menampilkannya sebagai "Yang belum terjawab".
Dengan begitu, konflik tanggal atau angka yang belum bisa diputuskan tetap
terlihat oleh pembaca, tanpa membuat artikel itu berhenti terbit.

**Hasil setelah kalibrasi:** **3 dari 3 kartu terbit** — semuanya membawa
`disclaimer` kuat karena klaim yang sumbernya bertentangan. Tidak ada kartu yang
digugurkan. Panjang: 1.147 kata (DPR, `deep_dive`), 920 kata (Ahrie), 500 kata
(ESDM); target kata hanya advisory. Ledger berisi 15 catatan terbuka dan 53
catatan terjawab dengan kutipan draft.

Jalur perbaikan fakta benar-benar terpakai di ketiga kartu: writer menerima
temuan `E-FACT`, menulis ulang bagian yang bermasalah, editor memeriksa ulang,
dan karena konflik sumber tetap ada tanpa detail baru, kartu terbit dengan
peringatan — bukan digugurkan. Hanya fakta yang **terbukti salah** (bukan
konflik antar-sumber) yang masih menggugurkan kartu.

Pencocokan catatan memakai `threadMatch()` (irisan kata ≥3 huruf, ambang 0,4),
bukan hanya `topic_id`, karena slug POC berubah saat planner mengganti judul.
Di produksi `topic_id` registry tetap stabil, tetapi fallback ini tetap dipakai
untuk judul yang bergeser.

### 15.7 Keputusan yang diusulkan

1. **Jangan jadikan lima peran sebagai gerbang blocking pada rilis pertama.**
   Jalankan editor dan desk dalam `shadow` selama 5 edisi; catat temuan, jangan
   tahan terbit.
2. **Terbitkan berdasarkan gerbang deterministik + satu ambang editorial:**
   blocking hanya untuk `E-SAFE`, `E-SRC` yang terbukti, dan `E-CAT`.
   `E-ATTR`/`E-CAUS` yang tidak bisa diperbaiki dari bahan menjadi catatan
   transparansi di teks, bukan alasan menahan edisi.
3. **P1 (material + sitasi) adalah keuntungan terbesar per biaya.** Terapkan
   lebih dulu, bahkan tanpa planner/editor.
4. **Uji model editor yang lebih kuat** pada 3 topik yang sama sebelum
   memutuskan tier model.
5. **Tambahkan pencarian sumber primer** sebelum menaikkan standar editor;
   banyak temuan blocking lahir dari bahan yang memang tidak lengkap.

### 15.8 Panjang artikel dan waktu baca

Target baru: **300–600 kata** untuk berita harian dan **1.200–2.500 kata** untuk
bacaan mendalam. Ini mengubah produk secara mendasar:

| Susunan | Kata | Waktu baca (200 kata/menit) |
|---|---:|---:|
| 8 kartu × 300 kata | 2.400 | ±12 menit |
| 8 kartu × 600 kata | 4.800 | ±24 menit |
| 1 deep dive 1.200 kata + 4 kartu × 300 | 2.400 | ±12 menit |
| 1 deep dive 2.500 kata + 4 kartu × 300 | 3.700 | ±18 menit |

`REQUIREMENTS.md` menargetkan ±5 menit untuk 8 kartu. Target kata di atas tidak
kompatibel dengan angka itu. Pilihannya:

1. **Brief tetap pendek** (150–250 kata/kartu, seperti sekarang) dan artikel
   panjang hanya untuk `deep_dive`; atau
2. **Edisi menjadi majalah**: 3–5 artikel penuh, waktu baca 10–20 menit, dan
   prinsip "edisi berakhir dalam 5 menit" diganti.

POC memakai target kata sebagai **panduan**, bukan syarat. Artikel yang lebih
pendek tetap terbit bila faktanya kuat. Keputusan produk belum diambil.
