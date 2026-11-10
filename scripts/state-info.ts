#!/usr/bin/env node
/**
 * Ringkasan state sebelum ingest. Dipakai workflow untuk membuktikan bahwa
 * cache state benar-benar terbawa antar-run (dan untuk mendiagnosis bila tidak).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { openSqlite } from "../src/adapters/db/sqlite.ts";

const root = new URL("..", import.meta.url).pathname;
const path = process.env.DATABASE_PATH || join(root, "data", "state", "local.db");

if (!existsSync(path)) {
  console.log(`state: kosong (${path}) — run pertama tanpa cache`);
  process.exit(0);
}

const db = openSqlite(path);
try {
  const count = db.get<{ n: number }>("SELECT count(*) AS n FROM articles");
  const span = db.get<{ a: string | null; b: string | null }>(
    "SELECT min(published_at) AS a, max(published_at) AS b FROM articles",
  );
  console.log(
    `state: ${count?.n ?? 0} artikel · ${span?.a ?? "-"} → ${span?.b ?? "-"} · ${path}`,
  );
} catch {
  console.log(`state: file ada tetapi belum dimigrasi (${path})`);
} finally {
  db.close();
}
