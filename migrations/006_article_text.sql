-- 006_article_text.sql
-- Cache teks artikel penuh (NEWSROOM-IMPLEMENTATION.md prioritas 6).
-- Mengurangi fetch ulang saat retry, backfill, atau build ulang tanggal yang sama.

CREATE TABLE IF NOT EXISTS article_text (
  url_hash    TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  text        TEXT NOT NULL,
  extractor   TEXT NOT NULL,
  fetched_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_article_text_fetched ON article_text(fetched_at);
