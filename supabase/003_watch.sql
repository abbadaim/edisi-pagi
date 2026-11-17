-- supabase/003_watch.sql
-- Keadaan pantau untuk aplikasi (rencana 022, fase 3).
--
-- `asks` sudah menyimpan pertanyaan; tiga kolom ini membuat aplikasi bisa
-- menampilkan "menunggu / mulai diliput / diliput / ditutup" dan menautkan ke
-- kartu yang akhirnya terbit. Tidak ada tabel baru: baris `asks` tetap satu-
-- satunya sumber yang dibaca aplikasi.
--
-- Aman dijalankan berulang.

alter table public.asks add column if not exists watch_state text;
alter table public.asks add column if not exists edition_id  text;
