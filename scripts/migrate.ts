#!/usr/bin/env node
import { join } from "node:path";
import { openSqlite, migrate } from "../src/adapters/db/sqlite.ts";

const root = new URL("..", import.meta.url).pathname;
const dbPath = process.env.DATABASE_PATH ?? join(root, "local.db");
const dir = join(root, "migrations");

const db = openSqlite(dbPath);
try {
  const { applied, skipped } = migrate(db, dir);
  if (applied.length === 0) {
    console.log(`tidak ada migrasi baru (${skipped} sudah diterapkan) · ${dbPath}`);
  } else {
    console.log(`diterapkan: ${applied.join(", ")} · ${dbPath}`);
    if (skipped > 0) console.log(`dilewati: ${skipped}`);
  }
  const tables = db
    .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .map((r) => r.name);
  console.log(`tabel (${tables.length}): ${tables.join(", ")}`);
} finally {
  db.close();
}
