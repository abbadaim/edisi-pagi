-- 003_adjudications.sql
-- Simpan hasil adjudikasi per (edisi, hash masukan).
-- Tanpa ini, dua run pada data yang sama bisa menghasilkan topik berbeda,
-- dan edisi "berubah" tanpa berita yang berubah.

CREATE TABLE IF NOT EXISTS adjudications (
  edition_id  TEXT NOT NULL,
  input_hash  TEXT NOT NULL,
  output_json TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (edition_id, input_hash)
);
