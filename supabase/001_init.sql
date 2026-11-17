-- supabase/001_init.sql
-- 021 — Tanya AI + pantau (rencana 021, DEC-0031 … DEC-0036)
--
-- Jalankan di Supabase → SQL Editor (bukan lewat `npm run migrate`; folder
-- `migrations/` milik SQLite lokal).
--
-- URUTAN BOOTSTRAP (penting, kalau dibalik Anda terkunci sendiri):
--   1. Authentication → Users → Add user (email Anda, "Auto Confirm User").
--      Jangan andalkan surel: proyek ini `mailer_autoconfirm = false` dan
--      pengirim bawaan Supabase dibatasi lajunya.
--   2. Jalankan berkas ini.
--   3. Authentication → Sign In / Providers → matikan "Allow new users to sign up"
--      (`disable_signup` masih `false` pada 2026-11-16).
--   4. Isi baris `settings` dengan uid Anda (lihat bagian 4 di bawah).

-- 1. Setelan (satu baris, selamanya)
create table if not exists public.settings (
  id         boolean primary key default true check (id),
  owner      uuid not null references auth.users (id) on delete cascade,
  config     jsonb not null,
  updated_at timestamptz not null default now()
);

-- 2. Pertanyaan: `now` (tanya sekali) dan `watch` (pertanyaan tetap)
create table if not exists public.asks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  mode       text not null check (mode in ('now', 'watch')),
  question   text not null check (char_length(question) between 4 and 500),
  topic_id   text,
  state      text not null default 'new'
             check (state in ('new', 'claimed', 'answered', 'refused', 'failed', 'stale')),
  attempts   int not null default 0,
  answer_id  text,
  error      text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);

create index if not exists idx_asks_state on public.asks (state, created_at);
create index if not exists idx_asks_owner on public.asks (user_id, created_at desc);

-- 3. RLS: identitas adalah satu-satunya batas tulis (DEC-0031).
--    Tidak ada policy untuk `anon` → anon ditolak oleh RLS, bukan oleh kode.
alter table public.settings enable row level security;
alter table public.asks     enable row level security;

drop policy if exists owner_read     on public.settings;
drop policy if exists owner_insert   on public.settings;
drop policy if exists owner_write    on public.settings;
drop policy if exists owner_insert   on public.asks;
drop policy if exists owner_read     on public.asks;

create policy owner_read   on public.settings for select using (auth.uid() = owner);
create policy owner_insert on public.settings for insert with check (auth.uid() = owner);
create policy owner_write  on public.settings for update using (auth.uid() = owner) with check (auth.uid() = owner);

create policy owner_insert on public.asks for insert with check (auth.uid() = user_id);
create policy owner_read   on public.asks for select using (auth.uid() = user_id);

-- 4. Setelah langkah 3, isi setelan awal. Ganti <UID> dengan id pengguna Anda
--    (Authentication → Users). Nilainya boleh kosong dulu: pipeline memakai
--    `config/tanya.json` selama baris ini belum ada.
--
-- insert into public.settings (owner, config) values (
--   '<UID>',
--   '{"model":{"bawaan":"opencode/deepseek-v4.1-flash-free#low",
--              "uji":["opencode/deepseek-v4.1-flash-free#high",
--                     "opencode-go/deepseek-v4.1-flash#low"]},
--     "mode":"ringkas",
--     "cari":{"enabled":true,"max_fetch":3,"izin_luar_bahan":true},
--     "bentuk":{"max_kata":180,"max_paragraf":4}}'::jsonb
-- );

-- 5. Catatan untuk fase 4 (jalur cepat): trigger dispatch TIDAK dibuat di sini.
--    Trigger hanya boleh menyala untuk `user_id` = pemilik settings dan
--    `mode = 'now'`, memakai `pg_net`, dengan PAT di Vault. Dibuat terpisah
--    setelah probe 1–2 lolos.
