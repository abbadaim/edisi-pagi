#!/usr/bin/env node
import { join } from "node:path";
import { existsSync } from "node:fs";
import { openSqlite } from "../src/adapters/db/sqlite.ts";
import { ingest } from "../src/core/ingest.ts";
import { loadAliases, loadFeeds } from "../src/config/sources.ts";

const root = new URL("..", import.meta.url).pathname;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--")) {
    return process.argv[i + 1];
  }
  return process.argv.includes(`--${name}`) ? "" : fallback;
}

const dbPath = arg("db") || process.env.DATABASE_PATH || join(root, "local.db");
const limit = Number(arg("limit") ?? 0) || undefined;
const maxAgeHours = Number(arg("since-hours") ?? 36);
const dryRun = process.argv.includes("--dry");

if (!existsSync(dbPath)) {
  console.error(`database tidak ada: ${dbPath}\njalankan: npm run migrate`);
  process.exit(2);
}

const feeds = loadFeeds(join(root, "config", "feeds.yaml"));
const aliases = loadAliases(join(root, "config", "aliases.yaml"));

const db = openSqlite(dbPath);
try {
  const stats = await ingest({ feeds, aliases, db, limitPerFeed: limit, maxAgeHours, dryRun });

  const width = Math.max(...stats.perFeed.map((f) => f.id.length), 8);
  console.log("feed".padEnd(width + 2) + "ambil  status");
  for (const f of stats.perFeed) {
    console.log(
      f.id.padEnd(width + 2) + String(f.fetched).padStart(5) + "  " + (f.error ? `× ${f.error}` : "ok"),
    );
  }

  console.log("");
  console.log(`masuk        ${stats.itemsIn}`);
  console.log(`di luar jendela ${stats.skippedOld}  (> ${maxAgeHours} jam)`);
  console.log(`unik         ${stats.afterDedupe}`);
  console.log(`duplikat     ${stats.duplicates}`);
  if (!dryRun) {
    console.log(`baru         ${stats.inserted}`);
    console.log(`sudah ada    ${stats.alreadyKnown}`);
    console.log(`entitas      ${stats.entities}`);
  }
  console.log(`durasi       ${stats.durationMs} ms${dryRun ? "  (dry-run)" : ""}`);
} finally {
  db.close();
}
