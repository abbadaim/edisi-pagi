import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateEdition } from "../src/core/validate.ts";
import type { Edition } from "../src/core/types.ts";

const root = new URL("../", import.meta.url).pathname;
const read = (p: string) => JSON.parse(readFileSync(root + p, "utf8"));
const clone = (p: string): Edition => structuredClone(read(p)) as Edition;

const NASIONAL = "fixtures/valid/nasional-2026-11-11.json";
const LOKAL = "fixtures/valid/lokal-2026-11-11.json";
const INVALID = "fixtures/invalid/nasional-terpotong.json";

const codes = (ed: unknown): string[] => {
  const r = validateEdition(ed);
  return r.ok ? [] : r.errors.map((e) => e.code);
};

test("edisi nasional valid", () => {
  const r = validateEdition(read(NASIONAL));
  assert.equal(r.ok, true, JSON.stringify(r.errors, null, 2));
});

test("edisi lokal valid", () => {
  const r = validateEdition(read(LOKAL));
  assert.equal(r.ok, true, JSON.stringify(r.errors, null, 2));
});

test("E001 — jumlah kartu tidak sesuai", () => {
  const c = codes(read(INVALID));
  assert.ok(c.includes("E001"), `dapat: ${c.join(",")}`);
});

test("E002 — pemendekan tanpa alasan", () => {
  const c = codes(read(INVALID));
  assert.ok(c.includes("E002"), `dapat: ${c.join(",")}`);
});

test("E004 — terkonfirmasi tanpa sumber tier 1", () => {
  const ed = clone(NASIONAL);
  ed.cards[0]!.status = "terkonfirmasi";
  assert.ok(codes(ed).includes("E004"));
});

test("E006 — gap_rank di bawah ambang", () => {
  const ed = clone(NASIONAL);
  const gap = ed.cards.find((c) => c.type === "gap") as Extract<Edition["cards"][number], { type: "gap" }>;
  gap.gap_rank = 2;
  assert.ok(codes(ed).includes("E006"));
});

test("E009 — kartu meta melebihi batas", () => {
  const ed = clone(NASIONAL);
  const change = ed.cards.find((c) => c.type === "change")!;
  const extra = structuredClone(change);
  extra.id = "c4";
  extra.topic_id = "t_pajero_tiruan";
  ed.cards[3] = extra; // c4 asli diganti -> meta jadi 3
  assert.ok(codes(ed).includes("E009"));
});

test("E010 — kartu lokal tanpa sumber DIY", () => {
  const ed = clone(LOKAL);
  const news = ed.cards.find((c) => c.type === "news")!;
  news.sources = news.sources.map((s) => ({ ...s, url: "https://www.kompas.com/berita/x" }));
  assert.ok(codes(ed).includes("E010"));
});

test("E011 — topic_id duplikat", () => {
  const ed = clone(LOKAL);
  ed.cards[1]!.topic_id = ed.cards[0]!.topic_id;
  assert.ok(codes(ed).includes("E011"));
});

test("E013 — gambar bukan webp", () => {
  const ed = clone(NASIONAL);
  const card = ed.cards.find((c) => c.image !== null)!;
  card.image!.url = "/assets/fallback/policy.jpg";
  assert.ok(codes(ed).includes("E013"));
});

test("E014 — lebih dari satu deep_dive", () => {
  const ed = clone(NASIONAL);
  const dd = ed.cards.find((c) => c.type === "deep_dive")!;
  const extra = structuredClone(dd);
  extra.id = "c4";
  extra.topic_id = "t_penyadapan_lain";
  ed.cards[3] = extra; // ganti kartu berita -> dua deep_dive, tetap 8 kartu
  assert.ok(codes(ed).includes("E014"));
});

test("E015 — deep_dive kurang sumber", () => {
  const ed = clone(NASIONAL);
  const dd = ed.cards.find((c) => c.type === "deep_dive")!;
  dd.sources = dd.sources.slice(0, 2);
  assert.ok(codes(ed).includes("E015"));
});

test("E016 — jendela coverage bukan 24 jam", () => {
  const ed = clone(NASIONAL);
  ed.coverage.to = "2026-11-13T05:00:00+07:00";
  assert.ok(codes(ed).includes("E016"));
});

test("E017 — kartu berita tanpa blok konteks", () => {
  const ed = clone(NASIONAL);
  const news = ed.cards.find((c) => c.type === "news")!;
  delete news.explain;
  assert.ok(codes(ed).includes("E017"));
});

test("E017 — pertanyaan konteks duplikat", () => {
  const ed = clone(NASIONAL);
  const news = ed.cards.find((c) => c.type === "news")!;
  news.explain = [news.explain![0]!, { ...news.explain![0]! }];
  assert.ok(codes(ed).includes("E017"));
});

test("E000 — struktur rusak ditolak lebih dulu", () => {
  const ed = clone(NASIONAL) as unknown as Record<string, unknown>;
  ed.scope = "dunia";
  const c = codes(ed);
  assert.deepEqual(c.filter((x) => x !== "E000"), []);
  assert.ok(c.includes("E000"));
});
