#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { openSqlite } from "../src/adapters/db/sqlite.ts";
import { clusterArticles, loadArticles } from "../src/core/cluster.ts";
import { adjudicate, fallbackTopics, summarise } from "../src/core/adjudicate.ts";
import { loadRegistry, makeTopicId, resolveTopic } from "../src/core/registry.ts";
import { createAdapter } from "../src/adapters/llm/index.ts";

const root = new URL("..", import.meta.url).pathname;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) {
    const v = process.argv[i + 1];
    return v && !v.startsWith("--") ? v : "";
  }
  return fallback;
}

const dbPath = arg("db") || process.env.DATABASE_PATH || join(root, "local.db");
if (!existsSync(dbPath)) {
  console.error(`database tidak ada: ${dbPath}\njalankan: npm run migrate && npm run ingest`);
  process.exit(2);
}

const hours = Number(arg("hours") ?? 48);
const dry = process.argv.includes("--dry");
const forceFallback = process.argv.includes("--fallback");
const model = arg("model") || "deepseek-flash";

const to = new Date();
const from = new Date(to.getTime() - hours * 3_600_000);
const editionId = to.toISOString().slice(0, 10);

const db = openSqlite(dbPath);
try {
  const rows = loadArticles(db, from.toISOString(), to.toISOString());
  const clusters = clusterArticles(rows);

  let result;
  if (forceFallback || !process.env.DEEPSEEK_API_KEY) {
    if (!forceFallback) {
      console.log("DEEPSEEK_API_KEY tidak ada — memakai mode deterministik.\n");
    }
    result = {
      topics: fallbackTopics(summarise(clusters)),
      fallback: true,
      usage: { tokens_in: 0, tokens_out: 0 },
      dropped: [] as string[],
    };
  } else {
    const llm = createAdapter({ provider: "deepseek", model });
    result = await adjudicate(clusters, {
      llm,
      model,
      date: editionId,
      place: "Sleman",
    });
  }

  const registry = loadRegistry(db, new Date(to.getTime() - 14 * 86_400_000).toISOString());
  const counter = { n: 0 };

  console.log(
    `${rows.length} artikel · ${clusters.length} klaster → ${result.topics.length} topik` +
      `${result.fallback ? " (fallback)" : ""} · registry ${registry.length}\n`,
  );

  const rowsOut: string[] = [];
  for (const topic of result.topics) {
    if (topic.drop) continue;
    const res = dry
      ? { topic_id: makeTopicId(topic.title, topic.entities), is_new: true, revision: 1 }
      : await resolveTopic(db, topic, registry, { counter, now: to, editionId });
    const arts = topic.cids.reduce(
      (n, cid) => n + (clusters[Number(cid.slice(1)) - 1]?.articles.length ?? 0),
      0,
    );
    rowsOut.push(
      [
        res.topic_id.padEnd(34),
        String(arts).padStart(3),
        String(topic.significance),
        topic.category.padEnd(9),
        topic.heavy ? "H" : " ",
        res.is_new ? "BARU" : `rev ${res.revision}`,
        topic.title,
      ].join("  "),
    );
  }

  console.log("id                                art  sig  kategori   baru  judul");
  console.log(rowsOut.join("\n"));

  const dropped = result.topics.filter((t) => t.drop);
  if (dropped.length) {
    console.log(`\n${dropped.length} topik dibuang:`);
    for (const d of dropped) console.log(`  - ${d.title}${d.reason ? ` (${d.reason})` : ""}`);
  }
  if (result.dropped.length) console.log(`cid tidak dikenal: ${result.dropped.join(", ")}`);
  console.log(
    `\ntoken: ${result.usage.tokens_in} in / ${result.usage.tokens_out} out · konfirmasi LLM: ${counter.n}`,
  );
  if (dry) console.log("(dry-run: tidak ada perubahan)");
} finally {
  db.close();
}
