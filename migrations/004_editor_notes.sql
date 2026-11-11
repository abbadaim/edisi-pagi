-- 004_editor_notes.sql
-- Catatan editor lintas hari (NEWSROOM.md §4.6).
-- Bukan bagian edition.json; aplikasi tidak pernah membacanya.

CREATE TABLE IF NOT EXISTS editor_notes (
  id            TEXT PRIMARY KEY,
  topic_id      TEXT NOT NULL,
  kind          TEXT NOT NULL,      -- coverage_gap | verification_gap | risk
  question      TEXT NOT NULL,
  detail        TEXT NOT NULL,
  origin_json   TEXT NOT NULL,
  status        TEXT NOT NULL,      -- open | waiting | answered | dropped
  first_seen    TEXT NOT NULL,
  last_seen     TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 1,
  weight        INTEGER NOT NULL DEFAULT 1,
  next_action   TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  resolved_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_notes_status ON editor_notes(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_notes_topic  ON editor_notes(topic_id, status);
