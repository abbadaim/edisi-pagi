# Infrastruktur — GitHub Actions, Turso, Pages

**Versi:** 0.1
**Status:** keputusan teknis
**Bergantung pada:** `SCHEMA.md` v0.2, `RANKING.md`
**Tanggal:** 10 November 2026

---

## 0. Keputusan

| # | Keputusan |
|---|---|
| N1 | Penjadwalan memakai **GitHub Actions** (cron 05:45 WIB). |
| N2 | State memakai **Turso** (libSQL, SQLite dialect). |
| N3 | Aplikasi dan data statis disajikan lewat **GitHub Pages** dari repo privat. |
| N4 | Notifikasi dikirim **Web Push** dari dalam workflow yang sama. |
| N5 | Pipeline adalah modul TypeScript portabel; adapter memisahkan lokal dan produksi. |

---

## 1. Arsitektur

```
GitHub Actions (cron 22:45 UTC / 05:45 WIB)
        │
        ├── fetch 12 RSS ────────────────────────┐
        ├── embedding + adjudikasi LLM            │
        ├── baca/tulis state ──► Turso (libSQL)  │
        ├── unduh 8 gambar → WebP                 │
        ├── tulis editions/, topics/, search/     │
        ├── commit → Git ──► GitHub Pages ──► PWA
        └── kirim Web Push ──► ponsel
```

Tidak ada server yang berjalan terus. Tidak ada cron di mesin lokal. Tidak ada Workers, tidak ada D1.

---

## 2. Penjadwalan

```yaml
# .github/workflows/daily.yml
on:
  schedule:
    - cron: "45 22 * * *"      # 22:45 UTC = 05:45 WIB (WIB tidak punya DST)
  workflow_dispatch:            # jalankan manual
```

| Hal | Nilai |
|---|---|
| Zona waktu | **Cron GitHub memakai UTC.** 05:45 WIB = 22:45 UTC hari sebelumnya. |
| Keterlambatan normal | 5–15 menit di bawah beban |
| Jeda minimum | 5 menit |
| Cabang | Hanya workflow di branch default yang dijadwalkan |
| Nonaktif otomatis | Setelah **60 hari tanpa aktivitas repo** |
| Kuota privat | 2.000 menit/bulan; satu job 4 menit ≈ 120 menit/bulan (6%) |

**Poin penting:** commit harian hasil pipeline otomatis menjadi "aktivitas repo", sehingga aturan nonaktif 60 hari tidak akan pernah terpicu selama sistem berjalan. Yang berbahaya justru berhenti menjalankan.

```yaml
concurrency:
  group: daily-edition
  cancel-in-progress: false     # jangan batalkan run yang sedang jalan
timeout-minutes: 20
permissions:
  contents: write               # untuk commit hasil
```

---

### 2.1 Workflow

`.github/workflows/daily.yml`

| Langkah | Perintah |
|---|---|
| migrasi | `npm run migrate` |
| tarik berita | `npm run ingest -- --since-hours 36` |
| edisi harian | `npm run build -- --thin` |
| mingguan (Minggu) | `npm run weekly -- --thin` — dicek dengan `TZ=Asia/Jakarta date +%u` |
| publikasi | `npm run publish` |
| notifikasi | `npm run push` |
| simpan | commit `data/` + `public/` |

**Determinisme adjudikasi.** Hasil adjudikasi disimpan di tabel `adjudications` dengan kunci `(edition_id, hash ringkasan klaster)`. Pada data yang sama, run berikutnya memakai cache — jadi edisi tidak berubah hanya karena pipeline dijalankan ulang. `--refresh` memaksa panggilan model baru.

**Persistensi state.** State SQLite hidup di `data/state/local.db` dan **tidak di-commit** (database biner harian membuat riwayat git membengkak). Di CI, folder `data/state` dipulihkan dan disimpan dengan `actions/cache` bergulir: kunci `edisi-state-<run_id>`, restore lewat kecocokan awalan `edisi-state-`. Setiap run memakai snapshot run terakhir, sehingga artikel, registry, adjudikasi, dan langganan push bertahan — prasyarat untuk rekap mingguan dan deep dive 7 hari. `npm run state:info` mencetak jumlah artikel sebelum ingest; kalau angkanya 0 di run kedua, cache tidak terbawa. Di lokal, `DATABASE_PATH` default `local.db` di akar repo. Ketika Turso dipakai, `DATABASE_PATH` diganti URL libSQL dan cache dihapus.

## 3. Turso

### 3.1 Kapasitas

| | Free tier | Perkiraan pemakaian | Rasio |
|---|---|---|---|
| Database | 100 | 1 | — |
| Penyimpanan | 5 GB | < 300 MB | 6% |
| Baris dibaca/bulan | 500 juta | ~300 ribu | 0,06% |
| Baris ditulis/bulan | 10 juta | ~65 ribu | 0,6% |

### 3.2 Koneksi

```
TURSO_DATABASE_URL = libsql://<db>-<org>.turso.io
TURSO_AUTH_TOKEN   = <token>
```

Dua kredensial di GitHub Secrets. Untuk pengembangan lokal:

```
TURSO_DATABASE_URL = file:./local.db      # tanpa token
```

Kode yang sama, hanya berbeda URL. Inilah alasan N5.

### 3.3 Migrasi

Migrasi disimpan sebagai berkas SQL bernomor dan dijalankan sekali di awal workflow:

```
migrations/
├── 001_init.sql
└── 002_add_angle.sql
```

Tabel versi:

```sql
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT);
```

Tidak memakai ORM. Skema di `CLUSTERING.md` §11 ditulis sebagai SQL biasa, sehingga bisa dijalankan di Turso maupun di `local.db` tanpa perbedaan.

### 3.4 Batasan libSQL yang perlu diingat

| Fitur SQLite | Tersedia di Turso |
|---|---|
| `FTS5` (full-text search) | ✅ |
| `json_extract` | ✅ |
| `VACUUM` | ❌ (dikelola server) |
| `ATTACH DATABASE` | ❌ |
| Transaksi interaktif panjang | ⚠️ batasi; gunakan batch pendek |

Karena pencarian dilakukan di sisi aplikasi (`search/hot.json`), `FTS5` tidak dibutuhkan. Bagus — tidak ada ketergantungan.

---

## 4. Gambar

### 4.1 Alur

```
og:image artikel  →  unduh  →  resize lebar 1200  →  WebP q78  →  simpan sebagai assets/{sha1}.webp
```

| Aturan | Nilai |
|---|---|
| Format | WebP, kualitas 78 |
| Lebar maksimum | 1200 px |
| Target ukuran | ≤ 90 KB (batas 200 KB) |
| Nama berkas | `{sha1_8}.webp` — content-addressed, immutable |
| Atribusi | `credit` wajib; `alt` wajib |
| Gagal unduh | pakai gambar fallback (§4.2), `fallback: true` |

### 4.2 Gambar fallback (>12 bulan)

Gambar berumur lebih dari 12 bulan dipangkas dari repo. Alih-alih `null`, kartu memakai gambar generik **per kategori** agar edisi lama tidak terlihat rusak.

```
assets/fallback/policy.webp
assets/fallback/economy.webp
assets/fallback/safety.webp
assets/fallback/health.webp
assets/fallback/culture.webp
assets/fallback/crime.webp
assets/fallback/disaster.webp
assets/fallback/sport.webp
assets/fallback/default.webp
```

Sembilan berkas, masing-masing ≤ 20 KB, total < 180 KB. Dibuat sekali, statis, tidak pernah berubah.

```jsonc
{ "url": "/assets/fallback/policy.webp", "credit": null, "alt": "Ilustrasi kebijakan", "fallback": true }
```

Renderer menandai `fallback: true` dengan perlakuan visual berbeda (tanpa atribusi, bisa diberi overlay tipis) supaya jelas itu bukan foto asli.

### 4.3 Pemangkasan

```
edition_id < hari ini − 365  →  gambar diganti fallback, berkas asli dihapus
```

Dijalankan dalam job mingguan terpisah, bukan di job harian, agar job harian tetap cepat dan idempoten.

**Dampak ukuran:**

| Isi | 1 tahun | 2 tahun |
|---|---|---|
| Gambar | ~263 MB | 263 MB (dipangkas) |
| JSON edisi | ~9 MB | ~18 MB |
| Indeks pencarian | ~17 MB | ~17 MB (90 hari panas + arsip) |
| **Total repo** | ~290 MB | ~300 MB |

Batas lunak GitHub Pages adalah 1 GB. Kita berada di sekitar 30%, dengan pertumbuhan datar setelah tahun pertama.

---

## 5. GitHub Pages

| Hal | Nilai |
|---|---|
| Sumber | Branch `main`, folder `/public` |
| Ukuran situs | Batas lunak 1 GB |
| Bandwidth | Batas lunak 100 GB/bulan |
| HTTPS | Otomatis |
| PWA | Service worker + manifest di `/public` |
| Ikon | `/public/icons/` — 192, 512, maskable-512, apple-touch-180, favicon-32, `icon.svg` (`REQUIREMENTS.md` §1.3) |
| Cache | `editions/*` dan `assets/*` immutable → `Cache-Control: max-age=31536000` |

Karena nama berkas gambar content-addressed dan edisi bersifat immutable, cache panjang aman. Yang butuh cache pendek hanya `manifest.json` dan `search/hot.json`.

`.nojekyll` wajib ada agar folder `_` tidak diabaikan.

---

## 5.1 Aplikasi (PWA)

```
public/
├── index.html          satu halaman, tanpa build step
├── app.js              fetch manifest -> render feed -> detail
├── style.css
├── sw.js               network-first untuk /data + manifest, cache-first untuk /assets
├── manifest.webmanifest
├── icons/
├── manifest.json       daftar edisi (dihasilkan scripts/publish.ts)
├── data/editions/*.json
└── assets/*.webp
```

| Perintah | Fungsi |
|---|---|
| `npm run publish` | validasi + salin edisi & aset ke `public/`, tulis `manifest.json` |
| `npm run serve` | server statis di `http://localhost:8080` |

**Aturan cache:** edisi dan manifest berubah setiap kali pipeline jalan, jadi **network-first** dengan cache sebagai cadangan offline. Gambar bersifat content-addressed dan tidak pernah berubah, jadi **cache-first**. Versi cache dinaikkan manual saat skema berubah.

**Edisi tipis.** `--thin` menerbitkan edisi yang kurang kartu (hanya `E001`/`E002` yang ditoleransi) untuk pengujian. Edisi dengan 0 kartu tetap tidak diterbitkan.

## 6. Web Push

Model A (`SCHEMA.md` §11): satu push per hari, payload generik.

| Langkah | Isi |
|---|---|
| 0 | `npm run gen:vapid` sekali; kunci publik masuk `public/config.json` |
| 1 | PWA meminta izin, membuat `PushSubscription`, menampilkan JSON untuk disalin |
| 2 | JSON itu disimpan sebagai secret `PUSH_SUBSCRIPTION`; workflow mengirim satu push |
| 3 | Payload: `{ edition_id, title, body, updates, url }` |
| 4 | Klik → buka `/?e=2026-11-10` |

```
VAPID_PUBLIC_KEY   → juga disimpan di /public/config.json
VAPID_PRIVATE_KEY  → GitHub Secret
```

Kirim memakai `web-push` di Node. Biaya nol. Tidak ada layanan pihak ketiga.

**Batas platform yang diterima:** iOS hanya menerima push jika PWA sudah dipasang ke home screen dan izin diberikan lewat gestur pengguna. Jika izin tidak diberikan, edisi tetap ada; hanya notifikasinya yang tidak muncul.

### 6.1 Push kedua: peringatan lokal

Satu-satunya pengecualian: peringatan lokal yang lolos ambang ketat (`REQUIREMENTS.md` §4.2, maks 2×/minggu). Dikirim dari job yang sama, dengan payload berbeda.

---

## 7. Ketahanan

| Kejadian | Perilaku |
|---|---|
| Satu feed RSS gagal | Lanjut; catat `feeds_failed`, edisi tetap terbit |
| Embedding API gagal | Retry 3×; jika tetap gagal, fallback ke klaster berbasis entitas saja |
| LLM adjudikasi gagal | 1 retry; lalu mode deterministik (`CLUSTERING.md` §7.3) |
| Turso tidak dapat dihubungi | Job gagal, tidak ada edisi, GitHub mengirim email kegagalan |
| Commit gagal | Job gagal; edisi sudah ada di disk runner tetapi hilang — dianggap gagal |
| Workflow terlewat sehari | Edisi kemarin tetap tersedia; manifest menandai `stale: true` |

### 7.1 Idempotensi

Pipeline **tidak menimpa** edisi yang sudah ada.

```
jika editions/{tanggal}.nasional.json ada dan tidak ada --force
   → keluar dengan kode 0
```

Ini membuat rerun aman, termasuk rerun otomatis setelah kegagalan jaringan.

### 7.2 Penanda basi

Jika `manifest.latest` lebih dari 36 jam, aplikasi menampilkan pita "Edisi belum diperbarui" alih-alih diam.

---

## 8. Pengembangan lokal

```bash
# jalan penuh untuk tanggal tertentu, database lokal, tanpa push
npm run pipeline -- --date 2026-11-10 --db file:./local.db --no-push

# hanya validasi edisi yang sudah ada
npm run validate -- editions/2026-11-10.nasional.json

# jalankan ulang fixture dan bandingkan
npm run replay -- fixtures/day-2026-11-10
```

Adapter dipilih dari URL database:

| `TURSO_DATABASE_URL` | Adapter |
|---|---|
| `file:...` | SQLite lokal (`better-sqlite3`) |
| `libsql://...` | Turso (`@libsql/client`) |

Struktur kode:

```
core/          pipeline, klastering, ranking, penulisan — tanpa impor platform
adapters/      db-turso.ts, db-sqlite.ts, storage-git.ts, push-webpush.ts
scripts/       validate.ts, replay.ts, prune-assets.ts, drift-report.ts
```

Aturan: `core/` tidak boleh mengimpor `fs`, `node:sqlite`, atau API Cloudflare. Semua I/O lewat `deps`.

---

## 9. Biaya

| Item | Biaya |
|---|---|
| GitHub Actions (privat, 120 menit/bulan) | $0 |
| GitHub Pages | $0 |
| Turso free | $0 |
| Embedding + LLM | < $1/bulan |
| Web Push (VAPID) | $0 |
| **Total** | **< $1/bulan** |

---

## 10. Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Turso bergabung dengan Supabase, harga berubah | Migrasi | Hanya SQL standar; `libsql` → SQLite/Postgres trivial |
| Cron GitHub tertunda > 1 jam | Edisi terlambat | Jadwal 05:45 memberi ruang; penanda `stale` |
| Repo tumbuh melebihi 1 GB | Pages menolak | Pemangkasan 12 bulan; gambar fallback |
| Kuota Actions habis | Tidak ada edisi | 6% pemakaian; turunkan frekuensi jika perlu |
| PWA iOS kehilangan push setelah update OS | Notifikasi hilang | Edisi tetap dapat diakses manual |
| Satu titik kegagalan: repo privat | Kehilangan seluruh arsip | Repo bisa di-clone; Turso punya point-in-time restore 1 hari |

---

## 11. Model bahasa (LLM)

Dua penyedia untuk v1. Keduanya di belakang satu antarmuka, sehingga `core/` tidak tahu mana yang dipakai.

### 11.1 Antarmuka

```ts
export interface LlmAdapter {
  readonly name: "opencode" | "deepseek" | "local";
  json<T>(req: { model: string; system: string; user: string; schema: unknown }): Promise<{ data: T; usage: Usage }>;
  text(req: { model: string; system: string; user: string }): Promise<{ text: string; usage: Usage }>;
  embed?(req: { model: string; texts: string[] }): Promise<{ vectors: number[][]; usage: Usage }>;
}
```

`core/` hanya memanggil `json`, `text`, dan `embed`. Tidak ada parameter khusus penyedia yang bocor ke atas.

### 11.2 Konfigurasi

**Yang dipakai pipeline sekarang:** satu penyedia (`LLM_PROVIDER`) dan satu model
(`OPENCODE_MODEL`) untuk semua peran. Blok `capabilities` per-kapabilitas di
bawah **belum terpasang** — `src/config/llm.ts` hanya menyediakan tipe dan
validator, belum dibaca `scripts/build.ts`. Jangan menjadikannya acuan.

```yaml
# RENCANA, belum aktif — jangan dikira konfigurasi berjalan.
capabilities:
  adjudicate: { provider: opencode, model: opencode-go/deepseek-v4.1-flash }
  write:      { provider: opencode, model: opencode-go/deepseek-v4.1-flash }
  verify:     { provider: opencode, model: opencode-go/deepseek-v4.1-flash }
  embed:      { provider: local,    model: Xenova/multilingual-e5-small }
```

| Env | Isi |
|---|---|
| `LLM_PROVIDER` | `opencode` (default) atau `deepseek`. Tanpa ini: opencode → deterministik. DeepSeek **tidak** dipakai otomatis (`DEC-0016`) |
| `OPENCODE_BIN` | Path CLI opencode jika tidak ada di PATH (mis. `~/.opencode/bin/opencode`) |
| `OPENCODE_MODEL` | Default `opencode-go/deepseek-v4.1-flash`; satu model untuk semua peran (`DEC-0017`) |
| `DEEPSEEK_API_KEY` | Hanya dipakai bila `LLM_PROVIDER=deepseek` (`DEC-0016`) |
| `DEEPSEEK_MODEL` | Default `deepseek-chat`; hanya untuk jalur opt-in itu |

**Urutan penyedia:** opencode → writer deterministik. DeepSeek hanya lewat
`LLM_PROVIDER=deepseek` (`DEC-0016`) dan tidak pernah menjadi cadangan otomatis.

- `probeOpenCode()` menjalankan `opencode --version` sekali di awal; kalau gagal, opencode dilewati tanpa memakan satu panggilan model.
- `listModels()` menjalankan `opencode models` sekali, lalu **memverifikasi model ada di katalog** sebelum satu panggilan pun (`DEC-0018`). Model yang tidak ada → penulis deterministik dengan log jelas, bukan kegagalan berulang di setiap kartu.
- Jika katalog tidak terbaca (server mati, waktu habis), penerbitan **tidak** diblokir: model dipakai dengan peringatan di log.
- Jika opencode terpasang tetapi gagal di tengah jalan (timeout, sesi error), tidak ada penyedia cadangan berbayar: panggilan itu gagal, dicatat, dan kartu ditulis deterministik. Edisi tetap terbit.

### 11.3 Adapter `deepseek`

- `https://api.deepseek.com`, format OpenAI-compatible.
- Model: `deepseek-chat`, `deepseek-v4-pro`. Nama model bisa berubah; **tidak ada verifikasi katalog** untuk jalur ini — kesalahan id model muncul sebagai error API pada panggilan pertama (jalur ini hanya aktif lewat `LLM_PROVIDER=deepseek`, `DEC-0016`).
- JSON output didukung. `response_format: { type: "json_object" }` + validasi skema.
- **Tidak ada endpoint embedding.** Konfigurasi yang menunjuk `embed` ke `deepseek` ditolak saat startup.
- Thinking mode: dimatikan untuk `write` (biaya), dibiarkan default untuk `verify`.

### 11.4 Adapter `opencode`

Dua mode, dipilih saat build:

| Mode | Cara | Kapan |
|---|---|---|
| CLI | `opencode run --model <provider/model> --format json` | Sederhana; 5–10 panggilan/hari masih wajar (~2–5 detik per proses) |
| Server | `opencode serve` + SDK | Jika panggilan > 30/hari, atau butuh streaming |

Model dipilih lewat id `provider/model` (mis. `opencode-go/deepseek-v4.1-flash`). Adapter memverifikasi model ada di katalog saat startup lewat `opencode models`, bukan menunggu kegagalan di tengah run (lihat §11.2 dan `DEC-0018`).

**CI.** Workflow memasang CLI dengan `curl -fsSL https://opencode.ai/install | bash`
dan mengimpor kredensial dari secret `OPENCODE_AUTH_JSON`
(`opencode auth export` → `opencode auth import`). Bila secret kosong, instalasi
dilewati dan pipeline memakai DeepSeek. Bila instalasi/impor gagal,
`OPENCODE_BIN` dipaksa ke path tidak ada agar probe gagal dan build tidak
menunggu timeout OpenCode.

### 11.5 Kapabilitas `embed`

Karena DeepSeek tidak punya embedding, tiga pilihan:

| Opsi | Kelebihan | Kekurangan |
|---|---|---|
| **`local`** — transformers.js + `multilingual-e5-small` | Gratis, offline, deterministik | Unduhan model ~120 MB sekali; +200–400 MB RAM |
| `opencode` | Sudah ada kredensial | Bergantung pada penyedia yang mendukung embedding |
| Tidak ada | Nol dependensi | Klastering kehilangan komponen cosine |

Rekomendasi: **`local`**. Untuk ~400 artikel/hari, satu model kecil sudah cukup, dan hasilnya tidak berubah antar-run — penting untuk `replay`.

### 11.6 Validasi startup

Pipeline menolak berjalan jika:

1. Penyedia tidak dikenal
2. `embed.provider = deepseek`
3. Model `opencode` tidak ada di katalog
4. `adjudicate` menunjuk model tanpa JSON mode
5. Kunci API yang dibutuhkan tidak ada di environment

Gagal di sini jauh lebih baik daripada gagal pukul 05.45 setelah 12 feed ditarik.

**Writer LLM vs deterministik.** Jika kunci ada, `scripts/build.ts` memakai `writer-llm.ts`: model menulis judul, isi, baris tindakan, dan memilih pertanyaan konteks dari kandidat yang diberikan (glosarium + ringkasan Wikipedia). Jika model gagal atau hasilnya tidak lolos validasi, kartu ditulis ulang oleh writer deterministik. Jadi kunci API meningkatkan kualitas, bukan menjadi syarat agar pipeline berjalan.

### 11.7 Pencatatan

Setiap panggilan menulis ke `llm_calls` (per panggilan) dan agregatnya ke
`run_log`. Tabel `llm_calls` menyimpan `role` (plan/write/edit/repair/desk/hoax),
`topic_id`, `attempt`, token, biaya, dan latensi; `run_log.llm_calls` menyimpan
jumlah panggilan per run.

```jsonc
{
  "capability": "adjudicate",
  "provider": "deepseek",
  "model": "deepseek-chat",
  "tokens_in": 2412,
  "tokens_out": 1180,
  "cost_usd": 0.0042,
  "latency_ms": 3810,
  "retry": 0
}
```

Setiap edisi menyimpan `generated_by` per kapabilitas, sehingga edisi lama bisa dijelaskan tanpa menebak.

### 11.8 Biaya

Pada volume ini (~8–12 ribu token/hari), `deepseek-chat` berada di kisaran **$0,01–0,03/hari**. `deepseek-v4-pro` untuk `verify` menambah sedikit. Embedding lokal nol.

---

## 12. Yang belum diputuskan

| # | Pertanyaan | Dampak |
|---|---|---|
| N6 | Job pemangkasan: mingguan atau bulanan? | Beban repo |
| N7 | Apakah `push_subscriptions` perlu enkripsi di Turso? | Privasi |
| N8 | Backfill 30 hari pertama: jalankan sekali atau bertahap? | Biaya LLM awal |
| N9 | Alert kegagalan: cukup email GitHub atau perlu kanal lain? | Keandalan operasional |
| N10 | Adapter `opencode`: mode CLI atau server? | Latensi vs kesederhanaan |
| N11 | Model `embed` final: `multilingual-e5-small` atau `bge-m3`? | Kualitas klastering |
