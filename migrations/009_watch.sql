-- 009_watch.sql
-- Pantau pembaca (rencana 022, fase 3).
--
-- Pertanyaan "pantau" dari aplikasi masuk ke ledger catatan yang sudah ada,
-- bukan tabel paralel: planner sudah membacanya (`plannerNotes`), kuota tindak
-- lanjut sudah menghitungnya, dan `markAnswered` sudah menutupnya hanya bila
-- ada kutipan di draft. Yang kurang hanya penanda asal dan tautan balik ke
-- baris `asks` di Supabase.

ALTER TABLE editor_notes ADD COLUMN source TEXT NOT NULL DEFAULT 'editor';
ALTER TABLE editor_notes ADD COLUMN source_ref TEXT;
ALTER TABLE editor_notes ADD COLUMN checked_at TEXT;

CREATE INDEX IF NOT EXISTS idx_notes_source ON editor_notes(source, status);
