import { test } from "node:test";
import assert from "node:assert/strict";
import { coverageScore, hardFilter, isLocalCluster, select } from "../src/core/rank.ts";
import type { AdjudicatedTopic } from "../src/core/adjudicate.ts";
import type { ArticleRow, Cluster } from "../src/core/cluster.ts";

const now = new Date("2026-11-10T08:00:00Z");

const art = (id: string, url: string, outlet: string, hoursAgo = 5): ArticleRow => ({
  id,
  url,
  outlet,
  title: `judul ${id}`,
  titleNorm: `judul ${id}`,
  lead: "",
  publishedAt: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
  entities: [],
});

const cluster = (articles: ArticleRow[]): Cluster => ({
  key: articles[0]?.id ?? "k",
  articles,
  outlets: [...new Set(articles.map((a) => a.outlet))],
  entities: [],
  score: 1,
});

const topic = (over: Partial<AdjudicatedTopic> = {}): AdjudicatedTopic => ({
  cids: ["c01"],
  title: "Topik",
  angle: "angle",
  kind: "ongoing",
  entities: [],
  local: false,
  horse_race: false,
  drop: false,
  category: "policy",
  significance: 4,
  heavy: false,
  reason: null,
  ...over,
});

const entry = (t: Partial<AdjudicatedTopic>, c: Cluster) => ({ topic: topic(t), cluster: c });

test("coverageScore naik dan mentok di 1", () => {
  assert.ok(coverageScore(2) < coverageScore(10));
  assert.equal(coverageScore(1000), 1);
});

test("klaster lokal hanya jika mayoritas artikel DIY", () => {
  const mostlyLocal = cluster([
    art("a", "https://www.detik.com/jogja/berita/a", "detik.com"),
    art("b", "https://jogja.tribunnews.com/b", "tribunnews.com"),
    art("c", "https://www.detik.com/berita/c", "detik.com"),
  ]);
  const oneLocal = cluster([
    art("a", "https://www.detik.com/jogja/berita/a", "detik.com"),
    art("b", "https://www.detik.com/berita/b", "detik.com"),
    art("c", "https://www.cnnindonesia.com/c", "cnnindonesia.com"),
  ]);
  assert.equal(isLocalCluster(mostlyLocal), true);
  assert.equal(isLocalCluster(oneLocal), false);
});

test("filter keras membuang drop, horse_race, orphan, dan basi", () => {
  const fresh = cluster([art("a", "https://detik.com/a", "detik.com"), art("b", "https://cnnindonesia.com/b", "cnnindonesia.com")]);
  const stale = cluster([
    art("c", "https://detik.com/c", "detik.com", 96),
    art("d", "https://cnnindonesia.com/d", "cnnindonesia.com", 95),
  ]);
  const orphan = cluster([art("e", "https://detik.com/e", "detik.com")]);

  const entries = [
    entry({ drop: true }, fresh),
    entry({ horse_race: true }, fresh),
    entry({}, orphan),
    entry({}, stale),
    entry({}, fresh),
  ];

  const { kept, stats } = hardFilter(entries, "nasional", now);
  assert.equal(kept.length, 1);
  assert.deepEqual(stats, { drop: 1, horseRace: 1, orphan: 1, stale: 1, localOnly: 0 });
});

test("batas kategori diterapkan", () => {
  const mk = (id: string) =>
    entry({ title: `t${id}` }, cluster([
      art(`${id}1`, `https://detik.com/${id}1`, "detik.com"),
      art(`${id}2`, `https://cnnindonesia.com/${id}2`, "cnnindonesia.com"),
    ]));

  const kept = ["a", "b", "c"].map((id) => ({ ...mk(id), topic: { ...mk(id).topic, category: "economy" as const } }));
  const { selected, excludedByBudget } = select(kept, { scope: "nasional", now, maxArticlesPerCategory: 2 });
  assert.equal(selected.length, 2);
  assert.equal(excludedByBudget.length, 1);
});

test("anggaran suasana hati membatasi kartu berat", () => {
  const mk = (id: string) =>
    entry({ title: `t${id}`, heavy: true, category: "crime" }, cluster([
      art(`${id}1`, `https://detik.com/${id}1`, "detik.com"),
      art(`${id}2`, `https://cnnindonesia.com/${id}2`, "cnnindonesia.com"),
    ]));
  const { selected } = select(["a", "b", "c"].map(mk), { scope: "nasional", now, maxHeavy: 2 });
  assert.equal(selected.length, 2);
});

test("topik yang kemarin di posisi atas diturunkan", () => {
  const strong = entry({ title: "Kuat", significance: 5 }, cluster([
    art("a", "https://detik.com/a", "detik.com"),
    art("b", "https://cnnindonesia.com/b", "cnnindonesia.com"),
  ]));
  const weak = entry({ title: "Lemah", significance: 3 }, cluster([
    art("c", "https://detik.com/c", "detik.com"),
    art("d", "https://cnnindonesia.com/d", "cnnindonesia.com"),
  ]));

  const withRecent = select(
    [
      { ...strong, topicId: "t_strong" },
      { ...weak, topicId: "t_weak" },
    ],
    { scope: "nasional", now, recentTop: new Set(["t_strong"]) },
  );
  assert.equal(withRecent.selected[0]!.topicId, "t_weak");
});
