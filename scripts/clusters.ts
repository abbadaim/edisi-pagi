#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { openSqlite } from "../src/adapters/db/sqlite.ts";
import { clusterArticles, loadArticles, prepare, similarityOf } from "../src/core/cluster.ts";

const root = new URL("..", import.meta.url).pathname;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) {
    const v = process.argv[i + 1];
    return v && !v.startsWith("--") ? v : "";
  }
  return fallback;
}

const dbPath = arg("db") || join(root, "local.db");
if (!existsSync(dbPath)) {
  console.error(`database tidak ada: ${dbPath}\njalankan: npm run migrate && npm run ingest`);
  process.exit(2);
}

const hours = Number(arg("hours") ?? 48);
const top = Number(arg("top") ?? 12);
const threshold = Number(arg("threshold") ?? 0.3);
const minArticles = Number(arg("min-articles") ?? 2);

const to = new Date();
const from = new Date(to.getTime() - hours * 3_600_000);

const db = openSqlite(dbPath);
try {
  const rows = loadArticles(db, from.toISOString(), to.toISOString());
  const clusters = clusterArticles(rows, { threshold, minArticles });

  console.log(
    `${rows.length} artikel · ${clusters.length} klaster · ambang ${threshold} · ${hours} jam\n`,
  );

  clusters.slice(0, top).forEach((c, i) => {
    const first = c.articles[0]!;
    console.log(
      `${String(i + 1).padStart(2)}. [${c.articles.length} artikel · ${c.outlets.length} outlet · skor ${c.score.toFixed(1)}]`,
    );
    console.log(`    ${first.title.slice(0, 88)}`);
    console.log(`    ${c.outlets.join(", ")}`);
    if (c.entities.length) console.log(`    entitas: ${c.entities.slice(0, 8).join(", ")}`);
    console.log("");
  });

  if (process.argv.includes("--pairs")) {
    const prepared = prepare(rows);
    const pairs: Array<{ s: number; j: number; c: number; a: string; b: string }> = [];
    for (let i = 0; i < prepared.length; i++) {
      for (let j = i + 1; j < prepared.length; j++) {
        const r = similarityOf(prepared[i]!, prepared[j]!, {
          threshold,
          jaccardMin: 0.5,
          cosineMin: 0.55,
          minArticles,
          minOutlets: 2,
          maxArticles: 25,
          maxGapHours: 72,
          minIdf: 1.5,
        });
        if (r.j > 0) pairs.push({ s: r.total, j: r.j, c: r.c, a: prepared[i]!.row.title, b: prepared[j]!.row.title });
      }
    }
    pairs.sort((x, y) => y.s - x.s);
    console.log("--- pasangan teratas (j > 0) ---");
    for (const p of pairs.slice(0, 15)) {
      console.log(`${p.s.toFixed(3)} j=${p.j.toFixed(2)} c=${p.c.toFixed(2)}`);
      console.log(`   ${p.a.slice(0, 70)}`);
      console.log(`   ${p.b.slice(0, 70)}`);
    }
  }
} finally {
  db.close();
}
