-- 002_entity_df.sql
-- Dokument frekuensi entitas. Blocking butuh "muncul di >=2 artikel"
-- (CLUSTERING.md §5.2), dan IDF saja tidak bisa membedakan df=1 dari df=2.

ALTER TABLE entities ADD COLUMN df INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_entities_df ON entities(df);
