-- 007_social_cache.sql
-- Sinyal amplifikasi per (edisi, topik) agar build ulang tidak memanggil
-- Reddit/Trends/Detik lagi. Bukan data kebenaran; hanya untuk kartu meta.

CREATE TABLE IF NOT EXISTS social_cache (
  edition_id  TEXT NOT NULL,
  topic_id    TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at  TEXT NOT NULL,
  PRIMARY KEY (edition_id, topic_id)
);
