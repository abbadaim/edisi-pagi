# 023 — Laporan status dan tombol “Minta edisi” di aplikasi

```
Status: tested
Kelas: UI + infra
Dibuat: 2026-11-17
Diperbarui: 2026-11-17
Mockup: — (mengikuti pola panel Atur yang sudah ada)
```

## 1. Masalah

Pada 2026-11-17 tidak ada edisi sepanjang pagi. Penyebabnya bisa tiga hal yang
berbeda — cron dibuang, build gagal, atau build jalan tetapi tidak lolos
validasi — dan aplikasi tidak membedakannya:

- tab Edisi hanya kosong (“edisi tidak ditemukan”),
- `manifest.json` tetap menunjuk tanggal lama tanpa alasan,
- satu-satunya cara memicu build adalah `gh workflow run` di terminal.

Pembaca tidak bisa tahu apakah harus menunggu, dan tidak punya tombol untuk
meminta. Padahal `daily.yml` sudah punya penjaga idempoten (`edition-guard`),
jadi permintaan dari aplikasi aman: bila edisi sudah ada, run berhenti <15 detik.

## 2. Keputusan yang akan diambil

Menulis `public/status.json` setiap kali pemeriksaan kesehatan berjalan, dan
menambahkan panel **Edisi hari ini** di `#/atur`:

- menampilkan tanggal hari ini vs edisi terakhir, jumlah kartu, penulis, alasan
  (`no-edition`, `deterministic-writer`, …), waktu pemeriksaan, dan tautan run;
- menampilkan tombol **Minta edisi hari ini** hanya bila edisi hari ini belum
  ada, hanya untuk pengguna yang sudah masuk, dengan cooldown 30 menit di server;
- tombol menulis satu baris `build_requests`; trigger Supabase memanggil
  `repository_dispatch` `build` yang dijawab `daily.yml`.

Tidak ada `--force` dari aplikasi: membangun ulang tanggal yang sudah terbit
tetap keputusan manusia lewat terminal/UI Actions.

## 3. Rencana

1. `src/core/status.ts` — bentuk `status.json` + terjemahan alasan.
2. `scripts/health.ts` — `--status-out <path>`; memuat manifest dan URL run.
3. `.github/workflows/daily.yml` — langkah kesehatan menulis status tanpa
   `--strict`; job `verdict` memerahkan run setelah deploy; tambah
   `repository_dispatch: types: [build]`.
4. `public/index.html` + `public/app.js` — panel status, tombol, cooldown lokal,
   pesan galat dari PostgREST.
5. `supabase/004_build_request.sql` — tabel, RLS owner-only, cooldown 30 menit,
   trigger `net.http_post` memakai Vault yang sama dengan `002_dispatch.sql`.
6. `AGENTS.md` — catat alur dan cara memeriksa dispatch.

## 4. Kontrak

`public/status.json` (ditulis tiap langkah kesehatan):

```json
{
  "date": "2026-11-17",
  "checked_at": "2026-11-17T03:00:00.000Z",
  "ok": false,
  "cards": 0,
  "providers": { "adjudicate": "none", "write": "none", "verify": "none" },
  "reasons": ["no-edition"],
  "summary": "2026-11-17 nasional: edisi tidak terbentuk",
  "latest": "2026-11-16",
  "latest_by_scope": { "nasional": "2026-11-16", "lokal": null, "mingguan": "2026-11-16" },
  "run_url": "https://github.com/abbadaim/edisi-pagi/actions/runs/…"
}
```

Tombol:

```js
await sb("build_requests", { method: "POST", body: {}, prefer: "return=minimal" });
```

- RLS: insert hanya untuk `auth.uid() = user_id`.
- Grant: `grant select, insert … to authenticated` dan `… to service_role`.
  RLS tidak menggantikan grant; tanpa grant PostgREST menjawab 42501 sebelum
  RLS dinilai (pola yang sama dengan `001_init.sql`).
- Cooldown: `guard_build_cooldown()` menolak bila ada permintaan <30 menit;
  pesannya muncul apa adanya di panel.
- Dispatch: `event_type=build` → `daily.yml`; penjaga `check` yang menentukan
  apakah build benar-benar jalan.

Pemeriksaan setelah menekan tombol:

```sql
select id, requested_at, status_code from public.build_requests order by requested_at desc limit 3;
select status_code from net._http_response order by created desc limit 3;  -- 204 = diterima
```

## 5. Tes

- `tests/status.test.ts` — bentuk status + terjemahan alasan (2 uji).
- `tests/ui-static.test.ts` — `UI-06`: panel, pembacaan `status.json`, tombol,
  dan penulisan `build_requests` harus ada.
- Verifikasi fixture: panel menampilkan “belum terbit”, alasan, dan tautan run;
  tombol tidak muncul saat belum masuk.

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| Tombol dipencet berulang | cooldown 30 menit di server + tombol nonaktif lokal |
| Permintaan menimpa edisi terbit | tidak ada `--force`; `edition-guard` di job `check` |
| Dispatch gagal (PAT/repo) | insert tetap sukses, `status.json` menunjukkan hasil; `net._http_response` untuk diagnosis |
| `status.json` basi saat build gagal sebelum tulis | langkah kesehatan `if: always()`; bila tetap kosong, panel mengatakan “belum ada laporan” |
| Status dianggap janji waktu | teks menyebut “biasanya 10–20 menit”, bukan estimasi pasti |

Rollback: hapus panel dari `index.html`/`app.js`, hapus trigger `build` dari
`daily.yml`, `drop table public.build_requests`.

## 6b. Progres build (2026-11-17)

Panel juga membaca run terakhir `daily.yml` dari GitHub Actions API (publik,
tanpa token) dan menampilkan **bar progres berbasis waktu**:

- status `queued` → "Build dalam antrean GitHub";
- status `in_progress` → "Build berjalan N menit · perkiraan ±M menit lagi",
  bar diisi `elapsed / 14 menit`, berhenti di 94% supaya tidak pernah "penuh"
  sebelum edisi benar-benar ada;
- panel menyegarkan diri tiap 15 detik selama tab Atur terbuka, dan saat run
  selesai tanpa edisi menampilkan "Build selesai HH:MM tanpa edisi" plus alasan.

Perkiraan 14 menit diambil dari median run OpenCode (10–23 menit). Teksnya
menyebut "perkiraan", bukan janji; bar hanya indikator, bukan hitungan pasti.

## 6c. Uji end-to-end (2026-11-17)

Dijalankan terhadap proyek Supabase sungguhan, memakai service key dari
`.env.local` (tidak pernah masuk repo):

| Langkah | Hasil |
|---|---|
| `POST /rest/v1/build_requests` | **201**, baris `c35d5388…` |
| Dispatch GitHub | run `44051949912`, event `repository_dispatch`, **3 detik** setelah insert |
| Penjaga idempoten | `guard: 2026-11-17 sudah terbit — dilewati` **5 detik** setelah run mulai |
| Hasil run | `success`, tanpa menimpa edisi |

Cooldown diuji dengan memundurkan `requested_at` 90 menit lewat `PATCH`
(service_role punya UPDATE, tidak punya DELETE), supaya tombol pengguna tidak
terkunci oleh uji ini.

Temuan: tanpa `GRANT`, PostgREST menjawab **42501 sebelum RLS dinilai**; dan
grant default Supabase memberi `anon` `TRUNCATE`, yang tidak dilindungi RLS —
karena itu berkas ini mencabutnya.

## 6d. Revisi (2026-11-18) — `verdict` menilai ref yang salah

Run pertama sesudah rencana ini terpasang, `44227970274` (dispatch manual
2026-11-18 03:05Z), memberi hasil: `check` ✅ `build` ✅ `deploy` ✅
`verdict` ❌.

```
verdict  Run actions/checkout@v4  git log -1 --format=%H
verdict  …                       34e748975ce4d008e5cf25fe9b0d719d2671472c
verdict  Nilai kesehatan akhir    2026-11-18 nasional: edisi tidak terbentuk
verdict  …                        ✗ fatal: no-edition
```

`34e7489` adalah commit saat dispatch. `Simpan hasil` sudah mendorong
`16a4417 edisi 2026-11-18` pada 03:18:11, sedangkan `verdict` mulai 03:18:28 —
jadi ini bukan balapan, melainkan `ref:` yang salah. `actions/checkout` tanpa
`ref:` memakai `github.sha`, yang pada `workflow_dispatch`/`repository_dispatch`
menunjuk commit saat dispatch.

Akibat yang terlihat pembaca: edisi 2026-11-18 **terbit** (7 kartu,
`status.json` `ok: true`, `latest_by_scope.nasional = 2026-11-18`) tetapi run
tetap merah. Kalau dibiarkan, setiap build akan merah dan kasus `no-edition`
yang sesungguhnya tidak lagi bisa dibedakan.

Perbaikan: `verdict` checkout `ref: ${{ github.ref_name }}` (`DEC-0040`).
Kegagalan `Simpan hasil` tetap membuat verdict merah — itu memang tujuannya.

## 7. Riwayat

- `2026-11-17` — `tested` — status.json, panel Atur, tombol minta edisi,
  `004_build_request.sql`; 353 uji lulus.
- `2026-11-17` — `tested` — bar progres build berjalan (queued/in_progress),
  auto-refresh 15 detik, `OPENCODE`-independent (hanya membaca Actions API).
- `2026-11-17` — `tested` — `004` ditambah GRANT untuk `authenticated` dan
  `service_role`; versi pertama hanya RLS sehingga PostgREST menjawab 42501.
- `2026-11-17` — `tested` — uji end-to-end: insert 201 → dispatch 3 detik →
  guard 5 detik → run sukses. `anon` kehilangan TRUNCATE/REFERENCES/TRIGGER.
- `2026-11-18` — `tested` — `verdict` checkout `github.ref_name`, bukan
  `github.sha` (`DEC-0040`, §6d); `tests/workflow-verdict.test.ts` gagal pada
  YAML lama dan lulus sesudahnya.

## 8. Pelajaran (diisi setelah `shipped`)

—
