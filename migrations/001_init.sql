-- 001_init.sql — state pipeline (SQLite / libSQL)
-- Lihat CLUSTERING.md §11 dan INFRA.md §3.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

-- Artikel mentah setelah normalisasi
CREATE TABLE IF NOT EXISTS articles (
  id              TEXT PRIMARY KEY,
  url             TEXT UNIQUE NOT NULL,
  outlet          TEXT NOT NULL,
  published_at    TEXT,
  title_display   TEXT NOT NULL,
  title_norm      TEXT NOT NULL,
  lead            TEXT,
  simhash         INTEGER,
  is_duplicate_of TEXT,
  topic_id        TEXT,
  fetched_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_articles_topic ON articles(topic_id);
CREATE INDEX IF NOT EXISTS idx_articles_pub   ON articles(published_at);

-- Entitas dan IDF bergulir 30 hari
CREATE TABLE IF NOT EXISTS entities (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT,
  idf        REAL NOT NULL DEFAULT 0,
  last_seen  TEXT
);

CREATE TABLE IF NOT EXISTS article_entities (
  article_id TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  surface    TEXT,
  PRIMARY KEY (article_id, entity_id)
);

-- Topik = thread
CREATE TABLE IF NOT EXISTS topics (
  topic_id        TEXT PRIMARY KEY,
  canonical_title TEXT NOT NULL,
  kind            TEXT,
  first_seen      TEXT NOT NULL,
  last_updated    TEXT NOT NULL,
  revision        INTEGER NOT NULL DEFAULT 1,
  merged_into     TEXT,
  status          TEXT
);
CREATE INDEX IF NOT EXISTS idx_topics_updated ON topics(last_updated);

CREATE TABLE IF NOT EXISTS topic_aliases (
  topic_id TEXT NOT NULL,
  alias    TEXT NOT NULL,
  source   TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (topic_id, alias)
);

CREATE TABLE IF NOT EXISTS topic_entities (
  topic_id  TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  weight    REAL NOT NULL DEFAULT 1,
  PRIMARY KEY (topic_id, entity_id)
);

-- Riwayat klaim per revisi
CREATE TABLE IF NOT EXISTS revisions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id     TEXT NOT NULL,
  revision     INTEGER NOT NULL,
  edition_id   TEXT NOT NULL,
  claim_json   TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revisions_topic ON revisions(topic_id, revision);

-- Antrean alias (K3): hanya `active` yang berlaku
CREATE TABLE IF NOT EXISTS alias_suggestions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  a           TEXT NOT NULL,
  b           TEXT NOT NULL,
  score       REAL NOT NULL,
  evidence    TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TEXT NOT NULL,
  decided_at  TEXT,
  UNIQUE (a, b)
);
CREATE INDEX IF NOT EXISTS idx_alias_status ON alias_suggestions(status, score);

-- Watchlist Yang Luput (RANKING.md §6.5)
CREATE TABLE IF NOT EXISTS gap_watch (
  topic_id       TEXT PRIMARY KEY,
  first_detected TEXT NOT NULL,
  first_gap      INTEGER NOT NULL,
  last_checked   TEXT NOT NULL,
  state          TEXT NOT NULL DEFAULT 'luput',
  closes_at      TEXT,
  close_reason   TEXT,
  appearances    INTEGER NOT NULL DEFAULT 0
);

-- Langganan Web Push (Model A)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Biaya dan kesehatan tiap run
CREATE TABLE IF NOT EXISTS run_log (
  run_id        TEXT PRIMARY KEY,
  date          TEXT NOT NULL,
  articles_in   INTEGER,
  after_dedupe  INTEGER,
  blocks        INTEGER,
  clusters      INTEGER,
  topics_out    INTEGER,
  new_topics    INTEGER,
  llm_calls     INTEGER,
  llm_fallback  INTEGER,
  aliases_hash  TEXT,
  cost_usd      REAL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runlog_date ON run_log(date);
