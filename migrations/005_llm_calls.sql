-- 005_llm_calls.sql
-- Telemetri per panggilan model (NEWSROOM-IMPLEMENTATION.md P1).
-- run_log tetap agregat per run; tabel ini menyimpan role, topik, dan latensi.

CREATE TABLE IF NOT EXISTS llm_calls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  edition_id  TEXT NOT NULL,
  topic_id    TEXT,
  role        TEXT NOT NULL,      -- adjudicate | plan | write | repair | edit | desk | hoax | fallback
  attempt     INTEGER NOT NULL DEFAULT 1,
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  tokens_in   INTEGER NOT NULL,
  tokens_out  INTEGER NOT NULL,
  cost_usd    REAL,
  latency_ms  INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_calls_edition ON llm_calls(edition_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_calls_role ON llm_calls(role, created_at);
