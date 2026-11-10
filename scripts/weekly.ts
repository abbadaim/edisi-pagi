#!/usr/bin/env node
/**
 * Edisi mingguan: rekap 7 hari, fokus pada thread yang berjalan.
 * Berbeda dari edisi harian: hanya `deep_dive`, tanpa hoax/baik/meta.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openSqlite } from "../src/adapters/db/sqlite.ts";
import { clusterArticles, loadArticles, type Cluster } from "../src/core/cluster.ts";
import { fallbackTopics, summarise, type AdjudicatedTopic } from "../src/core/adjudicate.ts";
import { loadRegistry, resolveTopic } from "../src/core/registry.ts";
import { buildEdition } from "../src/core/assemble.ts";
import { explainForTopic, loadGlossary, sourcesFromCluster } from "../src/core/writer.ts";
import { computeTruth } from "../src/core/truth.ts";
import { validateEdition, formatErrors, allowsThin } from "../src/core/validate.ts";
import { isoWib, wibDate } from "../src/core/time.ts";
import { truncateWords } from "../src/core/normalize.ts";
import type { Card, Edition } from "../src/core/types.ts";

const root = new URL("..", import.meta.url).pathname;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) {
    const v = process.argv[i + 1];
    return v && !v.startsWith("--") ? v : "";
  }
  return fallback;
}

const dateArg = arg("date") || wibDate(new Date());
const now = new Date(`${dateArg}T05:00:00+07:00`);
const editionId = dateArg;
const windowDays = Number(arg("days") ?? 7);
const from = new Date(now.getTime() - windowDays * 86_400_000);

const dbPath = arg("db") || process.env.DATABASE_PATH || join(root, "local.db");
if (!existsSync(dbPath)) {
  console.error(`database tidak ada: ${dbPath}`);
  process.exit(2);
}

const outDir = join(root, "data", "editions");
mkdirSync(outDir, { recursive: true });

const db = openSqlite(dbPath);
try {
  const rows = loadArticles(db, from.toISOString(), now.toISOString());
  const clusters = clusterArticles(rows, { maxGapHours: windowDays * 24 });

  const topics = fallbackTopics(summarise(clusters));
  const glossary = loadGlossary(join(root, "config", "glossary.yaml"));

  // Urutkan thread menurut ukuran + keragaman media.
  const ranked = topics
    .map((t, i) => ({ topic: t, cluster: clusters[i]! }))
    .filter((e) => e.cluster.articles.length >= 3)
    .sort(
      (a, b) =>
        b.cluster.articles.length * Math.min(b.cluster.outlets.length, 5) -
        a.cluster.articles.length * Math.min(a.cluster.outlets.length, 5),
    )
    .slice(0, 5);

  const counter = { n: 0 };
  const registry = loadRegistry(db, new Date(now.getTime() - 30 * 86_400_000).toISOString());

  const cards: Card[] = [];
  for (const { topic, cluster } of ranked) {
    const res = await resolveTopic(db, topic, registry, { counter, now, editionId });

    const explain = explainForTopic(topic, glossary);
    if (!explain) continue;

    const sources = sourcesFromCluster(cluster, now, 5);
    if (sources.length < 2) continue;

    const dates = cluster.articles
      .map((a) => (a.publishedAt ? new Date(a.publishedAt).getTime() : 0))
      .filter((n) => n > 0);
    const spanDays =
      dates.length > 1 ? Math.max(1, Math.round((Math.max(...dates) - Math.min(...dates)) / 86_400_000)) : 1;

    const body = [
      cluster.articles[0]?.lead || cluster.articles[0]?.title || "",
      cluster.articles[cluster.articles.length - 1]?.lead || "",
    ]
      .filter(Boolean)
      .map((x) => x.slice(0, 460));

    cards.push({
      id: "c1",
      type: "deep_dive",
      topic_id: res.topic_id,
      angle: `Rekap ${spanDays} hari`,
      kicker: "Rekap pekan",
      title: truncateWords(topic.title, 68),
      status: "sebagian",
      truth: null,
      body: body.length ? body : [topic.title],
      explain,
      action: "Ini rekap, bukan berita baru. Buka edisi harian untuk detailnya.",
      image: null,
      sources,
      revision: 1,
      first_seen: editionId,
      previous_edition: null,
      changes: [],
      dek: truncateWords(cluster.articles[0]?.lead || topic.title, 150),
      optional: true,
      read_min: Math.min(8, Math.max(4, Math.ceil(cluster.articles.length / 4))),
      stats: [
        { value: String(cluster.articles.length), label: "artikel" },
        { value: String(cluster.outlets.length), label: "media" },
        { value: `${spanDays} hari`, label: "berjalan" },
      ],
    } as Card);
  }

  if (cards.length < 3) {
    console.log(`mingguan · ${rows.length} artikel · ${cards.length} thread — tidak terbit (minimum 3)`);
    process.exit(0);
  }

  const edition: Edition = buildEdition({
    scope: "mingguan",
    editionId,
    publishedAt: isoWib(now)!,
    coverage: { from: isoWib(from)!, to: isoWib(now)! },
    generatedAt: isoWib(now)!,
    place: { kabupaten: "Sleman", province: "DI Yogyakarta" },
    cards,
    truncatedReason:
      cards.length < 6
        ? `Korpus terbatas: ${cards.length} thread dengan >=2 media`
        : null,
    generatedBy: {
      adjudicate: { provider: "fallback", model: "none" },
      write: { provider: "deterministic", model: "glossary" },
      verify: { provider: "rules", model: "evidence-class" },
      embed: { provider: "none", model: "none" },
    },
  });

  const file = join(outDir, `${editionId}.mingguan.json`);
  const check = validateEdition(edition);
  console.log(`mingguan · ${rows.length} artikel · ${cards.length} thread`);
  const thinMode = process.argv.includes("--thin") || process.env.ALLOW_THIN === "1";
  const publishable = check.ok || (thinMode && cards.length > 0 && allowsThin(check.errors));
  if (publishable) {
    writeFileSync(file, JSON.stringify(edition, null, 2));
    console.log(`  ${check.ok ? "✓ valid" : "△ tipis (uji)"} · ${file}`);
  } else {
    if (existsSync(file)) rmSync(file);
    console.log(`  ✗ tidak valid · tidak diterbitkan`);
    console.log(formatErrors(check.errors));
  }
} finally {
  db.close();
}
