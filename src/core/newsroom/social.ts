/**
 * Sinyal amplifikasi untuk kartu `gap`/`debate` (rencana 007).
 *
 * Sumber: Reddit (Arctic Shift), Google Trends RSS, dan jumlah komentar di
 * halaman Detik. TikTok sengaja null: endpoint hanya memberi angka kumulatif,
 * bukan delta per topik.
 *
 * Tidak ada sinyal = tidak ada kartu. Jangan mengarang angka.
 */

import type { Db } from "../../adapters/db/sqlite.ts";
import type { AdjudicatedTopic } from "../adjudicate.ts";
import type { Cluster } from "../cluster.ts";
import { tokenize } from "../simhash.ts";
import { isoWib } from "../time.ts";

export interface SocialPost {
  title: string;
  score: number;
  comments: number;
  url: string;
  author: string;
}

export interface SocialQuote {
  author: string;
  platform: string;
  text: string;
  score: number;
}

export interface SocialSignals {
  reddit_score: number | null;
  reddit_comments: number | null;
  detik_comments: number | null;
  trend_interest: number | null;
  tiktok_delta: null;
  posts: SocialPost[];
  quotes: SocialQuote[];
  trend_title: string | null;
}

export interface TrendItem {
  title: string;
  traffic: number | null;
}

export type FetchFn = (url: string) => Promise<{ ok: boolean; text: string }>;

const UA = "EdisiPagi/0.1 (+personal news aggregator; social signals)";

const empty = (): SocialSignals => ({
  reddit_score: null,
  reddit_comments: null,
  detik_comments: null,
  trend_interest: null,
  tiktok_delta: null,
  posts: [],
  quotes: [],
  trend_title: null,
});

async function defaultFetch(url: string): Promise<{ ok: boolean; text: string }> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json, text/xml, text/html" },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, text: "" };
    return { ok: true, text: await res.text() };
  } catch {
    return { ok: false, text: "" };
  }
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTrends(xml: string): TrendItem[] {
  const out: TrendItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = m[1] ?? "";
    const title = decode(block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    if (!title) continue;
    const raw = block.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/i)?.[1] ?? "";
    const digits = raw.replace(/[^\d]/g, "");
    const traffic = digits ? Number(digits) : null;
    out.push({ title, traffic: Number.isFinite(traffic) ? traffic : null });
  }
  return out;
}

interface RedditPostRaw {
  title?: string;
  score?: number;
  num_comments?: number;
  permalink?: string;
  author?: string;
}

export function parseRedditPosts(json: string): SocialPost[] {
  try {
    const parsed = JSON.parse(json) as { data?: RedditPostRaw[] };
    return (parsed.data ?? [])
      .filter((p) => p.title && p.permalink)
      .map((p) => ({
        title: String(p.title).slice(0, 200),
        score: Number(p.score ?? 0),
        comments: Number(p.num_comments ?? 0),
        url: `https://www.reddit.com${p.permalink}`,
        author: String(p.author ?? "unknown"),
      }));
  } catch {
    return [];
  }
}

export function parseRedditComments(json: string): SocialQuote[] {
  try {
    const parsed = JSON.parse(json) as {
      data?: Array<{ author?: string; body?: string; score?: number }>;
    };
    return (parsed.data ?? [])
      .filter((c) => c.body && c.author && c.author !== "AutoModerator")
      .map((c) => ({
        author: String(c.author),
        platform: "reddit",
        text: String(c.body).replace(/\s+/g, " ").trim().slice(0, 180),
        score: Number(c.score ?? 0),
      }))
      .filter((q) => q.text.length >= 20)
      .sort((a, b) => b.score - a.score);
  } catch {
    return [];
  }
}

export function parseDetikComments(html: string): number | null {
  const counts = [...html.matchAll(/comment-count=["']?(\d+)/gi)].map((m) => Number(m[1]));
  if (counts.length === 0) return null;
  return Math.max(...counts.filter((n) => Number.isFinite(n)));
}

function topicTokens(topic: AdjudicatedTopic): Set<string> {
  return new Set(tokenize(`${topic.title} ${topic.angle} ${topic.entities.join(" ")}`));
}

const GENERIC = new Set(["dpr", "kpk", "polri", "pemerintah", "presiden", "indonesia", "menteri"]);

function queryFor(topic: AdjudicatedTopic): string {
  // Entitas pertama biasanya subjek. Lewati nama lembaga umum yang membuat
  // query terlalu lebar (422: "dpr").
  const entities = topic.entities.filter((e) => e.length >= 3 && !e.includes("_"));
  const specific = entities.find((e) => !GENERIC.has(e));
  if (specific) return specific;
  if (entities[0]) return entities[0];
  const tokens = [...topicTokens(topic)].sort((a, b) => b.length - a.length);
  return tokens[0] ?? topic.title.split(/\s+/)[0] ?? "indonesia";
}

function overlaps(text: string, target: Set<string>): boolean {
  return tokenize(text).some((t) => target.has(t));
}

export function trendFor(topic: AdjudicatedTopic, trends: TrendItem[]): TrendItem | null {
  const target = topicTokens(topic);
  let best: { item: TrendItem; score: number } | null = null;
  for (const item of trends) {
    const score = tokenize(item.title).filter((t) => target.has(t)).length;
    if (score > 0 && (!best || score > best.score)) best = { item, score };
  }
  return best?.item ?? null;
}

export async function fetchTrends(fetchImpl: FetchFn = defaultFetch): Promise<TrendItem[]> {
  const res = await fetchImpl("https://trends.google.com/trending/rss?geo=ID");
  return res.ok ? parseTrends(res.text) : [];
}

export async function fetchReddit(
  topic: AdjudicatedTopic,
  fetchImpl: FetchFn = defaultFetch,
  afterEpoch?: number,
): Promise<{ posts: SocialPost[]; quotes: SocialQuote[] }> {
  const target = topicTokens(topic);
  const window = afterEpoch ? `&after=${afterEpoch}` : "";
  const res = await fetchImpl(
    `https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=indonesia&query=${encodeURIComponent(queryFor(topic))}&limit=8&sort=desc${window}`,
  );
  const posts = res.ok
    ? parseRedditPosts(res.text).filter((p) => overlaps(p.title, target)).slice(0, 5)
    : [];
  if (posts.length === 0) return { posts: [], quotes: [] };

  const top = posts[0]!;
  const id = top.url.match(/reddit\.com\/r\/[^/]+\/comments\/([^/]+)/)?.[1];
  let quotes: SocialQuote[] = [];
  if (id) {
    const c = await fetchImpl(
      `https://arctic-shift.photon-reddit.com/api/comments/search?link_id=t3_${encodeURIComponent(id)}&limit=20`,
    );
    if (c.ok) quotes = parseRedditComments(c.text).slice(0, 3);
  }
  return { posts, quotes };
}

export interface DetikSignals {
  total: number | null;
  quotes: SocialQuote[];
}

interface DetikComment {
  name?: string;
  comment?: string;
  like_count?: number;
}

/** Ambil total + kutipan dari halaman artikel dan API sneak-peek Detik. */
export async function fetchDetikSignals(
  cluster: Cluster,
  fetchImpl: FetchFn = defaultFetch,
  maxArticles = 3,
): Promise<DetikSignals> {
  const urls = cluster.articles.filter((a) => /(^|\.)detik\.com\//i.test(a.url)).slice(0, maxArticles);
  if (urls.length === 0) return { total: null, quotes: [] };

  let total: number | null = null;
  const quotes: SocialQuote[] = [];

  for (const a of urls) {
    const page = await fetchImpl(a.url);
    if (!page.ok) continue;
    const html = page.text;
    const id = html.match(/article_id=(\d+)/)?.[1] ?? a.url.match(/d-(\d+)/)?.[1];
    const channel = html.match(/channel_id=(\d+)/)?.[1];
    const site = html.match(/[?&]site=(\w+)/)?.[1] ?? "dtk";

    if (id && channel) {
      const api = `https://apicomment.detik.com/detail-article/sneak-peek/?article_id=${id}&channel_id=${channel}&site=${site}`;
      const res = await fetchImpl(api);
      if (res.ok) {
        try {
          const json = JSON.parse(res.text) as {
            data?: { total_comment?: number };
            data_v2?: { total_comment?: number; list_comment?: DetikComment[] };
          };
          const n = json.data_v2?.total_comment ?? json.data?.total_comment;
          if (typeof n === "number") total = (total ?? 0) + n;
          for (const c of json.data_v2?.list_comment ?? []) {
            const text = String(c.comment ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
            if (text.length < 20 || !c.name) continue;
            quotes.push({
              author: String(c.name),
              platform: "detik.com",
              text,
              score: Number(c.like_count ?? 0),
            });
          }
        } catch {
          /* bentuk API berubah; pakai hitungan HTML */
        }
      }
    }

    if (total === null) {
      const n = parseDetikComments(html);
      if (n !== null) total = (total ?? 0) + n;
    }
  }

  return { total, quotes: quotes.sort((a, b) => b.score - a.score).slice(0, 3) };
}

export interface SocialCandidate {
  topic: AdjudicatedTopic;
  cluster: Cluster;
}

export interface CollectOptions {
  db: Db;
  editionId: string;
  now: Date;
  fetchImpl?: FetchFn;
  maxTopics?: number;
}

function cached(db: Db, editionId: string, topicId: string): SocialSignals | null {
  try {
    const row = db.get<{ payload_json: string }>(
      "SELECT payload_json FROM social_cache WHERE edition_id = ? AND topic_id = ?",
      [editionId, topicId],
    );
    return row ? (JSON.parse(row.payload_json) as SocialSignals) : null;
  } catch {
    return null;
  }
}

function store(db: Db, editionId: string, topicId: string, signals: SocialSignals, now: Date): void {
  try {
    db.run(
      `INSERT INTO social_cache (edition_id, topic_id, payload_json, fetched_at)
       VALUES (?,?,?,?)
       ON CONFLICT(edition_id, topic_id) DO UPDATE SET
         payload_json = excluded.payload_json, fetched_at = excluded.fetched_at`,
      [editionId, topicId, JSON.stringify(signals), isoWib(now)!],
    );
  } catch {
    /* cache tidak boleh menggagalkan build */
  }
}

/**
 * Ambil sinyal untuk maksimum `maxTopics` kandidat. Cache per edisi/topik;
 * Trends hanya di-fetch bila ada kandidat yang belum punya cache.
 */
export async function collectSocial(
  candidates: Array<SocialCandidate & { topicId: string }>,
  opts: CollectOptions,
): Promise<Map<string, SocialSignals>> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const max = Math.min(opts.maxTopics ?? 8, candidates.length);
  const picked = candidates.slice(0, max);
  const out = new Map<string, SocialSignals>();
  let trends: TrendItem[] | null = null;
  // Arctic Shift membatasi query lebar; batasi 7 hari dan beri jeda antar topik.
  const afterEpoch = Math.floor(opts.now.getTime() / 1000) - 7 * 86_400;

  for (const [index, c] of picked.entries()) {
    const hit = cached(opts.db, opts.editionId, c.topicId);
    if (hit) {
      out.set(c.topicId, hit);
      continue;
    }

    const signals = empty();
    try {
      // Reddit hanya untuk empat kandidat teratas: kuota API ketat (429).
      if (index < 4) {
        const reddit = await fetchReddit(c.topic, fetchImpl, afterEpoch);
        if (reddit.posts.length) {
          signals.posts = reddit.posts;
          signals.quotes = reddit.quotes;
          signals.reddit_score = reddit.posts.reduce((n, p) => n + p.score, 0);
          signals.reddit_comments = reddit.posts.reduce((n, p) => n + p.comments, 0);
        }
        await new Promise((r) => setTimeout(r, 1200));
      }
      const detik = await fetchDetikSignals(c.cluster, fetchImpl);
      signals.detik_comments = detik.total;
      signals.quotes = [...detik.quotes, ...signals.quotes];

      if (trends === null) trends = await fetchTrends(fetchImpl);
      const trend = trendFor(c.topic, trends);
      if (trend) {
        signals.trend_title = trend.title;
        signals.trend_interest = trend.traffic;
      }
    } catch {
      /* sinyal gagal: tetap simpan yang ada */
    }

    // Jangan cache hasil kosong: 422/rate-limit bisa sementara.
    const hasSignal =
      signals.reddit_score !== null ||
      signals.detik_comments !== null ||
      signals.trend_interest !== null ||
      signals.posts.length > 0;
    if (hasSignal) store(opts.db, opts.editionId, c.topicId, signals, opts.now);
    out.set(c.topicId, signals);

  }

  return out;
}
