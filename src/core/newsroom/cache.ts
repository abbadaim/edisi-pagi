/**
 * Cache teks artikel (NEWSROOM-IMPLEMENTATION.md prioritas 6).
 *
 * Kunci = hash URL + versi ekstraktor. TTL mencegah teks basi dipakai
 * selamanya; kegagalan cache tidak boleh menggagalkan build.
 */

import { createHash } from "node:crypto";
import type { Db } from "../../adapters/db/sqlite.ts";

export const EXTRACTOR_VERSION = "newsroom-extract-v1";

export interface FetchCache {
  get(url: string): Promise<string | null>;
  set(url: string, text: string): Promise<void>;
}

function hashUrl(url: string): string {
  return createHash("sha1").update(url).digest("hex").slice(0, 20);
}

export function createDbFetchCache(db: Db, ttlDays = 14): FetchCache {
  let enabled = true;
  const ttlMs = ttlDays * 86_400_000;

  return {
    async get(url: string): Promise<string | null> {
      if (!enabled) return null;
      try {
        const row = db.get<{ text: string; extractor: string; fetched_at: string }>(
          "SELECT text, extractor, fetched_at FROM article_text WHERE url_hash = ?",
          [hashUrl(url)],
        );
        if (!row || row.extractor !== EXTRACTOR_VERSION) return null;
        if (Date.now() - Date.parse(row.fetched_at) > ttlMs) return null;
        return row.text;
      } catch {
        enabled = false;
        return null;
      }
    },

    async set(url: string, text: string): Promise<void> {
      if (!enabled || !text.trim()) return;
      try {
        db.run(
          `INSERT INTO article_text (url_hash, url, text, extractor, fetched_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(url_hash) DO UPDATE SET
             text = excluded.text,
             extractor = excluded.extractor,
             fetched_at = excluded.fetched_at`,
          [hashUrl(url), url, text, EXTRACTOR_VERSION, new Date().toISOString()],
        );
      } catch {
        enabled = false;
      }
    },
  };
}
