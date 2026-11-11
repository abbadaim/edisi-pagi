/**
 * Kartu `gap` (Yang Luput) dan `debate` (Yang Diperdebatkan) dari sinyal
 * amplifikasi (rencana 007). Deterministik: tidak ada panggilan model.
 */

import type { AdjudicatedTopic } from "../adjudicate.ts";
import type { Cluster } from "../cluster.ts";
import type { Card, Source } from "../types.ts";
import type { SocialSignals } from "./social.ts";
import { truncateWords } from "../normalize.ts";
import { isoWib } from "../time.ts";
import { sourcesFromCluster } from "../writer.ts";

export interface SocialEntry {
  topic: AdjudicatedTopic;
  cluster: Cluster;
  topicId: string;
  signals: SocialSignals;
}

export function amplification(s: SocialSignals): number {
  return (
    (s.reddit_score ?? 0) +
    2 * (s.reddit_comments ?? 0) +
    (s.detik_comments ?? 0) +
    (s.trend_interest ?? 0) / 1000
  );
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 38);
}

function platforms(s: SocialSignals): string[] {
  const out: string[] = [];
  if ((s.reddit_score ?? 0) > 0 || (s.reddit_comments ?? 0) > 0) out.push("Reddit");
  if ((s.detik_comments ?? 0) > 0) out.push("Detik");
  if ((s.trend_interest ?? 0) > 0) out.push("Trends");
  return out;
}

function articleSources(cluster: Cluster, now: Date, max = 3): Source[] {
  return sourcesFromCluster(cluster, now, max);
}

function socialSource(outlet: string, url: string, now: Date, tier: 1 | 2 | 3 = 3): Source {
  return { outlet, url, published_at: null, tier, accessed_at: isoWib(now)! };
}

export interface GapPick {
  entry: SocialEntry;
  gapRank: number;
  ampRank: number;
  coverageRank: number;
}

/** Hanya gap positif (ramai, sedikit diliput). */
export function computeGap(entries: SocialEntry[], minRank = 5): GapPick | null {
  const eligible = entries.filter(
    (e) => e.cluster.outlets.length >= 2 && amplification(e.signals) > 0,
  );
  if (eligible.length < 2) return null;

  // Peringkat naik: 1 = paling sedikit artikel / amplifikasi terendah.
  // gap = peringkat(amplifikasi) − peringkat(liputan); positif = ramai, luput.
  const byCoverage = [...eligible].sort(
    (a, b) =>
      a.cluster.articles.length - b.cluster.articles.length ||
      a.cluster.outlets.length - b.cluster.outlets.length,
  );
  const coverageRank = new Map(byCoverage.map((e, i) => [e.topicId, i + 1]));

  const byAmp = [...eligible].sort(
    (a, b) => amplification(a.signals) - amplification(b.signals),
  );
  const ampRank = new Map(byAmp.map((e, i) => [e.topicId, i + 1]));

  const picks: GapPick[] = eligible
    .map((entry) => {
      const amp = ampRank.get(entry.topicId)!;
      const cov = coverageRank.get(entry.topicId)!;
      return { entry, ampRank: amp, coverageRank: cov, gapRank: amp - cov };
    })
    .filter((p) => p.gapRank >= minRank)
    .sort((a, b) => b.gapRank - a.gapRank || amplification(b.entry.signals) - amplification(a.entry.signals));

  return picks[0] ?? null;
}

export function buildGapCard(pick: GapPick, opts: { editionId: string; now: Date }): Card {
  const { entry, gapRank } = pick;
  const { topic, cluster, signals } = entry;
  const n = cluster.articles.length;
  const m = cluster.outlets.length;
  const names = platforms(signals);
  const absent = `Ramai di ${names.join(" + ") || "sosial"} tetapi hanya ${n} artikel dari ${m} media.`;

  const socialText = [
    signals.reddit_score != null ? `Reddit: ${signals.reddit_score} skor, ${signals.reddit_comments ?? 0} komentar` : null,
    signals.detik_comments != null ? `Detik: ${signals.detik_comments} komentar` : null,
    signals.trend_interest != null ? `Google Trends: ${signals.trend_interest}+ pencarian${signals.trend_title ? ` (“${signals.trend_title}”)` : ""}` : null,
  ].filter(Boolean) as string[];

  const body = [
    `Topik ini ramai di luar media: ${socialText.join("; ")}.`,
    `Liputannya hanya ${n} artikel dari ${m} media. Peringkat amplifikasi ${pick.ampRank}, peringkat liputan ${pick.coverageRank} — selisih ${gapRank}.`,
    `Angka sosial bukan sampel representatif publik Indonesia. Yang bisa disimpulkan: ada perhatian yang tidak sebanding dengan liputan, bukan bahwa klaimnya benar.`,
  ];

  const sources = articleSources(cluster, opts.now, 3);
  const topPost = signals.posts[0];
  if (topPost) sources.push(socialSource("Reddit", topPost.url, opts.now));
  if (signals.trend_title) {
    sources.push(socialSource("Google Trends", "https://trends.google.com/trending/rss?geo=ID", opts.now));
  }

  const timeline = cluster.articles.slice(-5).map((a) => ({
    at: a.publishedAt ? isoWib(new Date(a.publishedAt))! : isoWib(opts.now)!,
    outlet: a.outlet,
    url: a.url,
  }));

  return {
    id: "c1",
    type: "gap",
    topic_id: `t_gap_${slug(entry.topicId)}`,
    angle: `Ramai di ${names[0] ?? "sosial"} · ${n} artikel`.slice(0, 90),
    kicker: "Yang luput",
    title: `Yang luput: ${truncateWords(topic.title, 70 - 12)}`,
    status: "belum",
    truth: null,
    body,
    action: "Cari sumber primer sebelum menyimpulkan.",
    image: null,
    sources,
    revision: 1,
    first_seen: opts.editionId,
    previous_edition: null,
    changes: [],
    social: {
      reddit_score: signals.reddit_score,
      reddit_comments: signals.reddit_comments,
      detik_comments: signals.detik_comments,
      trend_interest: signals.trend_interest,
      tiktok_delta: null,
    },
    coverage: { article_count: n, outlets: cluster.outlets },
    gap_rank: gapRank,
    absent_angle: absent,
    first_detected: isoWib(opts.now)!,
    days_watched: 1,
    state: "luput",
    coverage_timeline: timeline,
  } as Card;
}

const NEG = /\b(mundur|bohong|malu|gagal|parah|kacau|tolak|protes|marah|kecewa|curang|korup|tipu)\b/gi;
const POS = /\b(dukung|setuju|bagus|benar|lanjutkan|apresiasi|hebat|setia)\b/gi;

export function toneOf(quotes: Array<{ text: string }>): string {
  const text = quotes.map((q) => q.text).join(" ");
  const neg = (text.match(NEG) ?? []).length;
  const pos = (text.match(POS) ?? []).length;
  if (neg >= pos * 2 && neg > 0) return "Mayoritas kritis";
  if (pos >= neg * 2 && pos > 0) return "Mayoritas mendukung";
  return "Terbelah";
}

export interface DebatePick {
  entry: SocialEntry;
  volume: { platform: string; count: number };
  comparison: { platform: string; count: number; note: string } | null;
}

export function computeDebate(
  entries: SocialEntry[],
  opts: { minComments?: number; minScore?: number } = {},
): DebatePick | null {
  const minComments = opts.minComments ?? 15;
  const minScore = opts.minScore ?? 200;

  const eligible = entries
    .map((entry) => {
      const s = entry.signals;
      const detik = s.detik_comments ?? 0;
      const reddit = s.reddit_comments ?? 0;
      const topScore = Math.max(0, ...s.posts.map((p) => p.score));
      const ok = detik >= minComments || reddit >= minComments || topScore >= minScore;
      if (!ok || s.quotes.length < 2) return null;

      const volume =
        detik >= reddit
          ? { platform: "detik.com", count: detik }
          : { platform: "reddit", count: reddit };
      const other =
        volume.platform === "detik.com"
          ? { platform: "reddit", count: reddit }
          : { platform: "detik.com", count: detik };
      const comparison = other.count > 0
        ? {
            platform: other.platform,
            count: other.count,
            note: other.count < 5 ? "nyaris tidak bergerak" : "juga aktif",
          }
        : null;
      return { entry, volume, comparison };
    })
    .filter((x): x is DebatePick => x !== null)
    .sort(
      (a, b) =>
        b.volume.count - a.volume.count ||
        (b.entry.signals.reddit_score ?? 0) - (a.entry.signals.reddit_score ?? 0),
    );

  return eligible[0] ?? null;
}

export function buildDebateCard(pick: DebatePick, opts: { editionId: string; now: Date }): Card {
  const { entry, volume, comparison } = pick;
  const { topic, cluster, signals } = entry;
  const quotes = signals.quotes.slice(0, 3);
  const tone = toneOf(quotes);
  const other = comparison ? `${comparison.platform}: ${comparison.count} (${comparison.note})` : "tidak ada sinyal pembanding";

  const reading = `Publik vokal di ${volume.platform} (${volume.count}); ${other}.`;

  const body = [
    `Ada ${volume.count} komentar di ${volume.platform} untuk topik ini. Nada bacaan: ${tone.toLowerCase()}.`,
    `Komentar teratas menyoroti persoalan yang tidak selalu muncul di liputan: ${quotes.map((q) => `“${q.text.slice(0, 90)}”`).join(" ")}.`,
    "Komentar internet bukan sampel representatif publik Indonesia. Kartu ini mencatat apa yang diperdebatkan, bukan siapa yang benar.",
  ];

  const sources: Source[] = cluster.articles.slice(0, 2).map((a) => ({
    outlet: a.outlet,
    url: a.url,
    published_at: a.publishedAt ? isoWib(new Date(a.publishedAt))! : null,
    tier: 2 as const,
    accessed_at: isoWib(opts.now)!,
  }));
  for (const p of signals.posts.slice(0, 2)) {
    sources.push(socialSource("Reddit", p.url, opts.now));
  }

  return {
    id: "c1",
    type: "debate",
    topic_id: `t_debate_${slug(entry.topicId)}`,
    angle: "Publik vokal, media sepi".slice(0, 90),
    kicker: "Yang diperdebatkan",
    title: `Yang diperdebatkan: ${truncateWords(topic.title, 70 - 20)}`,
    status: "belum",
    truth: null,
    body,
    action: "Baca komentar dengan sadar bahwa ini bukan sampel representatif.",
    image: null,
    sources,
    revision: 1,
    first_seen: opts.editionId,
    previous_edition: null,
    changes: [],
    volume,
    tone,
    quotes,
    comparison,
    reading,
  } as Card;
}

const PRIORITY: Record<string, number> = {
  change: 40,
  debate: 30,
  gap: 20,
  misread: 10,
};

/** Maksimum dua kartu meta; change dipertahankan (DEC-0008/rencana 007). */
export function selectMetaCards(cards: Card[], limit = 2): Card[] {
  return [...cards]
    .sort((a, b) => (PRIORITY[b.type] ?? 0) - (PRIORITY[a.type] ?? 0))
    .slice(0, limit);
}
