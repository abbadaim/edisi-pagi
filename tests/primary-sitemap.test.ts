import { test } from "node:test";
import assert from "node:assert/strict";
import type { AdjudicatedTopic } from "../src/core/adjudicate.ts";
import type { Cluster } from "../src/core/cluster.ts";
import {
  extractPublishedAt,
  findPrimarySources,
  parseSitemap,
  rankSitemapUrls,
  type PrimarySourceConfig,
} from "../src/core/newsroom/primary.ts";

// DEC-0020: sitemap hanya dari sumber yang terbukti hidup.

const topic: AdjudicatedTopic = {
  cids: ["c01"],
  title: "KPK periksa kepala kantor pertanahan",
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

const cluster: Cluster = {
  key: "c01",
  articles: [],
  outlets: [],
  entities: ["kpk"],
  score: 0,
};

const config: PrimarySourceConfig[] = [
  {
    id: "kpk",
    entities: ["kpk"],
    domains: ["kpk.go.id"],
    sitemap: "https://kpk.go.id/sitemap.xml",
  },
];

const SITEMAP = `<?xml version="1.0"?><urlset>
  <url><loc>https://kpk.go.id/ruang-informasi/berita/kpk-periksa-kepala-pertanahan</loc><lastmod>2026-11-10T10:00:00Z</lastmod></url>
  <url><loc>https://kpk.go.id/ruang-informasi/berita/kpk-tahan-tersangka-suap-jambi</loc><lastmod>2026-11-02T10:00:00Z</lastmod></url>
  <url><loc>https://kpk.go.id/</loc></url>
  <url><loc>https://contoh.id/kpk-periksa</loc></url>
</urlset>`;

test("parseSitemap membaca url dan lastmod", () => {
  const out = parseSitemap(SITEMAP);
  assert.equal(out.urls.length, 4);
  assert.equal(out.urls[0]!.url, "https://kpk.go.id/ruang-informasi/berita/kpk-periksa-kepala-pertanahan");
  assert.equal(out.urls[0]!.lastmod, "2026-11-10T10:00:00Z");
});

test("parseSitemap membaca sitemapindex", () => {
  const out = parseSitemap(
    `<?xml version="1.0"?><sitemapindex>
      <sitemap><loc>https://kpk.go.id/sitemap-berita.xml</loc></sitemap>
    </sitemapindex>`,
  );
  assert.deepEqual(out.sitemaps, ["https://kpk.go.id/sitemap-berita.xml"]);
});

test("rankSitemapUrls menyaring domain lain, homepage, dan tanpa relevansi", () => {
  const picks = rankSitemapUrls(parseSitemap(SITEMAP).urls, topic, ["kpk.go.id"], 2);
  assert.equal(picks.length, 1);
  assert.match(picks[0]!.url, /kpk-periksa-kepala-pertanahan/);
});

test("findPrimarySources memakai sitemap sebelum listing", async () => {
  const calls: string[] = [];
  const out = await findPrimarySources({
    topic,
    cluster,
    configs: config,
    fromIso: "2026-11-09T00:00:00Z",
    toIso: "2026-11-11T00:00:00Z",
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith("sitemap.xml")) return { ok: true, text: SITEMAP };
      if (url.includes("kpk-periksa-kepala-pertanahan")) {
        return {
          ok: true,
          text: `<html><body><p>KPK memeriksa sembilan kepala kantor pertanahan pada Selasa di Jakarta. Pemeriksaan berlangsung tertutup dan akan berlanjut pekan ini.</p><p>Kegiatan itu dilakukan pada 10 November 2026.</p></body></html>`,
        };
      }
      return { ok: false, text: "" };
    },
  });

  assert.equal(out.length, 1);
  assert.match(out[0]!.url, /kpk-periksa-kepala-pertanahan/);
  assert.ok(calls.some((u) => u.endsWith("sitemap.xml")));
});

test("sitemap gagal tidak membuat build melempar", async () => {
  const out = await findPrimarySources({
    topic,
    cluster,
    configs: config,
    fromIso: "2026-11-09T00:00:00Z",
    toIso: "2026-11-11T00:00:00Z",
    fetchImpl: async () => ({ ok: false, text: "" }),
  });
  assert.deepEqual(out, []);
});


test("extractPublishedAt membaca tanggal Indonesia dan meta", () => {
  assert.equal(extractPublishedAt("<p>Jakarta, 10 November 2026</p>"), "2026-11-10T00:00:00+07:00");
  assert.equal(
    extractPublishedAt('<meta property="article:published_time" content="2026-11-10T03:00:00+07:00">'),
    "2026-11-09T20:00:00.000Z",
  );
});

test("sitemap menolak artikel lama di luar jendela", async () => {
  const oldSitemap = `<?xml version="1.0"?><urlset>
    <url><loc>https://kpk.go.id/ruang-informasi/berita/kpk-periksa-kepala-pertanahan</loc></url>
  </urlset>`;
  const out = await findPrimarySources({
    topic,
    cluster,
    configs: config,
    fromIso: "2026-11-09T00:00:00Z",
    toIso: "2026-11-11T00:00:00Z",
    fetchImpl: async (url) => {
      if (url.endsWith("sitemap.xml")) return { ok: true, text: oldSitemap };
      return {
        ok: true,
        text: `<html><body><p>KPK memeriksa sembilan kepala kantor pertanahan pada 2 Maret 2021 di Jakarta.</p><p>Pemeriksaan berlangsung tertutup dan akan berlanjut pekan ini.</p></body></html>`,
      };
    },
  });
  assert.equal(out.length, 0);
});
