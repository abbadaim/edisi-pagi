import { test } from "node:test";
import assert from "node:assert/strict";
import type { AdjudicatedTopic } from "../src/core/adjudicate.ts";
import type { Cluster } from "../src/core/cluster.ts";
import type { Card } from "../src/core/types.ts";
import { buildEdition } from "../src/core/assemble.ts";
import { validateEdition } from "../src/core/validate.ts";
import type { SocialSignals } from "../src/core/newsroom/social.ts";
import {
  buildDebateCard,
  buildGapCard,
  computeDebate,
  computeGap,
  selectMetaCards,
  toneOf,
  type SocialEntry,
} from "../src/core/newsroom/meta-social.ts";

// DEC-0022: gap = peringkat amplifikasi − peringkat liputan (naik, 1-based).

const now = new Date("2026-11-11T05:00:00+07:00");

function signals(over: Partial<SocialSignals> = {}): SocialSignals {
  return {
    reddit_score: null,
    reddit_comments: null,
    detik_comments: null,
    trend_interest: null,
    tiktok_delta: null,
    posts: [],
    quotes: [],
    trend_title: null,
    ...over,
  };
}

function cluster(id: string, articles: number, outlets = 3): Cluster {
  return {
    key: id,
    outlets: Array.from({ length: outlets }, (_, i) => `media${i}.com`),
    entities: [id],
    score: articles,
    articles: Array.from({ length: articles }, (_, i) => ({
      id: `${id}-${i}`,
      url: `https://media${i % outlets}.com/${id}/${i}`,
      outlet: `media${i % outlets}.com`,
      title: `Artikel ${id} ${i}`,
      titleNorm: `artikel ${id} ${i}`,
      lead: `Lead artikel ${id} ${i}.`,
      publishedAt: "2026-11-10T10:00:00Z",
      entities: [],
    })),
  };
}

function entry(id: string, articles: number, s: SocialSignals): SocialEntry {
  const topic: AdjudicatedTopic = {
    cids: [id],
    title: `Topik ${id}`,
    angle: `Sudut ${id}`,
    kind: "ongoing",
    entities: [id],
    local: false,
    horse_race: false,
    drop: false,
    category: "policy",
    significance: 3,
    heavy: false,
    reason: null,
  };
  return { topic, cluster: cluster(id, articles), topicId: `t_${id}`, signals: s };
}

test("computeGap memilih topik ramai yang sedikit diliput", () => {
  const entries: SocialEntry[] = [
    entry("a", 10, signals({ reddit_score: 1 })),
    entry("b", 9, signals({ reddit_score: 2 })),
    entry("c", 8, signals({ reddit_score: 3 })),
    entry("d", 7, signals({ reddit_score: 4 })),
    entry("e", 6, signals({ reddit_score: 5 })),
    entry("g", 5, signals({ reddit_score: 500, reddit_comments: 50 })),
    entry("f", 1, signals({ reddit_score: 1000, reddit_comments: 100, detik_comments: 200, trend_interest: 5000 })),
  ];

  const gap = computeGap(entries);
  assert.ok(gap);
  assert.equal(gap!.entry.topicId, "t_f");
  assert.equal(gap!.gapRank, 6);
  assert.equal(gap!.coverageRank, 1);
  assert.equal(gap!.ampRank, 7);
});

test("gap di bawah ambang tidak terbit", () => {
  const entries = [
    entry("a", 10, signals({ reddit_score: 1000 })),
    entry("b", 9, signals({ reddit_score: 1 })),
  ];
  assert.equal(computeGap(entries), null);
});

test("kartu gap lolos validasi dan memuat sinyal", () => {
  const gap = computeGap([
    entry("a", 10, signals({ reddit_score: 1 })),
    entry("b", 9, signals({ reddit_score: 2 })),
    entry("c", 8, signals({ reddit_score: 3 })),
    entry("d", 7, signals({ reddit_score: 4 })),
    entry("e", 6, signals({ reddit_score: 5 })),
    entry("f", 1, signals({ reddit_score: 1000, reddit_comments: 100, detik_comments: 200, trend_interest: 5000, posts: [{ title: "x", score: 1000, comments: 100, url: "https://reddit.com/x", author: "u" }] })),
  ])!;
  const card = buildGapCard(gap, { editionId: "2026-11-11", now });

  assert.equal(card.type, "gap");
  assert.ok((card as { gap_rank: number }).gap_rank >= 5);
  assert.equal((card as { social: { detik_comments: number } }).social.detik_comments, 200);

  const edition = buildEdition({
    scope: "nasional",
    editionId: "2026-11-11",
    publishedAt: "2026-11-11T05:00:00+07:00",
    coverage: { from: "2026-11-10T05:00:00+07:00", to: "2026-11-11T05:00:00+07:00" },
    generatedAt: "2026-11-11T05:00:00+07:00",
    place: { kabupaten: "Sleman", province: "DI Yogyakarta" },
    cards: [card],
    truncatedReason: "uji",
    generatedBy: {
      adjudicate: { provider: "test", model: "test" },
      write: { provider: "test", model: "test" },
      verify: { provider: "rules", model: "test" },
      embed: { provider: "none", model: "none" },
    },
  });
  const errors = validateEdition(edition).errors.filter((e) => !["E001", "E002"].includes(e.code));
  assert.deepEqual(errors, [], JSON.stringify(errors));
});

test("debate memakai volume terbesar dan kutipan", () => {
  const s = signals({
    reddit_score: 300,
    reddit_comments: 42,
    detik_comments: 120,
    posts: [{ title: "x", score: 300, comments: 42, url: "https://reddit.com/x", author: "u" }],
    quotes: [
      { author: "satu", platform: "reddit", text: "Saya kecewa, ini harus diusut sampai tuntas.", score: 12 },
      { author: "dua", platform: "reddit", text: "Setuju, transparansi anggaran harus dibuka.", score: 9 },
    ],
  });
  const pick = computeDebate([entry("a", 5, s)]);
  assert.ok(pick);
  assert.equal(pick!.volume.platform, "detik.com");
  assert.equal(pick!.volume.count, 120);

  const card = buildDebateCard(pick!, { editionId: "2026-11-11", now });
  assert.equal(card.type, "debate");
  assert.equal((card as { quotes: unknown[] }).quotes.length, 2);
  assert.equal((card as { tone: string }).tone, toneOf(s.quotes));
});

test("debate tanpa kutipan atau ambang tidak terbit", () => {
  assert.equal(
    computeDebate([entry("a", 5, signals({ detik_comments: 100 }))]),
    null,
  );
  assert.equal(
    computeDebate([
      entry("a", 5, signals({
        detik_comments: 1,
        quotes: [
          { author: "a", platform: "reddit", text: "Pendapat pertama yang cukup panjang.", score: 1 },
          { author: "b", platform: "reddit", text: "Pendapat kedua yang cukup panjang.", score: 1 },
        ],
      })),
    ]),
    null,
  );
});

test("prioritas meta: change dan debate di atas gap/misread", () => {
  const mk = (type: string) => ({ type, title: type } as Card);
  const out = selectMetaCards([
    mk("misread"),
    mk("gap"),
    mk("debate"),
    mk("change"),
  ]);
  assert.deepEqual(out.map((c) => c.type), ["change", "debate"]);
});
