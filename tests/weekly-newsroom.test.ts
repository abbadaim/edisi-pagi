import { test } from "node:test";
import assert from "node:assert/strict";
import type { AdjudicatedTopic } from "../src/core/adjudicate.ts";
import type { Card } from "../src/core/types.ts";
import { buildEdition } from "../src/core/assemble.ts";
import { validateEdition } from "../src/core/validate.ts";
import {
  WEEKLY_ANSWERS,
  spanDays,
  weeklyAssignment,
  weeklyise,
} from "../src/core/weekly-newsroom.ts";

const topic: AdjudicatedTopic = {
  cids: ["c01"],
  title: "KPK periksa kepala pertanahan",
  angle: "Dugaan setoran",
  kind: "ongoing",
  entities: ["kpk"],
  local: false,
  horse_race: false,
  drop: false,
  category: "policy",
  significance: 4,
  heavy: false,
  reason: null,
};

const cluster = {
  key: "c01",
  outlets: ["kompas.com", "detik.com", "tirto.id"],
  entities: ["kpk"],
  score: 3,
  articles: [
    {
      id: "a1",
      url: "https://kompas.com/a",
      outlet: "kompas.com",
      title: "KPK periksa kepala pertanahan",
      titleNorm: "kpk periksa kepala pertanahan",
      lead: "KPK memeriksa sembilan kepala kantor pertanahan.",
      publishedAt: "2026-11-04T10:00:00Z",
      entities: [],
    },
    {
      id: "a2",
      url: "https://detik.com/b",
      outlet: "detik.com",
      title: "Setoran Rp2,3 miliar diduga diterima",
      titleNorm: "setoran rp23 miliar diduga diterima",
      lead: "Penyidik menduga ada setoran.",
      publishedAt: "2026-11-08T10:00:00Z",
      entities: [],
    },
  ],
};

function deepCard(): Card {
  return {
    id: "c1",
    type: "deep_dive",
    topic_id: "t_kpk_pertanahan",
    angle: "Usulan bergulir",
    kicker: "Mendalam",
    title: "KPK periksa sembilan kepala kantor pertanahan",
    status: "sebagian",
    truth: null,
    body: ["Paragraf satu.", "Paragraf dua."],
    explain: [
      { q: "Apa itu KPK?", a: "Lembaga pemberantasan korupsi yang menyelidiki dan menuntut tindak pidana korupsi.", source: { outlet: "KPK", url: "https://kpk.go.id/" } },
      { q: "Apa itu setoran?", a: "Pembayaran tidak resmi yang diberikan kepada pejabat untuk memengaruhi keputusan.", source: { outlet: "KPK", url: "https://kpk.go.id/" } },
    ],
    action: "Lama",
    image: null,
    sources: [
      { outlet: "kompas.com", url: "https://kompas.com/a", published_at: null, tier: 2, accessed_at: "2026-11-11T05:00:00+07:00" },
      { outlet: "detik.com", url: "https://detik.com/b", published_at: null, tier: 2, accessed_at: "2026-11-11T05:00:00+07:00" },
    ],
    revision: 1,
    first_seen: "2026-11-11",
    previous_edition: null,
    changes: [],
    dek: "Dek.",
    optional: true,
    read_min: 4,
    stats: [],
  } as Card;
}

test("assignment mingguan selalu deep dan punya 5 pertanyaan", () => {
  const a = weeklyAssignment(topic);
  assert.equal(a.depth, "deep");
  assert.deepEqual(a.answers, WEEKLY_ANSWERS);
  assert.equal(a.note_ids.length, 0);
});

test("spanDays menghitung rentang artikel", () => {
  assert.equal(spanDays(cluster as never), 4);
});

test("weeklyise mengubah bentuk rekap tanpa mengubah sumber/truth", () => {
  const card = deepCard();
  const out = weeklyise(card, cluster as never);
  assert.ok(out);
  assert.equal(out!.type, "deep_dive");
  assert.equal(out!.kicker, "Rekap pekan");
  assert.equal(out!.angle, "Rekap 4 hari");
  assert.match(out!.action, /bukan berita baru/);
  assert.deepEqual((out as { stats: Array<{ value: string; label: string }> }).stats, [
    { value: "2", label: "artikel" },
    { value: "3", label: "media" },
    { value: "4 hari", label: "berjalan" },
  ]);
  assert.deepEqual(out!.sources, card.sources);
  assert.equal(out!.truth, card.truth);
});

test("weeklyise menolak kartu non-deep_dive", () => {
  const card = { ...deepCard(), type: "news" } as Card;
  assert.equal(weeklyise(card, cluster as never), null);
});

test("edisi mingguan hasil weeklyise lolos validasi", () => {
  const cards = [deepCard(), deepCard(), deepCard()].map((c, i) => {
    const w = weeklyise({ ...c, topic_id: `t_kpk_${i}` } as Card, cluster as never)!;
    return w;
  });

  const edition = buildEdition({
    scope: "mingguan",
    editionId: "2026-11-15",
    publishedAt: "2026-11-15T05:00:00+07:00",
    coverage: { from: "2026-11-08T05:00:00+07:00", to: "2026-11-15T05:00:00+07:00" },
    generatedAt: "2026-11-15T05:00:00+07:00",
    place: { kabupaten: "Sleman", province: "DI Yogyakarta" },
    cards,
    truncatedReason: "Korpus uji: 3 thread",
    generatedBy: {
      adjudicate: { provider: "fallback", model: "none" },
      write: { provider: "test", model: "test" },
      verify: { provider: "rules", model: "test" },
      embed: { provider: "none", model: "none" },
    },
  });

  const check = validateEdition(edition);
  assert.equal(check.ok, true, JSON.stringify(check.errors));
});
