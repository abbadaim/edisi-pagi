import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeepDive, buildDeepDiveWithLlm } from "../src/core/deepdive.ts";
import type { Cluster } from "../src/core/cluster.ts";
import type { AdjudicatedTopic } from "../src/core/adjudicate.ts";
import { buildAliases } from "../src/core/normalize.ts";
import { loadGlossary } from "../src/core/writer.ts";
import type { LlmAdapter } from "../src/adapters/llm/types.ts";

const now = new Date("2026-11-10T05:00:00+07:00");

const art = (i: number, outlet: string, day: number) => ({
  id: `a${i}`,
  url: `https://${outlet}/artikel-${i}`,
  outlet,
  title: `Perkembangan penyadapan hari ke-${day}`,
  titleNorm: `perkembangan penyadapan hari ke ${day}`,
  lead: `Penyelidikan penyadapan berlanjut pada hari ke-${day}.`,
  publishedAt: new Date(now.getTime() - (6 - day) * 86_400_000).toISOString(),
  entities: [],
});

const cluster: Cluster = {
  key: "k",
  articles: [art(1, "detik.com", 1), art(2, "cnnindonesia.com", 3), art(3, "tirto.id", 6)],
  outlets: ["detik.com", "cnnindonesia.com", "tirto.id"],
  entities: ["listyo", "penyadapan"],
  score: 10,
};

const topic: AdjudicatedTopic = {
  cids: ["c01"],
  title: "Siapa yang menyadap siapa",
  angle: "Kasus penyadapan bergulir",
  kind: "ongoing",
  entities: ["listyo", "penyadapan"],
  local: false,
  horse_race: false,
  drop: false,
  category: "safety",
  significance: 5,
  heavy: false,
  reason: null,
};

const glossary = loadGlossary("config/glossary.yaml");

test("deep dive deterministik: stats, read_min, optional", () => {
  const card = buildDeepDive({ now, cluster, topic, topicId: "t_x", glossary, local: false });
  assert.ok(card);
  assert.equal(card!.type, "deep_dive");
  if (card!.type !== "deep_dive") return;
  assert.equal(card!.optional, true);
  assert.ok(card!.read_min >= 4 && card!.read_min <= 8);
  assert.equal(card!.stats.length, 3);
  assert.ok(card!.sources.length >= 3);
  assert.ok(card!.explain!.length >= 2);
});

test("deep dive null bila konteks tidak cukup", () => {
  const empty = new Map();
  const card = buildDeepDive({ now, cluster, topic, topicId: "t_x", glossary: empty, local: false });
  assert.equal(card, null);
});

const llmReturning = (data: unknown): LlmAdapter => ({
  name: "deepseek",
  async json<T>() {
    return { data: data as T, usage: { tokens_in: 1, tokens_out: 1 } };
  },
  async text() {
    return { text: "", usage: { tokens_in: 0, tokens_out: 0 } };
  },
});

const candidates = [
  { key: "g1", q: "Siapa Listyo Sigit?", a: "Mantan Kapolri yang kini berstatus tersangka.", outlet: "Polri", url: "https://polri.go.id/" },
  { key: "g2", q: "Apa itu penyadapan?", a: "Penyadapan hanya sah dengan izin pengadilan dalam perkara tertentu.", outlet: "UU ITE", url: "https://kominfo.go.id/" },
];

test("deep dive LLM memakai kandidat konteks", async () => {
  const card = await buildDeepDiveWithLlm(
    { now, cluster, topic, topicId: "t_x", glossary, local: false },
    {
      llm: llmReturning({
        title: "Penyadapan dan siapa yang mengawasi",
        dek: "Kasus ini bergeser dari perangkat ke pengawasan aparat.",
        body: ["Paragraf pertama yang cukup panjang.", "Paragraf kedua yang juga cukup panjang."],
        action: "Baca kronologinya sebelum menyimpulkan.",
        claim: "Kasus penyadapan bergulir",
        explain: [
          { q: "Siapa Listyo Sigit?", a: "Mantan Kapolri yang kini berstatus tersangka.", source_key: "g1" },
          { q: "Apa itu penyadapan?", a: "Penyadapan hanya sah dengan izin pengadilan dalam perkara tertentu.", source_key: "g2" },
        ],
      }),
      model: "m",
      candidates,
    },
  );
  assert.ok(card);
  if (card!.type !== "deep_dive") return;
  assert.match(card!.title, /Penyadapan/);
  assert.equal(card!.explain!.length, 2);
});

test("deep dive LLM jatuh ke deterministik saat gagal", async () => {
  const failing: LlmAdapter = {
    name: "deepseek",
    async json<T>(): Promise<{ data: T; usage: { tokens_in: number; tokens_out: number } }> {
      throw new Error("mati");
    },
    async text() {
      throw new Error("mati");
    },
  };
  const card = await buildDeepDiveWithLlm(
    { now, cluster, topic, topicId: "t_x", glossary, local: false },
    { llm: failing, model: "m", candidates },
  );
  assert.ok(card);
  assert.equal(card!.type, "deep_dive");
});
