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

## 7. Riwayat

- `2026-11-17` — `tested` — status.json, panel Atur, tombol minta edisi,
  `004_build_request.sql`; 353 uji lulus.
- `2026-11-17` — `tested` — bar progres build berjalan (queued/in_progress),
  auto-refresh 15 detik, `OPENCODE`-independent (hanya membaca Actions API).

## 8. Pelajaran (diisi setelah `shipped`)

—
