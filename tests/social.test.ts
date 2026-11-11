import { test } from "node:test";
import assert from "node:assert/strict";
import type { AdjudicatedTopic } from "../src/core/adjudicate.ts";
import type { Cluster } from "../src/core/cluster.ts";
import {
  collectSocial,
  parseDetikComments,
  parseRedditComments,
  parseRedditPosts,
  parseTrends,
  trendFor,
  type FetchFn,
} from "../src/core/newsroom/social.ts";
import { amplification } from "../src/core/newsroom/meta-social.ts";
import { openSqlite, migrate } from "../src/adapters/db/sqlite.ts";

// DEC-0022: sinyal sosial v1 dari Reddit, Trends, dan jumlah komentar Detik.

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
  outlets: ["detik.com", "kompas.com"],
  entities: ["kpk"],
  score: 2,
  articles: [
    {
      id: "a1",
      url: "https://www.detik.com/a",
      outlet: "detik.com",
      title: "KPK periksa kepala pertanahan",
      titleNorm: "kpk periksa kepala pertanahan",
      lead: "KPK memeriksa sembilan kepala kantor pertanahan.",
      publishedAt: "2026-11-10T10:00:00Z",
      entities: [],
    },
  ],
};

const TRENDS = `<?xml version="1.0"?><rss><channel>
  <item><title>kpk periksa pertanahan</title><ht:approx_traffic>2000+</ht:approx_traffic></item>
  <item><title>sepak bola</title><ht:approx_traffic>500+</ht:approx_traffic></item>
</channel></rss>`;

const POSTS = JSON.stringify({
  data: [
    {
      title: "KPK periksa kepala kantor pertanahan, apa yang terjadi?",
      score: 56,
      num_comments: 42,
      permalink: "/r/indonesia/comments/abc123/kpk/",
      author: "pengguna",
    },
  ],
});

const COMMENTS = JSON.stringify({
  data: [
    { author: "satu", body: "Saya kecewa, ini harus diusut sampai tuntas dan jangan berhenti.", score: 12 },
    { author: "dua", body: "Setuju, transparansi anggaran harus dibuka kepada publik sekarang.", score: 9 },
    { author: "AutoModerator", body: "Otomatis.", score: 1 },
  ],
});

const DETIK = `<html><body><div comment-count="120"></div></body></html>`;

const fakeFetch: FetchFn = async (url) => {
  if (url.includes("trending/rss")) return { ok: true, text: TRENDS };
  if (url.includes("/posts/search")) return { ok: true, text: POSTS };
  if (url.includes("/comments/search")) return { ok: true, text: COMMENTS };
  if (url.includes("detik.com")) return { ok: true, text: DETIK };
  return { ok: false, text: "" };
};

test("parseTrends membaca judul dan approx_traffic", () => {
  const out = parseTrends(TRENDS);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.title, "kpk periksa pertanahan");
  assert.equal(out[0]!.traffic, 2000);
});

test("parseRedditPosts dan comments", () => {
  const posts = parseRedditPosts(POSTS);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.score, 56);
  assert.match(posts[0]!.url, /reddit\.com/);

  const quotes = parseRedditComments(COMMENTS);
  assert.equal(quotes.length, 2);
  assert.equal(quotes[0]!.author, "satu");
});

test("parseDetikComments mengambil angka terbesar", () => {
  assert.equal(parseDetikComments(DETIK), 120);
  assert.equal(parseDetikComments("<p>tanpa komentar</p>"), null);
});

test("trendFor mencocokkan topik", () => {
  assert.equal(trendFor(topic, parseTrends(TRENDS))?.title, "kpk periksa pertanahan");
});

test("collectSocial menggabungkan sumber dan memakai cache", async () => {
  const db = openSqlite(":memory:");
  migrate(db, new URL("../migrations/", import.meta.url).pathname);

  let calls = 0;
  const counting: FetchFn = async (url) => {
    calls++;
    return fakeFetch(url);
  };

  const first = await collectSocial(
    [{ topic, cluster, topicId: "t_kpk" }],
    { db, editionId: "2026-11-11", now: new Date("2026-11-11T05:00:00+07:00"), fetchImpl: counting },
  );
  const s = first.get("t_kpk")!;
  assert.equal(s.reddit_score, 56);
  assert.equal(s.reddit_comments, 42);
  assert.equal(s.detik_comments, 120);
  assert.equal(s.trend_interest, 2000);
  assert.ok(s.quotes.length >= 2);
  assert.ok(amplification(s) >= 200);

  const before = calls;
  const second = await collectSocial(
    [{ topic, cluster, topicId: "t_kpk" }],
    { db, editionId: "2026-11-11", now: new Date("2026-11-11T06:00:00+07:00"), fetchImpl: counting },
  );
  assert.equal(calls, before, "cache harus mencegah fetch ulang");
  assert.equal(second.get("t_kpk")!.reddit_score, 56);
  db.close();
});

test("fetchDetikSignals memakai sneak-peek untuk total dan kutipan", async () => {
  const { fetchDetikSignals } = await import("../src/core/newsroom/social.ts");
  const page = `<html><script>article_id=123&channel_id=2104&site=dtk</script><div comment-count="999"></div></html>`;
  const api = JSON.stringify({
    data: { total_comment: 1 },
    data_v2: {
      total_comment: 17,
      list_comment: [
        { name: "Sutikno", comment: "Sebetulnya ini perlu dijelaskan kepada publik, jangan dibiarkan.", like_count: 4 },
      ],
    },
  });

  const out = await fetchDetikSignals(cluster, async (url) => {
    if (url.includes("apicomment.detik.com")) return { ok: true, text: api };
    return { ok: true, text: page };
  });

  assert.equal(out.total, 17);
  assert.equal(out.quotes.length, 1);
  assert.equal(out.quotes[0]!.author, "Sutikno");
  assert.equal(out.quotes[0]!.platform, "detik.com");
});
