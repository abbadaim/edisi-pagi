#!/usr/bin/env node
/**
 * Backfill arsip dari GDELT: judul + URL + domain per hari.
 * RSS hanya menyimpan 1–2 hari, jadi hari yang lebih lama tidak bisa
 * direkonstruksi dari feed. GDELT memberi metadata lintas media per tanggal.
 *
 * Catatan: GDELT tidak memberi isi/lead artikel, hanya judul. Klastering
 * berjalan dengan judul saja (C_teks dari judul), dan `lead` dibiarkan kosong.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { openSqlite } from "../src/adapters/db/sqlite.ts";
import { applyAliases, displayTitle, normalizeTitle } from "../src/core/normalize.ts";
import { extractEntities } from "../src/core/entities.ts";
import { features, simhash, toSignedInt64 } from "../src/core/simhash.ts";
import { loadAliases } from "../src/config/sources.ts";

const root = new URL("..", import.meta.url).pathname;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) {
    const v = process.argv[i + 1];
    return v && !v.startsWith("--") ? v : "";
  }
  return fallback;
}

const date = arg("date");
if (!date) {
  console.error("pakai --date YYYY-MM-DD");
  process.exit(2);
}

const dbPath = arg("db") || join(root, "local.db");
if (!existsSync(dbPath)) {
  console.error(`database tidak ada: ${dbPath}`);
  process.exit(2);
}

// Jendela liputan: 05.00 WIB hari sebelumnya → 05.00 WIB hari baca.
const day = new Date(`${date}T05:00:00+07:00`);
const from = new Date(day.getTime() - 86_400_000);
const fmt = (d: Date) => d.toISOString().replace(/[-:T]/g, "").slice(0, 14);

interface GdeltArticle {
  url: string;
  title: string;
  domain: string;
  seendate: string;
  language?: string;
}

async function fetchDay(max = 250): Promise<GdeltArticle[]> {
  const q = new URLSearchParams({
    query: "sourcecountry:ID",
    mode: "artlist",
    maxrecords: String(max),
    format: "json",
    startdatetime: fmt(from),
    enddatetime: fmt(day),
  });
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${q}`, {
        headers: { "user-agent": "EdisiPagi/0.1 (+personal news aggregator)" },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { articles?: GdeltArticle[] };
      return json.articles ?? [];
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 15_000 * (attempt + 1)));
    }
  }
  throw new Error(`GDELT gagal: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

function toIso(seendate: string): string | null {
  const m = seendate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!)).toISOString();
}

const aliases = loadAliases(join(root, "config", "aliases.yaml"));
const db = openSqlite(dbPath);

try {
  const articles = await fetchDay();
  const fetchedAt = new Date().toISOString();
  let inserted = 0;
  let skipped = 0;

  for (const a of articles) {
    if (!a.url || !a.title) continue;
    const published = toIso(a.seendate);
    if (!published) continue;
    if (published < from.toISOString() || published > day.toISOString()) continue;

    const title = displayTitle(a.title);
    if (title.length < 15) continue;

    const titleNorm = applyAliases(normalizeTitle(title), aliases);
    const hash = simhash(titleNorm);
    const ents = extractEntities(title, "", aliases);
    const id = createHash("sha1").update(a.url).digest("hex").slice(0, 16);

    const changed = db.run(
      `INSERT INTO articles
         (id,url,outlet,published_at,title_display,title_norm,lead,simhash,is_duplicate_of,topic_id,fetched_at)
       VALUES (?,?,?,?,?,?,?,?,NULL,NULL,?)
       ON CONFLICT(url) DO NOTHING`,
      [id, a.url, a.domain.replace(/^www\./, ""), published, title, titleNorm, "", toSignedInt64(hash), fetchedAt],
    );
    if (changed === 0) {
      skipped++;
      continue;
    }
    inserted++;

    for (const e of ents) {
      db.run(
        `INSERT INTO entities (id,name,kind,idf,last_seen) VALUES (?,?,?,0,?)
         ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen`,
        [e.id, e.name, e.kind, fetchedAt],
      );
      db.run(
        "INSERT INTO article_entities (article_id, entity_id, surface) VALUES (?,?,?) ON CONFLICT(article_id, entity_id) DO NOTHING",
        [id, e.id, e.surface],
      );
    }
  }

  // IDF/df dari korpus bergulir 30 hari.
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const total = db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM articles WHERE is_duplicate_of IS NULL AND fetched_at >= ?",
    [cutoff],
  );
  const n = Math.max(1, Number(total?.n ?? 0));
  const ids = db.all<{ entity_id: string }>(
    "SELECT DISTINCT ae.entity_id FROM article_entities ae JOIN articles a ON a.id=ae.article_id WHERE a.fetched_at >= ?",
    [cutoff],
  );
  for (const { entity_id } of ids) {
    const row = db.get<{ df: number }>(
      `SELECT COUNT(DISTINCT ae.article_id) AS df FROM article_entities ae
        JOIN articles a ON a.id=ae.article_id
        WHERE ae.entity_id = ? AND a.is_duplicate_of IS NULL AND a.fetched_at >= ?`,
      [entity_id, cutoff],
    );
    const df = Math.max(1, Number(row?.df ?? 1));
    db.run("UPDATE entities SET idf = ?, df = ? WHERE id = ?", [Math.log(n / df), df, entity_id]);
  }

  console.log(`${date}: GDELT ${articles.length} entri · baru ${inserted} · sudah ada ${skipped}`);
} finally {
  db.close();
}
