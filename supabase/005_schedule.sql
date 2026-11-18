-- supabase/005_schedule.sql
-- Pemicu jadwal dari luar GitHub (rencana 024, DEC-0041).
--
-- Latar: cron GitHub di repo ini tidak dikirim pada jamnya. Selisih terukur
-- 13–17 November: jadwal 22:45 UTC baru dikirim 02:09–04:47 UTC, jadwal
-- 00:15 UTC baru 06:11–07:47 UTC. Pada 2026-11-18 kelima jendela lewat tanpa
-- satu pun run; edisi hanya terbit setelah dispatch manual.
--
-- pg_cron di Supabase memicu `repository_dispatch` tipe `build` pada 22:45 UTC.
-- Tiga cron GitHub tetap terpasang sebagai cadangan; `edition-guard` di job
-- `check` membuat run duplikat berhenti <15 detik dan tidak pernah menimpa
-- edisi yang sudah terbit. Tidak ada `--force`.
--
-- Prasyarat, diperiksa 2026-11-18 di proyek ivpvbwyqwtzfjcurezle:
--   pg_cron 1.6.4 terpasang; worker sudah ada di shared_preload_libraries
--   cron.timezone = GMT (postmaster — tidak bisa diubah di Supabase)
--   probe '* * * * *' berstatus succeeded pada 04:00:00 dan 04:01:00 UTC
--   Vault: gh_dispatch_url + gh_dispatch_token (dipakai juga oleh 002/004)
--
-- Jalankan di SQL Editor SETELAH 001, 002, dan 004. Berkas ini idempoten:
-- menjalankannya dua kali tidak menambah job kedua.

create or replace function public.dispatch_build()
returns void
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  endpoint text;
  token    text;
begin
  select decrypted_secret into endpoint from vault.decrypted_secrets where name = 'gh_dispatch_url';
  select decrypted_secret into token    from vault.decrypted_secrets where name = 'gh_dispatch_token';

  if endpoint is null or token is null then
    raise warning 'dispatch_build: Vault belum diisi; dispatch dilewati';
    return;
  end if;

  -- pg_net asinkron: kegagalan dispatch tidak boleh menggagalkan job.
  -- Hasilnya dibaca dari net._http_response (204 = GitHub menerima).
  perform net.http_post(
    url     := endpoint,
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || token,
                 'Accept',        'application/vnd.github+json',
                 'Content-Type',  'application/json',
                 'User-Agent',    'edisi-pagi-cron'
               ),
    body    := jsonb_build_object(
                 'event_type', 'build',
                 'client_payload', jsonb_build_object('source', 'pg_cron')
               ),
    timeout_milliseconds := 5000
  );
end;
$$;

-- Hanya pemilik job (postgres) yang perlu memanggilnya. Tanpa ini, default
-- Postgres memberi EXECUTE ke PUBLIC; skema public terekspos PostgREST.
revoke all on function public.dispatch_build() from public;
revoke all on function public.dispatch_build() from anon, authenticated;

-- 22:45 UTC = 05:45 WIB. `cron.timezone = GMT`, jadi jangan menulis 05:45.
-- Idempoten: job dengan nama sama dicabut dulu supaya jadwal berubah bila
-- angka di bawah nanti diedit.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'edisi-harian-dispatch') then
    perform cron.unschedule('edisi-harian-dispatch');
  end if;
end
$$;

select cron.schedule(
  'edisi-harian-dispatch',
  '45 22 * * *',
  'select public.dispatch_build()'
);

-- Periksa setelah dipasang:
--   select jobid, jobname, schedule, active from cron.job;
--   --  1 | edisi-harian-dispatch | 45 22 * * * | t
--
--   select status, to_char(start_time at time zone 'UTC','YYYY-MM-DD HH24:MI') as at_utc
--     from cron.job_run_details order by start_time desc limit 3;
--   --  succeeded | 2026-11-19 22:45   (start_time ditampilkan menurut zona sesi)
--
--   select status_code, content, created from net._http_response
--    order by created desc limit 3;
--   --  204 | [kosong] | 2026-11-19 22:45:0x+00   ← 204 = GitHub menerima
--
--   gh run list --workflow daily.yml --limit 1   -- event: repository_dispatch
--
-- Rollback:
--   select cron.unschedule('edisi-harian-dispatch');
--   drop function public.dispatch_build();
