-- supabase/002_dispatch.sql
-- Jalur cepat Tanya AI (rencana 022, fase 4): baris `asks` baru memicu
-- `repository_dispatch` di GitHub, sehingga jawaban datang dalam hitungan menit
-- alih-alih menunggu run harian.
--
-- Jalankan di SQL Editor SETELAH 001_init.sql. Sebelum menjalankan:
--
--   1. Buat fine-grained PAT untuk repo abbadaim/edisi-pagi dengan izin
--      "Contents: Read and write" (GitHub mewajibkan itu untuk /dispatches),
--      tanpa izin lain.
--   2. Simpan URL dan PAT di Vault lewat dua perintah di bawah, sekali saja.
--
-- Jangan simpan PAT di tabel biasa: siapa pun yang bisa membaca tabel itu akan
-- memegang izin tulis ke repo.

create extension if not exists pg_net;

-- Ganti nilainya sebelum menjalankan; keduanya hanya masuk Vault.
select vault.create_secret(
  'https://api.github.com/repos/abbadaim/edisi-pagi/dispatches',
  'gh_dispatch_url',
  'endpoint repository_dispatch untuk tanya'
);
select vault.create_secret(
  'github_pat_XXXXXXXX',
  'gh_dispatch_token',
  'PAT fine-grained: contents read/write'
);

/**
 * `security definer` diperlukan supaya fungsi boleh membaca Vault; tanpa itu
 * trigger berjalan sebagai pemanggil dan tidak bisa melihat secret.
 *
 * Hanya `mode = 'now'` yang memicu. `watch` dibuat lewat aplikasi dan tidak
 * perlu jawaban segera.
 */
create or replace function public.notify_tanya()
returns trigger
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  endpoint text;
  token    text;
begin
  if new.mode <> 'now' then
    return new;
  end if;

  select decrypted_secret into endpoint from vault.decrypted_secrets where name = 'gh_dispatch_url';
  select decrypted_secret into token    from vault.decrypted_secrets where name = 'gh_dispatch_token';

  if endpoint is null or token is null then
    raise warning 'notify_tanya: Vault belum diisi; dispatch dilewati';
    return new;
  end if;

  -- pg_net asinkron: insert tidak pernah menunggu GitHub. Kegagalan dispatch
  -- tidak boleh menggagalkan pertanyaan pembaca; jaring schedule di
  -- tanya.yml yang akan mengambilnya.
  perform net.http_post(
    url     := endpoint,
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || token,
                 'Accept',        'application/vnd.github+json',
                 'Content-Type',  'application/json',
                 'User-Agent',    'edisi-pagi-tanya'
               ),
    body    := jsonb_build_object(
                 'event_type', 'tanya',
                 'client_payload', jsonb_build_object('ask_id', new.id)
               ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

drop trigger if exists tanya_dispatch on public.asks;
create trigger tanya_dispatch
  after insert on public.asks
  for each row execute function public.notify_tanya();

-- Cara memeriksa setelah satu pertanyaan dikirim:
--   select id, status_code, content, created
--     from net._http_response order by created desc limit 5;
-- 204 = GitHub menerima dispatch. 401 = PAT salah/kedaluwarsa.
-- 404 = nama repo salah atau PAT tidak punya akses ke repo itu.
