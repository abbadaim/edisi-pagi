import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openSqlite } from "../src/adapters/db/sqlite.ts";
import { createDbFetchCache } from "../src/core/newsroom/cache.ts";
import { buildMaterialPack } from "../src/core/newsroom/material.ts";
import type { AdjudicatedTopic } from "../src/core/adjudicate.ts";
import type { Cluster } from "../src/core/cluster.ts";

const topic: AdjudicatedTopic = {
  cids: ["c01"],
  title: "Warga Sleman gotong royong",
  angle: "Kerja bakti di padukuhan",
  kind: "ongoing",
  entities: [],
  local: true,
  horse_race: false,
  drop: false,
  category: "culture",
  significance: 3,
  heavy: false,
  reason: null,
};

const cluster = {
  key: "c01",
  outlets: ["harianjogja.com"],
  entities: [],
  score: 1,
  articles: [
    {
      id: "a1",
      url: "https://harianjogja.com/a",
      outlet: "harianjogja.com",
      title: "Warga Sleman gotong royong",
      titleNorm: "warga sleman gotong royong",
      lead: "Warga Padukuhan X, Sleman, menggelar kerja bakti pada Minggu pagi.",
      publishedAt: "2026-11-10T10:00:00Z",
      entities: [],
    },
  ],
} as unknown as Cluster;

test("cache teks artikel menyimpan dan membaca ulang", async () => {
  const db = openSqlite(":memory:");
  db.exec(readFileSync(new URL("../migrations/006_article_text.sql", import.meta.url), "utf8"));
  const cache = createDbFetchCache(db);
  assert.equal(await cache.get("https://harianjogja.com/a"), null);
  await cache.set("https://harianjogja.com/a", "Teks artikel penuh.");
  assert.equal(await cache.get("https://harianjogja.com/a"), "Teks artikel penuh.");
  db.close();
});

test("buildMaterialPack menambahkan bahan primer sebagai tier 1", async () => {
  const pack = await buildMaterialPack(topic, cluster, "t_sleman", new Map(), {
    maxFetch: 1,
    fetchImpl: async () => ({ text: "", ok: false }),
    primary: [
      {
        url: "https://slemankab.go.id/berita/kerja-bakti",
        outlet: "slemankab.go.id",
        published_at: "2026-11-10T00:00:00+07:00",
        text: "Pemerintah Kabupaten Sleman menggelar kerja bakti di Padukuhan X pada Minggu pagi.",
      },
    ],
  });
  const primary = pack.items.find((i) => i.kind === "primary");
  assert.ok(primary);
  assert.equal(primary!.tier, 1);
  assert.equal(pack.stats.primary, 1);
});

test("buildMaterialPack memakai cache pada pengambilan kedua", async () => {
  const db = openSqlite(":memory:");
  db.exec(readFileSync(new URL("../migrations/006_article_text.sql", import.meta.url), "utf8"));
  const cache = createDbFetchCache(db);

  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { text: "Warga Padukuhan X, Sleman, menggelar kerja bakti pada Minggu pagi. Kegiatan ini diikuti puluhan warga.", ok: true };
  };

  const first = await buildMaterialPack(topic, cluster, "t_sleman", new Map(), {
    cache,
    maxFetch: 1,
    fetchImpl,
  });
  const second = await buildMaterialPack(topic, cluster, "t_sleman", new Map(), {
    cache,
    maxFetch: 1,
    fetchImpl,
  });

  assert.equal(calls, 1, "fetch kedua harus dari cache");
  assert.equal(first.stats.cached ?? 0, 0);
  assert.equal(second.stats.cached ?? 0, 1);
  assert.equal(second.stats.fetched, 1);
  db.close();
});
