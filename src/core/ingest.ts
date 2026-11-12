import { createHash } from "node:crypto";
import type { Db } from "../adapters/db/sqlite.ts";
import { fetchFeed, parseFeed } from "../adapters/feed/rss.ts";
import type { FeedConfig } from "../config/sources.ts";
import { applyAliases, displayTitle, makeLead, normalizeTitle, type Aliases } from "./normalize.ts";
import { extractEntities, type ExtractedEntity } from "./entities.ts";
import {
  SIMILARITY_THRESHOLD,
  features,
  simhash,
  similarity,
  toSignedInt64,
  type SimHash,
} from "./simhash.ts";

/**
 * Timeout, gangguan jaringan, dan 5xx layak diulang. 4xx tidak: itu kesalahan
 * kita (URL/izin), bukan gangguan sesaat (`DEC-0027`).
 */
export function isRetryableFeedError(message: string): boolean {
  if (/\bHTTP\s*4\d\d\b/.test(message)) return false;
  return /timeout|aborted|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|HTTP\s*5\d\d/i.test(
    message,
  );
}

const FEED_ATTEMPTS = 2;
const FEED_RETRY_DELAY_MS = 500;

export interface IngestOptions {
  feeds: FeedConfig[];
  aliases: Aliases;
  db: Db;
  now?: Date;
  limitPerFeed?: number;
  /** Buang artikel lebih tua dari ini. Default 36 jam (jendela edisi + margin). */
  maxAgeHours?: number;
  dryRun?: boolean;
  fetchTimeoutMs?: number;
}

export interface FeedResult {
  id: string;
  outlet: string;
  fetched: number;
  error: string | null;
}

export interface IngestStats {
  perFeed: FeedResult[];
  itemsIn: number;
  skippedOld: number;
  afterDedupe: number;
  duplicates: number;
  inserted: number;
  alreadyKnown: number;
  entities: number;
  durationMs: number;
}

interface Candidate {
  id: string;
  url: string;
  outlet: string;
  publishedAt: string | null;
  title: string;
  titleNorm: string;
  lead: string;
  hash: SimHash;
  features: Map<string, number>;
  entities: ExtractedEntity[];
}

function articleId(url: string): string {
  return createHash("sha1").update(url).digest("hex").slice(0, 16);
}

export async function ingest(opts: IngestOptions): Promise<IngestStats> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const fetchedAt = now.toISOString();

  // 1. Ambil semua feed secara paralel; satu gagal tidak menjatuhkan yang lain.
  const perFeed: FeedResult[] = [];
  const rawItems: Array<{ feed: FeedConfig; title: string; link: string; publishedAt: string | null; description: string }> = [];

  await Promise.all(
    opts.feeds.map(async (feed) => {
      const timeoutMs = opts.fetchTimeoutMs ?? 15_000;
      let xml: string | null = null;
      let lastError = "";
      let attempts = 0;

      for (let attempt = 1; attempt <= FEED_ATTEMPTS; attempt++) {
        attempts = attempt;
        try {
          xml = await fetchFeed(feed.url, timeoutMs, feed.userAgent);
          break;
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          // Hanya gangguan sesaat yang diulang; 4xx akan gagal sama saja.
          if (attempt === FEED_ATTEMPTS || !isRetryableFeedError(lastError)) break;
          await new Promise((r) => setTimeout(r, FEED_RETRY_DELAY_MS));
        }
      }

      try {
        if (xml === null) throw new Error(lastError);
        const parsed = parseFeed(xml);
        const items = opts.limitPerFeed ? parsed.items.slice(0, opts.limitPerFeed) : parsed.items;
        for (const it of items) {
          if (!it.link || !it.title) continue;
          rawItems.push({ feed, ...it });
        }
        perFeed.push({ id: feed.id, outlet: feed.outlet, fetched: items.length, error: null });
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        perFeed.push({
          id: feed.id,
          outlet: feed.outlet,
          fetched: 0,
          error: attempts > 1 ? `${why} (${attempts} percobaan)` : why,
        });
      }
    }),
  );

  perFeed.sort((a, b) => a.id.localeCompare(b.id));

  // 2. Normalisasi + entitas.
  const candidates: Candidate[] = [];
  const seenUrl = new Set<string>();
  const maxAgeMs = (opts.maxAgeHours ?? 36) * 3_600_000;
  let skippedOld = 0;

  for (const it of rawItems) {
    if (seenUrl.has(it.link)) continue;
    seenUrl.add(it.link);

    // Jendela waktu: feed membawa arsip (Tirto 7 hari, Tempo berbulan-bulan).
    if (it.publishedAt) {
      const age = now.getTime() - Date.parse(it.publishedAt);
      if (Number.isFinite(age) && (age > maxAgeMs || age < -2 * 3_600_000)) {
        skippedOld++;
        continue;
      }
    }

    const title = displayTitle(it.title);
    if (!title) continue;

    const lead = makeLead(it.description);
    const titleNorm = applyAliases(normalizeTitle(title), opts.aliases);
    const text = `${titleNorm} ${normalizeTitle(lead)}`;
    const hash = simhash(text);
    const entities = extractEntities(title, lead, opts.aliases);

    candidates.push({
      id: articleId(it.link),
      url: it.link,
      outlet: it.feed.outlet,
      publishedAt: it.publishedAt,
      title,
      titleNorm,
      lead,
      hash,
      features: features(text),
      entities,
    });
  }

  // 3. Dedupe sindikasi di dalam batch.
  const accepted: Candidate[] = [];
  let duplicates = 0;

  for (const c of candidates) {
    const dup = accepted.find((a) => similarity(a.features, c.features) >= SIMILARITY_THRESHOLD);
    if (dup) {
      duplicates++;
      if (!opts.dryRun) {
        // Simpan sebagai duplikat agar coverage count tidak menggelembung.
        opts.db.run(
          `INSERT INTO articles
             (id,url,outlet,published_at,title_display,title_norm,lead,simhash,is_duplicate_of,topic_id,fetched_at)
           VALUES (?,?,?,?,?,?,?,?,?,NULL,?)
           ON CONFLICT(url) DO NOTHING`,
          [c.id, c.url, c.outlet, c.publishedAt, c.title, c.titleNorm, c.lead, toSignedInt64(c.hash), dup.id, fetchedAt],
        );
      }
      continue;
    }
    accepted.push(c);
  }

  // 4. Tulis artikel unik + entitas.
  const touchedEntities = new Set<string>();
  let inserted = 0;
  let alreadyKnown = 0;

  if (!opts.dryRun) {
    for (const c of accepted) {
      const changed = opts.db.run(
        `INSERT INTO articles
           (id,url,outlet,published_at,title_display,title_norm,lead,simhash,is_duplicate_of,topic_id,fetched_at)
         VALUES (?,?,?,?,?,?,?,?,NULL,NULL,?)
         ON CONFLICT(url) DO NOTHING`,
        [c.id, c.url, c.outlet, c.publishedAt, c.title, c.titleNorm, c.lead, toSignedInt64(c.hash), fetchedAt],
      );

      if (changed === 0) {
        alreadyKnown++;
        continue;
      }
      inserted++;

      for (const e of c.entities) {
        opts.db.run(
          `INSERT INTO entities (id,name,kind,idf,last_seen) VALUES (?,?,?,0,?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, last_seen=excluded.last_seen`,
          [e.id, e.name, e.kind, fetchedAt],
        );
        opts.db.run(
          `INSERT INTO article_entities (article_id, entity_id, surface) VALUES (?,?,?)
           ON CONFLICT(article_id, entity_id) DO NOTHING`,
          [c.id, e.id, e.surface],
        );
        touchedEntities.add(e.id);
      }
    }

    updateIdf(opts.db, touchedEntities, now);

    const runId = `${now.toISOString()}-${Math.random().toString(36).slice(2, 6)}`;
    opts.db.run(
      `INSERT INTO run_log (run_id,date,articles_in,after_dedupe,blocks,clusters,topics_out,new_topics,llm_calls,llm_fallback,aliases_hash,cost_usd,created_at)
       VALUES (?,?,?,?,NULL,NULL,NULL,NULL,0,0,NULL,0,?)`,
      [runId, now.toISOString().slice(0, 10), candidates.length, accepted.length, fetchedAt],
    );
  }

  return {
    perFeed,
    itemsIn: candidates.length,
    skippedOld,
    afterDedupe: accepted.length,
    duplicates,
    inserted,
    alreadyKnown,
    entities: touchedEntities.size,
    durationMs: Date.now() - started,
  };
}

const IDF_WINDOW_DAYS = 30;
const IDF_THRESHOLD = 1.5;

function updateIdf(db: Db, entityIds: Set<string>, now: Date): void {
  if (entityIds.size === 0) return;

  const cutoff = new Date(now.getTime() - IDF_WINDOW_DAYS * 86_400_000).toISOString();
  const total = db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM articles WHERE is_duplicate_of IS NULL AND fetched_at >= ?",
    [cutoff],
  );
  const n = Math.max(1, Number(total?.n ?? 0));

  const stmt = `SELECT COUNT(DISTINCT ae.article_id) AS df
                FROM article_entities ae
                JOIN articles a ON a.id = ae.article_id
                WHERE ae.entity_id = ? AND a.is_duplicate_of IS NULL AND a.fetched_at >= ?`;

  for (const id of entityIds) {
    const row = db.get<{ df: number }>(stmt, [id, cutoff]);
    const df = Math.max(1, Number(row?.df ?? 1));
    const idf = Math.log(n / df);
    db.run("UPDATE entities SET idf = ?, df = ? WHERE id = ?", [idf, df, id]);
  }
}

export { IDF_THRESHOLD };
