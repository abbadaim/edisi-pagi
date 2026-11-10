import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type Param = string | number | null | bigint | Uint8Array;

export interface Db {
  exec(sql: string): void;
  run(sql: string, params?: Param[]): number;
  all<T = Record<string, unknown>>(sql: string, params?: Param[]): T[];
  get<T = Record<string, unknown>>(sql: string, params?: Param[]): T | undefined;
  close(): void;
}

export function openSqlite(path: string): Db {
  // SQLite tidak membuat folder induk; runner CI memulai tanpa data/state/.
  if (path !== ":memory:" && !path.startsWith("file:")) {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  return {
    exec(sql) {
      db.exec(sql);
    },
    run(sql, params = []) {
      const r = db.prepare(sql).run(...params);
      return Number(r.changes ?? 0);
    },
    all<T>(sql: string, params: Param[] = []): T[] {
      return db.prepare(sql).all(...params) as T[];
    },
    get<T>(sql: string, params: Param[] = []): T | undefined {
      return db.prepare(sql).get(...params) as T | undefined;
    },
    close() {
      db.close();
    },
  };
}

export interface MigrationResult {
  applied: string[];
  skipped: number;
}

/** Jalankan semua migrasi *.sql yang belum tercatat. Idempoten. */
export function migrate(db: Db, dir: string): MigrationResult {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at TEXT NOT NULL
     );`,
  );

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const done = new Set(
    db.all<{ version: number }>("SELECT version FROM schema_migrations").map((r) => r.version),
  );

  const applied: string[] = [];
  let skipped = 0;

  for (const file of files) {
    const version = Number.parseInt(file.slice(0, 3), 10);
    if (!Number.isFinite(version)) throw new Error(`nama migrasi tidak valid: ${file}`);
    if (done.has(version)) {
      skipped++;
      continue;
    }
    const sql = readFileSync(join(dir, file), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)", [
        version,
        file,
        new Date().toISOString(),
      ]);
      db.exec("COMMIT");
      applied.push(file);
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`migrasi gagal: ${file}\n${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { applied, skipped };
}
