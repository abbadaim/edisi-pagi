import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractLinks,
  findPrimarySources,
  matchPrimarySources,
  type PrimarySourceConfig,
} from "../src/core/newsroom/primary.ts";
import type { AdjudicatedTopic } from "../src/core/adjudicate.ts";
import type { Cluster } from "../src/core/cluster.ts";

const configs: PrimarySourceConfig[] = [
  {
    id: "ojk",
    entities: ["ojk", "otoritas_jasa_keuangan"],
    domains: ["ojk.go.id"],
    listing: "https://ojk.go.id/berita",
  },
  {
    id: "bps",
    entities: ["bps", "inflasi"],
    domains: ["bps.go.id"],
    listing: "https://www.bps.go.id/id/pressrelease",
    api: "https://webapi.bps.go.id/v1/api/list/model/pressrelease/domain/0000/key/{key}",
  },
];

const topic: AdjudicatedTopic = {
  cids: ["c01"],
  title: "OJK hentikan 16 entitas investasi ilegal",
  angle: "Penindakan investasi ilegal",
  kind: "breaking",
  entities: ["ojk"],
  local: false,
  horse_race: false,
  drop: false,
  category: "economy",
  significance: 4,
  heavy: false,
  reason: null,
};

const emptyCluster = { key: "c01", articles: [], outlets: [], entities: [], score: 0 } as unknown as Cluster;

test("extractLinks hanya mengambil domain yang diizinkan", () => {
  const html = `
    <a href="/id/berita/ojk-hentikan-16-entitas-investasi-ilegal">OJK Hentikan 16 Entitas Investasi Ilegal</a>
    <a href="https://example.com/berita">Berita lain yang tidak boleh</a>
    <a href="https://ojk.go.id/id/berita/ojk-hentikan-16-entitas-investasi-ilegal">Duplikat</a>`;
  const links = extractLinks(html, "https://ojk.go.id/berita", ["ojk.go.id"]);
  assert.equal(links.length, 1);
  assert.match(links[0]!.url, /ojk\.go\.id\/id\/berita/);
});

test("matchPrimarySources mencocokkan entitas topik", () => {
  assert.equal(matchPrimarySources(configs, topic).map((c) => c.id).join(","), "ojk");
});

test("findPrimarySources mengambil listing resmi yang relevan", async () => {
  const fetchImpl = async (url: string) => {
    if (url === "https://ojk.go.id/berita") {
      return {
        ok: true,
        text: `<a href="/id/berita/ojk-hentikan-16-entitas-investasi-ilegal">OJK Hentikan 16 Entitas Investasi Ilegal</a>`,
      };
    }
    return { ok: true, text: "OJK menghentikan 16 entitas investasi ilegal pada Selasa. Langkah ini bagian dari penindakan." };
  };

  const out = await findPrimarySources({
    topic,
    cluster: emptyCluster,
    configs,
    fromIso: "2026-11-09T00:00:00Z",
    toIso: "2026-11-10T23:59:59Z",
    fetchImpl,
  });
  assert.equal(out.length, 1);
  assert.match(out[0]!.url, /ojk\.go\.id/);
  assert.match(out[0]!.text, /16 entitas/);
});

test("BPS API dipakai bila kunci tersedia", async () => {
  process.env.BPS_API_KEY = "test-key";
  const bpsTopic: AdjudicatedTopic = { ...topic, title: "Inflasi Agustus 2026", entities: ["bps"] };
  const fetchImpl = async (url: string) => {
    if (url.includes("webapi.bps.go.id")) {
      return {
        ok: true,
        text: JSON.stringify({
          data: [
            {
              title: "Inflasi year-on-year Agustus 2026 sebesar 3,19 persen",
              abstract: "BPS mencatat inflasi tahunan Agustus 2026 sebesar 3,19 persen.",
              link: "https://www.bps.go.id/id/pressrelease/2026/09/01/2611/inflasi.html",
              updt_date: "2026-09-01",
            },
          ],
        }),
      };
    }
    return { ok: false, text: "" };
  };

  const out = await findPrimarySources({
    topic: bpsTopic,
    cluster: emptyCluster,
    configs,
    fromIso: "2026-08-01T00:00:00Z",
    toIso: "2026-09-30T23:59:59Z",
    fetchImpl,
  });
  delete process.env.BPS_API_KEY;
  assert.ok(out.some((x) => x.url.includes("bps.go.id") && x.text.includes("3,19")));
});
