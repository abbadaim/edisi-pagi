import { test } from "node:test";
import assert from "node:assert/strict";
import { adjudicate, fallbackTopics, normalise, summarise } from "../src/core/adjudicate.ts";
import type { Cluster } from "../src/core/cluster.ts";
import type { LlmAdapter } from "../src/adapters/llm/types.ts";

const A = (id: string, outlet: string, title: string) => ({
  id,
  url: `https://example.com/${id}`,
  outlet,
  title,
  titleNorm: title.toLowerCase(),
  lead: title,
  publishedAt: "2026-11-10T05:00:00.000Z",
  entities: [],
});

const cluster = (titles: string[], outlets: string[]): Cluster => ({
  key: titles[0] ?? "k",
  articles: titles.map((t, i) => A(`a${i}`, outlets[i % outlets.length]!, t)),
  outlets,
  entities: ["dpr", "gibran"],
  score: 10,
});

const fake = (data: unknown): LlmAdapter => ({
  name: "deepseek",
  async json<T>() {
    return { data: data as T, usage: { tokens_in: 10, tokens_out: 20 } };
  },
  async text() {
    return { text: "", usage: { tokens_in: 0, tokens_out: 0 } };
  },
});

const failing: LlmAdapter = {
  name: "deepseek",
  async json<T>(): Promise<{ data: T; usage: { tokens_in: number; tokens_out: number } }> {
    throw new Error("jaringan mati");
  },
  async text() {
    throw new Error("jaringan mati");
  },
};

test("summarise memberi cid berurutan", () => {
  const s = summarise([cluster(["a"], ["x"]), cluster(["b"], ["y"])]);
  assert.deepEqual(s.map((x) => x.cid), ["c01", "c02"]);
});

test("normalise membuang cid tak dikenal dan cid ganda", () => {
  const valid = new Set(["c01", "c02"]);
  const { topics, dropped } = normalise(
    {
      topics: [
        { cid: ["c01", "c01", "c99"], title: "HMP Gibran", angle: "a", kind: "ongoing" },
        { cid: ["c01"], title: "Duplikat", angle: "b", kind: "ongoing" },
      ],
    },
    valid,
  );
  assert.equal(topics.length, 1);
  assert.deepEqual(topics[0]!.cids, ["c01"]);
  assert.deepEqual(dropped, ["c99"]);
});

test("normalise menjepit nilai di luar rentang", () => {
  const { topics } = normalise(
    {
      topics: [
        {
          cid: ["c01"],
          title: "Uji",
          angle: "a",
          kind: "ngawur",
          category: "ngawur",
          significance: 99,
        },
      ],
    },
    new Set(["c01"]),
  );
  assert.equal(topics[0]!.kind, "ongoing");
  assert.equal(topics[0]!.category, "policy");
  assert.equal(topics[0]!.significance, 5);
});

test("normalise membuang topik tanpa judul", () => {
  const { topics, dropped } = normalise(
    { topics: [{ cid: ["c01"], title: "   " }] },
    new Set(["c01"]),
  );
  assert.equal(topics.length, 0);
  assert.deepEqual(dropped, ["c01"]);
});

test("adjudicate memakai respons LLM", async () => {
  const r = await adjudicate([cluster(["HMP Gibran"], ["detik.com"])], {
    llm: fake({ topics: [{ cid: ["c01"], title: "HMP Gibran", angle: "x", kind: "ongoing" }] }),
    model: "m",
    date: "2026-11-11",
    place: "Sleman",
  });
  assert.equal(r.fallback, false);
  assert.equal(r.topics.length, 1);
  assert.equal(r.usage.tokens_in, 10);
});

test("adjudicate jatuh ke mode deterministik saat LLM gagal", async () => {
  const clusters = [cluster(["A"], ["x"]), cluster(["B"], ["y"])];
  const r = await adjudicate(clusters, {
    llm: failing,
    model: "m",
    date: "2026-11-11",
    place: "Sleman",
  });
  assert.equal(r.fallback, true);
  assert.equal(r.topics.length, 2);
  assert.equal(r.topics[0]!.cids[0], "c01");
});

test("fallbackTopics menjaga jumlah klaster", () => {
  const s = summarise([cluster(["A"], ["x"]), cluster(["B"], ["y"])]);
  assert.equal(fallbackTopics(s).length, 2);
});
