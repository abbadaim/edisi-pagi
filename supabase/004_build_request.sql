-- supabase/004_build_request.sql
-- Tombol "Minta edisi hari ini" di tab Atur (rencana 023).
--
-- Satu baris `build_requests` memicu `repository_dispatch` bertipe `build`,
-- yang dijawab `daily.yml`. Penjaga idempoten di job `check` memastikan
-- permintaan yang terlambat tidak pernah menimpa edisi yang sudah terbit.
--
-- Jalankan di SQL Editor SETELAH 001 dan 002. Memakai Vault yang sama
-- (`gh_dispatch_url`, `gh_dispatch_token`), jadi tidak perlu PAT baru.
--
-- Cooldown 30 menit dibuat di server, bukan hanya di aplikasi: tombol yang
-- dipencet berulang tidak boleh menghabiskan menit runner.

create table if not exists public.build_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  requested_at  timestamptz not null default now(),
  status_code   integer,
  note          text
);

alter table public.build_requests enable row level security;

drop policy if exists "build_requests insert own" on public.build_requests;
create policy "build_requests insert own"
  on public.build_requests for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "build_requests select own" on public.build_requests;
create policy "build_requests select own"
  on public.build_requests for select to authenticated
  using (auth.uid() = user_id);

/**
 * Cooldown di server. Pesan `raise exception` diteruskan PostgREST sebagai
 * `message`, sehingga aplikasi bisa menampilkannya apa adanya.
 */
create or replace function public.guard_build_cooldown()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.build_requests
     where user_id = coalesce(new.user_id, auth.uid())
       and requested_at > now() - interval '30 minutes'
  ) then
    raise exception 'Tunggu 30 menit sebelum meminta edisi lagi';
  end if;
  return new;
end;
$$;

drop trigger if exists build_requests_cooldown on public.build_requests;
create trigger build_requests_cooldown
  before insert on public.build_requests
  for each row execute function public.guard_build_cooldown();

create or replace function public.notify_build()
returns trigger
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
    raise warning 'notify_build: Vault belum diisi; dispatch dilewati';
    return new;
  end if;

  -- pg_net asinkron. Kegagalan dispatch tidak menggagalkan insert; pembaca
  -- tetap melihat tombolnya berubah, dan `status.json` menunjukkan hasilnya.
  perform net.http_post(
    url     := endpoint,
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || token,
                 'Accept',        'application/vnd.github+json',
                 'Content-Type',  'application/json',
                 'User-Agent',    'edisi-pagi-build'
               ),
    body    := jsonb_build_object(
                 'event_type', 'build',
                 'client_payload', jsonb_build_object('request_id', new.id)
               ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

drop trigger if exists build_requests_dispatch on public.build_requests;
create trigger build_requests_dispatch
  after insert on public.build_requests
  for each row execute function public.notify_build();

-- GRANT wajib: RLS menentukan baris mana yang boleh disentuh, tetapi peran
-- tetap butuh izin tabel. Tanpa ini PostgREST menjawab
-- 42501 "permission denied for table build_requests" — sebelum RLS dinilai.
grant usage on schema public to authenticated;
grant select, insert on public.build_requests to authenticated;
grant select, insert, update on public.build_requests to service_role;

-- Periksa setelah menekan tombol:
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_name = 'build_requests';
--   select id, requested_at, status_code from public.build_requests order by requested_at desc limit 5;
--   select status_code, content from net._http_response order by created desc limit 5;
-- 204 = GitHub menerima dispatch. 401 = PAT, 404 = repo/izin.
