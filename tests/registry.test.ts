import { test } from "node:test";
import assert from "node:assert/strict";
import { migrate, openSqlite } from "../src/adapters/db/sqlite.ts";
import { jaccard, loadRegistry, makeTopicId, resolveTopic, slugify } from "../src/core/registry.ts";
import type { AdjudicatedTopic } from "../src/core/adjudicate.ts";

const migrationsDir = new URL("../migrations/", import.meta.url).pathname;
const freshDb = () => {
  const db = openSqlite(":memory:");
  migrate(db, migrationsDir);
  return db;
};

const topic = (title: string, entities: string[]): AdjudicatedTopic => ({
  cids: ["c01"],
  title,
  angle: "angle",
  kind: "ongoing",
  entities,
  local: false,
  horse_race: false,
  drop: false,
  category: "policy",
  significance: 4,
  heavy: false,
  reason: null,
});

test("slugify aman untuk id", () => {
  assert.equal(slugify("HMP soal Ijazah Gibran!"), "hmp_soal_ijazah_gibran");
  assert.equal(slugify("   "), "");
});

test("makeTopicId stabil dan sesuai pola", () => {
  const a = makeTopicId("HMP soal Ijazah", ["dpr", "gibran"]);
  const b = makeTopicId("HMP soal Ijazah", ["gibran", "dpr"]);
  assert.equal(a, b, "urutan entitas tidak boleh mengubah id");
  assert.match(a, /^t_[a-z0-9_]{2,48}$/);
});

test("jaccard dasar", () => {
  assert.equal(jaccard(new Set(["a", "b"]), new Set(["a", "b"])), 1);
  assert.equal(jaccard(new Set(["a"]), new Set(["b"])), 0);
  assert.equal(jaccard(new Set(["a", "b"]), new Set(["b", "c"])), 1 / 3);
});

test("topik baru disimpan dengan revisi 1", async () => {
  const db = freshDb();
  const reg = loadRegistry(db, "2026-01-01T00:00:00.000Z");
  const r = await resolveTopic(db, topic("HMP soal Ijazah", ["dpr", "gibran"]), reg, {
    now: new Date("2026-11-11T05:00:00+07:00"),
    editionId: "2026-11-11",
  });
  assert.equal(r.is_new, true);
  assert.equal(r.revision, 1);

  const rows = db.all<{ n: number }>("SELECT COUNT(*) AS n FROM topics");
  assert.equal(Number(rows[0]!.n), 1);
  db.close();
});

test("topik yang sama di hari berikutnya memakai id yang sama", async () => {
  const db = freshDb();
  const reg = loadRegistry(db, "2026-01-01T00:00:00.000Z");

  const first = await resolveTopic(db, topic("HMP soal Ijazah", ["dpr", "gibran"]), reg, {
    now: new Date("2026-11-11T05:00:00+07:00"),
    editionId: "2026-11-11",
  });

  const second = await resolveTopic(
    db,
    topic("HMP soal ijazah Gibran bergulir", ["dpr", "gibran"]),
    reg,
    { now: new Date("2026-11-12T05:00:00+07:00"), editionId: "2026-11-12" },
  );

  assert.equal(second.is_new, false);
  assert.equal(second.topic_id, first.topic_id);
  assert.equal(second.revision, 2);

  const aliases = db.all<{ alias: string }>(
    "SELECT alias FROM topic_aliases WHERE topic_id = ?",
    [first.topic_id],
  );
  assert.equal(aliases.length, 2, "judul baru harus tercatat sebagai alias");
  db.close();
});

test("entitas berbeda menghasilkan topik baru", async () => {
  const db = freshDb();
  const reg = loadRegistry(db, "2026-01-01T00:00:00.000Z");

  await resolveTopic(db, topic("HMP soal Ijazah", ["dpr", "gibran"]), reg, {
    editionId: "2026-11-11",
  });
  const other = await resolveTopic(db, topic("BP lepas bisnis SPBU", ["bp", "spbu", "akr"]), reg, {
    editionId: "2026-11-11",
  });

  assert.equal(other.is_new, true);
  const n = db.all<{ n: number }>("SELECT COUNT(*) AS n FROM topics");
  assert.equal(Number(n[0]!.n), 2);
  db.close();
});

test("konfirmasi LLM dipakai untuk kasus borderline dan dibatasi", async () => {
  const db = freshDb();
  const reg = loadRegistry(db, "2026-01-01T00:00:00.000Z");

  // 4 entitas di registry, 2 di kandidat -> j = 2/5 = 0,4 (di bawah autoJ)
  await resolveTopic(db, topic("HMP soal Ijazah", ["dpr", "gibran", "hmp", "ijazah"]), reg, {
    editionId: "2026-11-11",
  });

  let calls = 0;
  const counter = { n: 0 };
  const cand = topic("Polemik anggaran di parlemen", ["dpr", "gibran", "anggaran"]);
  const r = await resolveTopic(db, cand, reg, {
    counter,
    maxConfirm: 1,
    confirm: async () => {
      calls++;
      return true;
    },
    editionId: "2026-11-12",
  });

  assert.equal(calls, 1);
  assert.equal(r.confirmed, true);
  assert.equal(r.is_new, false);
  db.close();
});
