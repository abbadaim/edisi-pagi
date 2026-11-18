# 024 — Jadwal dari luar GitHub (pg_cron → `repository_dispatch`)

```
Status: plan-draft
Kelas: infra
Dibuat: 2026-11-18
Diperbarui: 2026-11-18
Mockup: — (kelas infra)
```

## 1. Masalah

Cron GitHub tidak dikirim pada jamnya. Ia dikirim **berjam-jam kemudian**, dan
pada 2026-11-18 tidak dikirim sama sekali.

Selisih antara cron dan waktu dispatch sebenarnya (`gh run list --event schedule`):

| workflow | cron (UTC) | dispatch sebenarnya | selisih |
|---|---|---|---|
| edisi-harian | 22:45 | 11-13 02:57 · 11-14 02:42 · 11-15 02:09 · 11-16 02:24 · 11-17 04:47 | 3 j 24 m – 6 j 02 m |
| schedule-check | 00:15 | 11-13 06:33 · 11-14 06:11 · 11-15 06:19 · 11-16 06:18 · 11-17 07:47 | 5 j 56 m – 7 j 32 m |
| tanya | 18:15 | 11-17 20:57 | 2 j 42 m |

2026-11-18, kelima jendela lewat tanpa satu pun run:

```
22:45Z · 00:30Z · 02:30Z   (daily.yml — tiga lapis dari rencana 021)
00:15Z · 02:15Z            (schedule-check.yml)
→ dispatch manual 03:05Z baru menghasilkan run
```

Pelajaran dari rencana 021: menambah lapis cron tidak menolong bila yang
terlambat adalah **pengirimnya**, bukan satu trigger. Tiga lapis hanya
menumpuk di jendela yang sama, lalu semuanya berhenti di `edition-guard`.
`tanya.yml` tetap terkirim pada hari yang sama, dan tidak ada insiden GitHub
terbuka — jadi antreannya hidup, hanya macet berjam-jam.

Akibat bagi pembaca: edisi yang seharusnya pukul 05:45 WIB tiba pukul 09:00–12:00,
dan pada 2026-11-18 tidak tiba sama sekali sampai dipicu manual.

## 2. Keputusan yang akan diambil

Memindahkan **pemicu** jadwal harian ke luar GitHub: `pg_cron` di Supabase
memanggil `net.http_post` ke endpoint `repository_dispatch` tipe `build` pada
22:45 UTC (05:45 WIB), memakai Vault `gh_dispatch_url` / `gh_dispatch_token`
yang sudah dipakai tombol “Minta edisi” (DEC-0039).

Yang **tidak** berubah: `daily.yml` tetap satu-satunya yang membangun edisi,
`edition-guard` tetap penjaga idempoten (permintaan ganda berhenti <15 detik),
tiga cron GitHub tetap terpasang sebagai cadangan, dan tidak ada `--force`.
Tanggal yang sudah terbit tetap tidak pernah dibangun ulang.

## 3. Rencana

1. **Pemeriksaan awal** (SQL Editor, sebelum apa pun): ekstensi terpasang?
   worker hidup? `cron.timezone` apa? Lihat §4.
2. `supabase/005_schedule.sql` — fungsi `public.dispatch_build()` yang membaca
   dua secret Vault lalu `net.http_post` `event_type: build`; `cron.schedule`
   dengan `'45 22 * * *'`. Diakhiri komentar berisi perintah verifikasi.
3. Dashboard Supabase → Database → Extensions: aktifkan `pg_cron` dan `pg_net`
   (pg_net sudah aktif sejak `002_dispatch.sql`).
4. `docs/PLAN-INDEX.md`, `AGENTS.md` §1 (baris CI) — setelah `tested`.
5. `docs/learnings/2026-11.md` — angka selisih di §1 sebagai bukti.

Tidak menyentuh `scripts/build.ts`, `edition-guard`, atau isi edisi.

## 4. Kontrak (infra)

**Pemeriksaan awal**, dijalankan di SQL Editor sebelum memasang apa pun:

```sql
-- 1. sudah terpasang?
select extname, extversion from pg_extension where extname in ('pg_cron','pg_net');
-- 2. tersedia untuk dipasang? (bila #1 kosong)
select name, default_version, installed_version
  from pg_available_extensions where name in ('pg_cron','pg_net');
-- 3. zona yang benar-benar dipakai pg_cron
select name, setting, source, context from pg_settings where name like 'cron.%';
-- 4. zona sesi — hanya untuk membaca hasil
show timezone;
select now(), now() at time zone 'UTC' as utc;
```

Bukti worker hidup (bukan sekadar ekstensi terpasang) — jadwalkan probe satu
menit, tunggu, lalu cabut:

```sql
select cron.schedule('probe-utc', '* * * * *', $$select now()$$);
select jobid, jobname, schedule, active from cron.job;                    -- active = t
select status, start_time, start_time at time zone 'UTC' as start_utc,
       return_message
  from cron.job_run_details order by start_time desc limit 3;              -- succeeded
select cron.unschedule('probe-utc');
```

Keluaran yang diharapkan setelah `005_schedule.sql` dipasang dijalankan:

```sql
select jobid, jobname, schedule, active from cron.job;
--  1 | edisi-harian-dispatch | 45 22 * * * | t

select status_code, created from net._http_response order by created desc limit 3;
--  204 | 2026-11-19 22:45:0x+00   ← 204 = GitHub menerima dispatch
```

Di GitHub, dalam ±60 detik setelah 22:45 UTC:

```
gh run list --workflow daily.yml --limit 1
# event harus repository_dispatch, bukan schedule
```

Bila cron GitHub kebetulan menang lebih dulu, run dispatch berhenti sendiri:

```
guard: 2026-11-19 sudah terbit — dilewati
```

`pg_cron` membaca `cron.timezone` (default **GMT**), bukan `TimeZone` sesi —
`show timezone` menjawab pertanyaan yang salah. Nilainya hanya bisa diubah
lewat `postgresql.conf` (`ALTER SYSTEM` + restart, konteks postmaster), jadi di
Supabase ia praktis selalu GMT dan jadwalnya selalu UTC:

```sql
select name, setting, source, context from pg_settings where name like 'cron.%';
-- cron.timezone | GMT | ... | postmaster
```

`'45 22 * * *'` berarti 22:45 UTC = 05:45 WIB — sama dengan cron GitHub, jadi
tidak ada konversi. Kalau `cron.timezone` ternyata bukan GMT (mis. `Asia/Jakarta`),
tulis `'45 5 * * *'` dan catat nilai `setting`-nya di kepala berkas SQL.

Jangan menyimpulkan dari `start_time` di `cron.job_run_details`: kolom itu
`timestamptz` dan ditampilkan menurut zona sesi. Bandingkan dengan
`start_time at time zone 'UTC'`.

## 5. Tes

- `tests/schedule-dispatch.test.ts` — membaca `supabase/005_schedule.sql` dan
  mengunci: tepat satu `cron.schedule` harian, jam `45 22`, `event_type` `build`,
  dan tidak ada `--force`/`client_payload` yang menimpa penjaga.
  Tes ini **gagal sebelum** berkas SQL ada.
- `gh run list --workflow daily.yml --event repository_dispatch --limit 1` pada
  hari pertama sesudah aktif.
- Satu run CI penuh yang dimulai oleh dispatch (bukan `schedule`) dan berakhir
  `verdict` hijau (`DEC-0040`).

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| `pg_cron` tidak tersedia untuk proyek ini | cron GitHub tetap ada; jangan hapus tiga lapis itu sebelum dispatch terbukti 3 hari berturut |
| Dispatch ganda (pg_cron + cron GitHub) | `edition-guard`; run kedua berhenti <15 detik, tidak menimpa |
| Token Vault kedaluwarsa | `net._http_response` 401; `schedule-check` tetap memeriksa hasil dan memicu run |
| Jam server bukan UTC | `show timezone` sebelum menetapkan jadwal; dicatat di berkas SQL |
| Build 14–20 menit, lalu `schedule-check` 07:15 bentrok | penjaga idempoten + `concurrency: edisi-pipeline` |

Rollback: `select cron.unschedule('edisi-harian-dispatch');` lalu `drop function
public.dispatch_build();`. Tidak ada data yang perlu dikembalikan.

## 7. Riwayat

- `2026-11-18` — `plan-draft` — dibuat setelah 0 dari 5 jendela cron terkirim
  dan edisi 2026-11-18 hanya terbit lewat dispatch manual.
- `2026-11-18` — `plan-draft` — §4 diperbaiki: `show timezone` bukan penentu
  jadwal; pg_cron membaca `cron.timezone` (default GMT) dan di Supabase praktis
  tidak bisa diubah. Ditambah probe satu menit untuk membuktikan worker hidup.

## 8. Pelajaran (diisi setelah `shipped`)

—
