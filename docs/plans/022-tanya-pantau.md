# 022 — Tanya AI dan pantau pertanyaan pembaca

```
Status: plan-approved
Kelas: infra + pipeline + UI
Dibuat: 2026-11-16
Diperbarui: 2026-11-17
Mockup: belum ada — wajib untuk paruh UI (§4.2)
```

> Rencana ini menambah komponen pertama di luar GitHub Actions/Pages. Paruh
> infra + pipeline boleh jalan lebih dulu; paruh UI menunggu `mockup-approved`
> menurut `docs/WORKFLOW.md`.

---

## 1. Masalah

Aplikasi hari ini satu arah. Pembaca hanya bisa membaca; tidak ada jalur untuk
menitipkan pertanyaan, dan tidak ada yang mengingat pertanyaan itu besok.

Tiga fakta yang membuka jalan, bukan asumsi:

1. **Slot nav sudah kosong.** `latest_by_scope.lokal` selalu `null` sejak
   rencana 019, dan `public/app.js:329-338` menyaring edisi lewat peta itu. Tab
   Sleman tidak ditampilkan; tidak ada tab yang perlu dihapus. `atur`
   (`public/app.js:257-262`) membuktikan nav sudah menerima item non-scope.
2. **Mesin pertanyaan sudah ada.** `editor_notes` menyimpan pertanyaan yang tidak
   terjawab bahan, `plannerNotes()` memberikannya ke planner
   (`scripts/build.ts:233`), `markAnswered()` menutupnya hanya bila ada kutipan
   di draft. Yang tidak ada: pertanyaan yang berasal dari pembaca.
3. **Watchlist sudah dirancang, tabelnya menganggur.** `RANKING.md` §6.5
   menulis siklus `luput → mulai_diliput → ditutup` dengan `last_checked`,
   `closes_at`, `close_reason`; `migrations/001_init.sql:98` membuat tabel
   `gap_watch` yang **tidak dibaca kode mana pun**. Pertanyaan pembaca adalah
   `gap_watch` yang ditulis manusia.

Bukti angka dari telemetri sendiri:

| Hari | Panggilan | Token (`tokens_in + tokens_out`) |
|---|---:|---:|
| 2026-11-12 (edisi normal, 8 kartu) | 15 | 184.000 |
| 2026-11-11 (POC, revisi) | 176 | 1.314.582 |

Artinya batas token **tidak boleh global**: 1,31 juta pernah terjadi pada hari
yang sah. Batas per-peran (`role='ask'`) di atas anggaran edisi.

Hasil probe OpenCode 2026-11-16 (lihat §4.1): `--standalone run --auto` punya
tool `websearch`, selesai 11,6 s, dan stream `--format json` memuat
`tool_use` + `input.query` + `output` (URL dan cuplikan). Probe juga menemukan
risiko: kutipan model diambil dari **cuplikan mesin pencari**, bukan dari
halaman sumber.

Tiga temuan probe yang langsung mengubah rencana:

- **`websearch` tidak bisa dipakai CI.** Di profil lokal ia bekerja; di runner
  headless ia dipanggil tiga kali dan gagal tiga kali:
  `Cancelled a request for input this run cannot answer: Web Search`,
  `providerCall.executed: false` (run `44007186384`). `--auto` tidak menolong
  karena yang diminta bukan izin, melainkan masukan yang tidak bisa diberikan
  proses non-interaktif. **`webfetch` justru berhasil** di run yang sama
  (dipanggil 1x, berhasil 1x). Karena itu pencarian menjadi urusan pipeline,
  dan pengambilan halaman boleh memakai `webfetch`.
- Model gratis **terbukti jalan di CI**: `cost: 0`, token tercatat
  (11.413 masuk / 51 keluar pada langkah pertama), dan ada di katalog profil
  `--standalone`.
- `src/adapters/llm/resolve.ts:47` memakai `catalog.includes(model)`.
  Katalog hanya memuat `provider/model` **tanpa** varian, sehingga
  `opencode/deepseek-v4.1-flash-free#low` akan dianggap tidak ada dan seluruh
  jalur turun ke penulis deterministik (`DEC-0018`). Varian harus dilepas
  sebelum pencocokan.

---

## 2. Keputusan yang akan diambil

Menambah satu tab **Tanya AI** (menggantikan slot Sleman yang kosong) dengan dua
praktik yang berbagi satu tabel: `now` (tanya sekali, dijawab ~3 menit) dan
`watch` (pertanyaan tetap, diperiksa tiap pagi, nol token sampai ada bahan).
Batas tulis adalah **identitas Supabase Auth + RLS**, bukan PIN dan bukan token
perangkat. Jawaban tidak pernah menjadi kartu edisi dan tidak pernah menyentuh
`latest_by_scope`; edisi tetap immutable.

Yang **tidak** berubah: pipeline harian, gerbang terbit (`E-FACT`, `D-TYPO`,
`D-TRUNC`), kuota tindak lanjut, `LOCAL_EDITION=1` (rollback rencana 019 tetap
ada), dan janji satu push per hari.

DEC yang diusulkan: `DEC-0031` identitas sebagai batas tulis; `DEC-0032` jawaban
bukan edisi; `DEC-0033` sitasi diverifikasi pipeline; `DEC-0034` **pipeline yang
mencari dan mengambil bahan, model tidak mencari** (websearch headless tidak
tersedia — bukti run `44007186384`); `DEC-0035` tidak ada push untuk jawaban;
`DEC-0036` knob terstruktur di Supabase, prompt di git.

---

## 3. Rencana

### Fase 0 — probe (bukti, bukan kode)

| # | Probe | Status 2026-11-17 |
|---|---|---|
| 1 | Insert anon tanpa JWT ditolak, bukan 201 | **lolos** — `401 · 42501 permission denied for table asks` (ditolak di grant) |
| 2 | Insert dengan JWT → 201 + dispatch terpicu | **menunggu token** (dispatch baru ada di fase 4) |
| 3 | `?code=` selamat dari fallback navigasi service worker | **lolos** (statis: `public/sw.js:94-97` mengambil jaringan dulu untuk `mode === "navigate"`) |
| 4 | `websearch` tersedia di `--standalone run --auto`, dan stream memuat input/output tool | **gagal di CI** — berhasil lokal (11,6 s), tetapi runner headless menolak: `Cancelled a request for input this run cannot answer` (run `44007186384`). `webfetch` **berhasil** di run yang sama |
| 5 | model gratis + `#low` ada di katalog profil `--standalone` dan bisa dipanggil | **lolos lokal dan CI** — `cost: 0`, token tercatat |

Bukti probe 5 mentah: katalog `--standalone` memuat
`opencode/deepseek-v4.1-flash-free` (tanpa varian), dan `opencode auth export`
membawa dua kredensial Console `Personal`, bukan konfigurasi penyedia pencarian.

Probe 4 dan 5 harus diulang **di CI**, karena `opencode auth export` membawa
kredensial tetapi belum tentu membawa konfigurasi penyedia pencarian
(`DEC-0029`).

### Fase 1 — identitas dan setelan

1. Proyek Supabase; nonaktifkan pendaftaran publik.
2. `settings` (satu baris) dan `asks` + RLS owner-only (§4.3).
3. `#/atur` → bagian **Tanya AI**: masuk/keluar, model, varian, mode bawaan,
   pencarian on/off. Sesi disimpan; masuk sekali per perangkat.
4. `public/config.json` hanya memuat `supabaseUrl` + anon key (keduanya publik
   menurut desain; batasnya RLS).

### Fase 2 — pipeline tanya

1. `config/tanya.json` — lantai (baseline) bila `settings` tak terbaca.
2. `src/adapters/llm/resolve.ts` — cocokkan katalog setelah melepas `#varian`.
   Tanpa ini setiap model bervarian dianggap hilang dan jatuh ke deterministik.
3. `src/core/ask/retrieve.ts` — pertanyaan → entitas/topik (`registry.ts`) →
   edisi + `article_text`. Tanpa hasil → jawaban `belum ada bahan`.
4. `src/core/ask/answer.ts` — satu panggilan, rantai model dari setelan.
5. `src/core/ask/cite.ts` — **fetch setiap URL yang dikutip**, cocokkan n-gram
   ≥6 kata setelah normalisasi; gagal → sumber dibuang; habis → jawaban turun
   menjadi `belum ada bahan terverifikasi`.
6. `scripts/ask.ts` — ambil `state='new'` → `claimed` → jawab → validasi
   (`D-TYPO`, `D-TRUNC`, jumlah sitasi) → `answers/<id>.json` → PATCH.
7. `scripts/publish.ts` — salin `answers/`, tulis `tanya-config.json` (setelan
   efektif). `manifest.json` **tidak** disentuh.

### Fase 3 — pantau

1. `migrations/009_watch.sql` — `watch_items` terpisah dari `editor_notes`
   (pemilik berbeda, TTL berbeda: catatan editor `waiting` di 14 hari,
   pertanyaan pembaca 60 hari).
2. `src/core/newsroom/watch.ts` — murni: siklus, keputusan picu, promosi.
3. `scripts/watch.ts check` — SQL saja, nol token:
   `new = artikel topik itu dengan published_at > last_checked`.
   Kosong → lewati. Topik sudah masuk rencana → `diliput`, **tanpa** kartu baru.
   Sisanya → kandidat.
4. `scripts/build.ts` — tiga jahitan saja: periksa setelah ingest, suntik di
   `:281` (tempat `note_ids` sudah ditautkan), tutup setelah edit.
5. Kuota: kartu hasil pantau dihitung **tindak lanjut** (`selection.ts`, maks 3,
   nol berita baru = nol tindak lanjut).
6. `watch.json` diterbitkan; `#/pantau` membacanya.

### Fase 4 — jalur cepat

1. Trigger Postgres → `pg_net` → `repository_dispatch` (PAT di Vault, tidak
   pernah di klien), hanya untuk `user_id = owner` dan `mode='now'`.
2. `.github/workflows/tanya.yml`, `concurrency: { group: tanya }`.
3. `tanya-poll.yml` tiap 6 jam sebagai jaring: trigger terjadwal pernah dibuang
   (`DEC-0028`).
4. Batas: 30 tanya/hari (lunak), tanpa ulangan saat timeout (`DEC-0026`).

### Fase 5 — bahan di luar korpus

`websearch` headless tidak tersedia (bukti run `44007186384`), jadi model tidak
mencari. Urutannya dibalik: pipeline yang mengumpulkan bahan, model hanya
meringkas bahan yang diberikan — sama seperti writer.

1. `src/core/ask/gather.ts` — URL di luar korpus tanpa kunci API: sitemap outlet
   yang sudah dikenal (`primary.ts` P4b) + RSS yang sudah diingest. Bila kelak
   perlu kunci pencarian berbayar, itu keputusan tersendiri.
2. Isi halaman diambil adapter feed yang ada. `webfetch` hanya untuk URL yang
   sudah diambil alih pipeline, bukan URL yang dipilih model sendiri.
3. `cari.enabled` di `config/tanya.json`; mati = korpus saja.
4. Label sumber `luar` vs `bahan`; `luar` selalu butuh verifikasi kutipan.
5. `TANYA_TIMEOUT_MS` 300–360 s, terpisah dari 240 s writer, dan tidak diulang
   saat timeout (`DEC-0026`).

### Dokumen yang ikut berubah

`INFRA.md` (§1 "tidak ada server" diperjelas: Supabase = layanan terkelola,
bukan proses yang kita jalankan), `SCHEMA.md` (bentuk `answer.json`),
`DECISIONS.md` (enam DEC di §2), `PLAN-INDEX.md`.

---

## 4. Mockup / kontrak

### 4.1 Kontrak infra (perintah + keluaran yang diharapkan)

```bash
# probe 1 — anon tanpa JWT harus DITOLAK, bukan 201
curl -s -X POST "$SUPABASE_URL/rest/v1/asks" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H "content-type: application/json" \
  -d '{"mode":"now","question":"uji rls"}'
# harapan: http 401 + 42501. Bisa dua bentuk dan keduanya lulus:
#   "permission denied for table asks"   (ditolak di grant — yang terjadi 2026-11-17)
#   "new row violates row-level security" (ditolak di RLS)
# Yang GAGAL adalah 201, atau 401 yang pesannya "table not found".

# probe 2 — dengan JWT milik owner: 201, lalu dispatch
# harapan: 201 {"id":"...","state":"new"} ; `gh run list --workflow tanya.yml` bertambah

# probe 4/5 — dijalankan di CI oleh opencode-smoke.yml (advisory)
opencode --standalone models | grep -qx 'opencode/deepseek-v4.1-flash-free'   # harapan: ada
opencode --standalone run --model 'opencode/deepseek-v4.1-flash-free#low' \
  --format json --auto --archived 'Pakai tool webfetch pada <url>, balas JSON {"ok":true}'
# harapan: exit 0, satu event "tool_use" dengan part.tool == "webfetch" dan
#          part.state.status == "completed".
# JANGAN mengharapkan websearch: headless menolaknya
# ("Cancelled a request for input this run cannot answer", providerCall.executed
# false) — dibuktikan run 44007186384, dan itu yang mengubah fase 5.

# tanya
node scripts/ask.ts --id <ask_id>
# harapan: public/answers/<id>.json; npm run validate:answer lolos; PATCH state=answered

# pantau (tanpa jaringan, tanpa token)
npm run build -- --newsroom-limit 2 --thin --date 2026-11-17   # tanggal baru, bukan terbit
# harapan: satu kartu tindak lanjut, catatan tertutup dengan kutipan, tindak lanjut ≤3
```

### 4.2 Gerbang mockup UI

`#/tanya` adalah layar baru, bukan penyesuaian. Mockup wajib memakai token
`public/style.css` dan mencakup: keadaan kosong, antrean offline ("menunggu"),
jawaban dengan sitasi, jawaban `belum ada bahan`, daftar pantau
(`menunggu` / `mulai_diliput` / `diliput` / `ditutup`), dan layar masuk.

### 4.3 Kontrak data

```sql
create table settings (
  id boolean primary key default true check (id),
  owner uuid not null references auth.users(id),
  config jsonb not null,
  updated_at timestamptz not null default now()
);

create table asks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  mode text not null check (mode in ('now','watch')),
  question text not null check (length(question) between 4 and 500),
  topic_id text,
  state text not null default 'new'
    check (state in ('new','claimed','answered','refused','failed','stale')),
  attempts int not null default 0,
  answer_id text, error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);

alter table settings enable row level security;
alter table asks     enable row level security;
create policy owner_read   on settings for select using (auth.uid() = owner);
create policy owner_write  on settings for update using (auth.uid() = owner) with check (auth.uid() = owner);
create policy owner_insert on asks for insert with check (auth.uid() = user_id);
create policy owner_read_asks on asks for select using (auth.uid() = user_id);
```

`service_role` hanya di secret Actions; tidak pernah di `public/`.

DDL dijalankan dari `supabase/001_init.sql` (bukan `migrations/`, folder itu milik
SQLite — `scripts/migrate.ts:7`).

Hasil probe proyek 2026-11-16 (`ivpvbwyqwtzfjcurezle.supabase.co`, kunci
publishable):

| Periksa | Keluaran | Arti |
|---|---|---|
| `GET /rest/v1/` | `401 Secret API key required` | normal untuk format kunci baru; bukan masalah |
| `GET /rest/v1/asks` | `404 PGRST205 could not find table` | DDL belum dijalankan |
| `GET /auth/v1/settings` | `disable_signup: false` | **pendaftaran publik masih terbuka** — harus dimatikan |
| `GET /auth/v1/settings` | `mailer_autoconfirm: false` | jangan andalkan surel; buat pengguna lewat dasbor |
| `POST /rest/v1/asks` (anon) | `401 · 42501 permission denied for table asks` | ditolak di tingkat **grant**, sebelum RLS. Lebih kuat; `anon` sengaja tidak diberi hak |
| `grant` | `authenticated` butuh grant eksplisit | tanpa itu aplikasi yang sudah masuk ikut ditolak 42501 |

Bentuk jawaban (`public/answers/<id>.json`):

```json
{
  "schema_version": 1,
  "id": "a_...",
  "question": "...",
  "state": "answered",
  "answer": "...",
  "sources": [{ "url": "...", "outlet": "...", "tier": "bahan|luar", "quote": "...", "verified": true }],
  "unsupported": ["..."],
  "model": "opencode/deepseek-v4.1-flash-free#low",
  "config_hash": "…",
  "prompt_hash": "…",
  "created_at": "2026-11-17T05:50:00+07:00"
}
```

---

## 5. Tes

| Berkas | Perilaku yang dikunci |
|---|---|
| `tests/watch-lifecycle.test.ts` | `menunggu → mulai_diliput → diliput → ditutup`; 60 hari → `ditutup: tidak_ada_bahan` |
| `tests/watch-trigger.test.ts` | nol artikel baru = nol token; topik sudah di rencana = tanpa kartu baru |
| `tests/watch-budget.test.ts` | kartu pantau dihitung tindak lanjut; nol berita baru = nol kartu pantau |
| `tests/ask-cite.test.ts` | kutipan tidak ditemukan di halaman → sumber dibuang; semua gagal → `belum ada bahan terverifikasi` |
| `tests/ask-config.test.ts` | model di luar `uji` dijepit ke `bawaan`; `config_hash` berubah |
| `tests/llm-resolve.test.ts` | `provider/model#varian` dicocokkan ke katalog setelah varian dilepas; model asing tetap → deterministik |
| `tests/tanya-answer-schema.test.ts` | `answer.json` wajib lolos `D-TYPO`/`D-TRUNC` dan punya ≥1 sitasi `verified` |
| `tests/ui-static.test.ts` | item nav non-scope `tanya` ada; `manifest.latest_by_scope` tidak memuat `tanya` |
| `tests-ui/shell.spec.ts` | antrean offline: tanya saat offline → tampil `menunggu` → terkirim saat online |

---

## 6. Risiko dan rollback

| Risiko | Penjaga | Rollback |
|---|---|---|
| Kunci bocor | anon key publik menurut desain; `service_role` hanya secret | rotasi kunci; tab tetap mati |
| Spam insert | RLS owner-only; dispatch hanya untuk `user_id` owner | nonaktifkan trigger |
| Jawaban mengarang | `cite.ts` wajib fetch + cocokkan kutipan | `cari.enabled=false` |
| Websearch headless tidak tersedia (**terbukti**) | pencarian milik pipeline (`gather.ts`), model hanya meringkas bahan | `cari.enabled=false` |
| Pantau membanjiri edisi | dihitung tindak lanjut, maks 3, tetap lewat adjudikasi | `TANYA_OFF=1` menyembunyikan tab |
| Model gratis hilang | cek katalog `DEC-0018` → menolak, bukan mengarang | rantai ke model berbayar (≈$0.004/tanya) |
| Biaya/CI | `concurrency: tanya`, 30/hari | matikan workflow |

Edisi terbit **tidak pernah** tersentuh fitur ini: tidak ada kode di jalur ini
yang menulis `data/editions/`. Semua uji build memakai tanggal baru
(`--newsroom-limit 2 --thin`), bukan tanggal terbit.

---

## 7. Riwayat

- 2026-11-16 — `plan-draft` — dibuat. Fase 0: probe 3–5 lolos, probe 1–2
  menunggu proyek Supabase. Temuan: `websearch` milik Console, dan
  `resolve.ts:47` gagal mencocokkan model bervarian (`#low`).
- 2026-11-16 — `plan-draft` — proyek Supabase tersedia
  (`ivpvbwyqwtzfjcurezle`). `supabase/001_init.sql` ditulis. `disable_signup`
  masih `false`; probe 1–2 menunggu DDL dijalankan.
- 2026-11-17 — `plan-draft` — DDL + grant diterapkan, `disable_signup = true`,
  anon tertutup (probe 1 lolos di tingkat grant). Probe 2 menunggu token.
- 2026-11-17 — `plan-draft` — probe 4/5 diulang di CI (`opencode-smoke.yml`
  diperluas). Hasil: model gratis jalan (`cost: 0`), **websearch ditolak
  headless** (run `44007186384`), **webfetch berhasil**. Fase 5 dan `DEC-0034`
  dibalik: pencarian milik pipeline, bukan model.
- 2026-11-17 — `plan-approved` — disetujui manusia ("go ahead"). Fase 1 paruh
  pipeline mulai: `config/tanya.json`, penjepitan model, dan perbaikan
  pencocokan `#varian` di `resolve.ts`.
