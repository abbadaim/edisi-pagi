import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterArticles, type ArticleRow } from "../src/core/cluster.ts";
import type { AdjudicatedTopic } from "../src/core/adjudicate.ts";
import { mergeDuplicateTopics, type TopicEntry } from "../src/core/merge.ts";
import { isLocalJunk, isLocalStory, localKicker } from "../src/core/rank.ts";

const T = (hoursAgo: number) => new Date(Date.UTC(2026, 10, 10, 8, 0, 0) - hoursAgo * 3_600_000).toISOString();

function A(id: string, url: string, title: string, lead = title, ents: string[] = []): ArticleRow {
  return {
    id,
    url,
    outlet: new URL(url).hostname,
    title,
    titleNorm: title.toLowerCase(),
    lead,
    publishedAt: T(6),
    entities: ents.map((e) => ({ id: e, idf: 3, df: 5 })),
  };
}

function clusterOf(articles: ArticleRow[], entities: string[] = []) {
  return {
    key: articles[0]!.id,
    articles,
    outlets: [...new Set(articles.map((a) => a.outlet))],
    entities,
    score: articles.length * 2,
  };
}

function topic(title: string, entities: string[], local = false): AdjudicatedTopic {
  return {
    cids: ["c01"],
    title,
    angle: title,
    kind: "ongoing",
    entities,
    local,
    horse_race: false,
    drop: false,
    category: "policy",
    significance: 4,
    heavy: false,
    reason: null,
  };
}

test("dua topik dari peristiwa yang sama digabung", () => {
  const a: TopicEntry = {
    topic: topic("DPR Sepakat Gunakan Hak Menyatakan Pendapat soal Ijazah Gibran", ["dpr", "gibran", "hmp"]),
    cluster: clusterOf([A("a1", "https://cnnindonesia.com/a", "DPR sepakat hak menyatakan pendapat")]),
  };
  const b: TopicEntry = {
    topic: topic("DPR Pakai Hak Menyatakan Pendapat, Gibran Ajukan Mundur", ["dpr", "gibran", "hmp"]),
    cluster: clusterOf([A("b1", "https://tirto.id/b", "DPR pakai hak menyatakan pendapat")]),
  };

  const out = mergeDuplicateTopics([a, b]);
  assert.equal(out.entries.length, 1);
  assert.equal(out.merges.length, 1);
  assert.equal(out.entries[0]!.cluster.articles.length, 2, "artikel kedua topik harus ikut");
  assert.deepEqual(out.entries[0]!.topic.cids.sort(), ["c01"]);
});

test("topik berbeda tidak digabung meski sama-sama menyebut DPR", () => {
  const a: TopicEntry = {
    topic: topic("DPR Sahkan RUU Perlindungan Data Pribadi", ["dpr", "ruu", "pdp"]),
    cluster: clusterOf([A("a1", "https://cnnindonesia.com/a", "DPR sahkan RUU PDP")]),
  };
  const b: TopicEntry = {
    topic: topic("DPR Minta Laporan Bantuan Sosial Daerah", ["dpr", "bansos", "kemensos"]),
    cluster: clusterOf([A("b1", "https://tirto.id/b", "DPR minta laporan bansos")]),
  };

  const out = mergeDuplicateTopics([a, b]);
  assert.equal(out.entries.length, 2);
  assert.equal(out.merges.length, 0);
});

test("topik lokal tidak pernah digabung dengan nasional", () => {
  const a: TopicEntry = {
    topic: topic("Monyet Serbu Ladang Warga Gunungkidul", ["gunungkidul", "monyet"], true),
    cluster: clusterOf([A("a1", "https://jogja.tribunnews.com/a", "Monyet serbu ladang warga Gunungkidul")]),
  };
  const b: TopicEntry = {
    topic: topic("Monyet Serbu Ladang Warga Gunungkidul", ["gunungkidul", "monyet"], false),
    cluster: clusterOf([A("b1", "https://detik.com/b", "Monyet serbu ladang warga Gunungkidul")]),
  };

  const out = mergeDuplicateTopics([a, b]);
  assert.equal(out.entries.length, 2);
});

test("peristiwa lokal yang sama digabung dengan ambang lebih longgar", () => {
  const a: TopicEntry = {
    topic: topic("Pria Bersajam Serang Polisi di Babarsari Sleman", ["sleman", "polisi"], true),
    cluster: clusterOf([A("a1", "https://jogja.tribunnews.com/a", "Pria bersajam serang polisi di Babarsari Sleman")]),
  };
  const b: TopicEntry = {
    topic: topic("Pria Penyerang Polisi di Babarsari Sleman Ditangkap", ["sleman", "polisi"], true),
    cluster: clusterOf([A("b1", "https://harianjogja.com/b", "Pria penyerang polisi Babarsari ditangkap")]),
  };

  const out = mergeDuplicateTopics([a, b]);
  assert.equal(out.entries.length, 1);
  assert.ok(out.merges[0]!.score >= 0.28);
});

test("isLocalStory membedakan peristiwa lokal dari berita nasional di media lokal", () => {
  const lokal = clusterOf([
    A("l1", "https://jogja.tribunnews.com/a", "Dinkes Sleman Imbau Warga Waspada DBD", "Dinkes Sleman meminta warga mewaspadai demam berdarah."),
  ]);
  assert.equal(isLocalStory(lokal), true);

  const nasional = clusterOf([
    A("n1", "https://harianjogja.com/a", "Gibran Disebut Sampaikan Niat Mundur", "Wakil Presiden Gibran Rakabuming disebut akan mundur."),
  ]);
  assert.equal(isLocalStory(nasional), false, "tidak menyebut Sleman/DIY");
});

test("isLocalJunk menolak advertorial", () => {
  const junk = clusterOf([A("j1", "https://harianjogja.com/a", "Promo Astra Motor Yogyakarta, Diskon Servis Motor")]);
  assert.equal(isLocalJunk(junk), true);
});

test("localKicker memakai wilayah yang benar", () => {
  const gk = clusterOf([A("g1", "https://jogja.tribunnews.com/a", "Warga Gunungkidul Ronda Malam Antisipasi Hewan Liar", "Imbauan disampaikan Dinas Pertanian Gunungkidul.")]);
  assert.equal(localKicker(gk), "Gunungkidul");

  const slee = clusterOf([A("s1", "https://harianjogja.com/a", "Dinkes Sleman Waspadai DBD", "Dinkes Sleman mengimbau warga.")]);
  assert.equal(localKicker(slee), "Sleman");
});

test("includeSingletons menyertakan brief satu artikel", () => {
  const rows = [
    A("s1", "https://harianjogja.com/a", "Dinkes Sleman Imbau Warga Waspada DBD", "Dinkes Sleman meminta warga waspada."),
  ];
  assert.equal(clusterArticles(rows).length, 0);
  const solo = clusterArticles(rows, { includeSingletons: true, minArticles: 1, minOutlets: 1 });
  assert.equal(solo.length, 1);
  assert.equal(solo[0]!.articles.length, 1);
});
