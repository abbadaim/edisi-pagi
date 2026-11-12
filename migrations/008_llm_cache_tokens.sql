-- 008_llm_cache_tokens.sql
-- Prompt cache DeepSeek dilaporkan sebagai prompt_cache_hit_tokens, bagian dari
-- prompt_tokens. Tanpa kolom ini, hit rate hanya bisa dibaca dari dasbor
-- vendor, bukan dari pipeline (DEC-0024).
--
-- cached_tokens = token yang kena cache (harga lebih murah).
-- miss = tokens_in - cached_tokens.

ALTER TABLE llm_calls ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0;
