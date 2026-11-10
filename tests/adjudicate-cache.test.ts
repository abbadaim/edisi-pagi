import { test } from "node:test";
import assert from "node:assert/strict";
import { migrate, openSqlite } from "../src/adapters/db/sqlite.ts";
import { hashSummaries, loadAdjudication, saveAdjudication } from "../src/core/adjudicate-cache.ts";
import type { AdjudicationResult, ClusterSummary } from "../src/core/adjudicate.ts";

const migrationsDir = new URL("../migrations/", import.meta.url).pathname;
const freshDb = () => {
  const db = openSqlite(":memory:");
  migrate(db, migrationsDir);
  return db;
};

const summary = (cid: string, titles: string[]): ClusterSummary => ({
  cid,
  n_articles: titles.length,
  outlets: ["cnnindonesia.com", "detik.com"],
  entities: ["dpr", "gibran"],
  titles,
  ambiguous: false,
});

const result: AdjudicationResult = {
  topics: [
    {
      cids: ["c01"],
      title: "HMP soal ijazah",
      angle: "Usulan bergulir",
      kind: "ongoing",
      entities: ["dpr", "gibran"],
      local: false,
      horse_race: false,
      drop: false,
      category: "policy",
      significance: 5,
      heavy: false,
      reason: null,
    },
  ],
  fallback: false,
  usage: { tokens_in: 10, tokens_out: 5 },
  dropped: [],
};

test("hash stabil untuk masukan yang sama", () => {
  const a = [summary("c01", ["A", "B"]), summary("c02", ["C"])];
  const b = [summary("c01", ["A", "B"]), summary("c02", ["C"])];
  assert.equal(hashSummaries(a), hashSummaries(b));
});

test("hash berubah bila judul berubah", () => {
  const a = [summary("c01", ["A", "B"])];
  const b = [summary("c01", ["A", "C"])];
  assert.notEqual(hashSummaries(a), hashSummaries(b));
});

test("hash tidak peduli urutan outlet/entitas", () => {
  const a = [summary("c01", ["A"])];
  const b = [{ ...summary("c01", ["A"]), outlets: ["detik.com", "cnnindonesia.com"], entities: ["gibran", "dpr"] }];
  assert.equal(hashSummaries(a), hashSummaries(b));
});

test("simpan dan muat kembali", () => {
  const db = freshDb();
  const h = hashSummaries([summary("c01", ["A"])]);
  assert.equal(loadAdjudication(db, "2026-11-10", h), null);

  saveAdjudication(db, "2026-11-10", h, result);
  const loaded = loadAdjudication(db, "2026-11-10", h);
  assert.ok(loaded);
  assert.equal(loaded!.topics[0]!.title, "HMP soal ijazah");
  db.close();
});

test("cache terpisah per tanggal", () => {
  const db = freshDb();
  const h = hashSummaries([summary("c01", ["A"])]);
  saveAdjudication(db, "2026-11-10", h, result);
  assert.equal(loadAdjudication(db, "2026-11-11", h), null);
  db.close();
});
