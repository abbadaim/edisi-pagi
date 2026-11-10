import type { AdjudicatedTopic, TopicCategory } from "./adjudicate.ts";
import type { Cluster } from "./cluster.ts";

export interface RankedTopic {
  topic: AdjudicatedTopic;
  topicId: string;
  cluster: Cluster;
  local: boolean;
  tier1: boolean;
  score: number;
}

export interface RankOptions {
  scope: "nasional" | "lokal";
  now?: Date;
  /** Topik yang kemarin ada di posisi 1–2 dan tidak berubah. */
  recentTop?: Set<string>;
  maxArticlesPerCategory?: number;
  maxHeavy?: number;
}

const DIY = /(detik\.com\/jogja|jogja\.tribunnews\.com|harianjogja\.com|krjogja\.com|radarjogja\.co\.id|jogjaprov\.go\.id|slemankab\.go\.id)/i;

/**
 * Klaster dianggap lokal jika **mayoritas** artikelnya dari media DIY.
 * Satu artikel detik/jogja di dalam klaster nasional tidak boleh membalik
 * seluruh topik menjadi lokal — itu menghilangkan cerita terbesar dari edisi.
 */
export function isLocalCluster(cluster: Cluster): boolean {
  if (cluster.articles.length === 0) return false;
  const n = cluster.articles.filter((a) => DIY.test(a.url)).length;
  return n / cluster.articles.length >= 0.5;
}

function urlOf(cluster: Cluster): string[] {
  return cluster.articles.map((a) => a.url);
}

/** Tier 1 didekati dari domain resmi; sumber primer di Indonesia hampir selalu .go.id. */
function hasTier1(cluster: Cluster): boolean {
  return cluster.articles.some((a) => /\.go\.id\//i.test(a.url));
}

function hoursSince(iso: string | null, now: Date): number {
  if (!iso) return 72;
  return Math.max(0, (now.getTime() - Date.parse(iso)) / 3_600_000);
}

export function coverageScore(articles: number): number {
  return Math.min(1, Math.log(1 + articles) / Math.log(21));
}

export function scoreTopic(
  entry: { topic: AdjudicatedTopic; cluster: Cluster },
  scope: "nasional" | "lokal",
  now: Date,
): number {
  const { topic, cluster } = entry;
  const newest = cluster.articles[cluster.articles.length - 1]?.publishedAt ?? null;
  const recency = Math.max(0, 1 - hoursSince(newest, now) / 48);
  const coverage = coverageScore(cluster.articles.length);
  const sig = (topic.significance - 1) / 4;
  const t1 = hasTier1(cluster) ? 1 : 0;

  if (scope === "lokal") {
    const utility = topic.kind === "utility" ? 1 : topic.kind === "breaking" ? 0.5 : 0;
    return 0.3 * coverage + 0.25 * sig + 0.2 * recency + 0.15 * utility + 0.1 * t1;
  }

  // Amplifikasi belum tersedia sampai M6; bobot 0,10 dibiarkan kosong.
  return 0.3 * coverage + 0.25 * sig + 0.2 * recency + 0.15 * t1;
}

export interface FilterStats {
  drop: number;
  horseRace: number;
  orphan: number;
  stale: number;
  localOnly: number;
}

function isStale(cluster: Cluster, now: Date): boolean {
  const newest = cluster.articles[cluster.articles.length - 1]?.publishedAt ?? null;
  return hoursSince(newest, now) > 72;
}

/** Filter keras (RANKING.md §3). */
export function hardFilter(
  entries: Array<{ topic: AdjudicatedTopic; cluster: Cluster }>,
  scope: "nasional" | "lokal",
  now: Date,
): { kept: Array<{ topic: AdjudicatedTopic; cluster: Cluster }>; stats: FilterStats } {
  const stats: FilterStats = { drop: 0, horseRace: 0, orphan: 0, stale: 0, localOnly: 0 };
  const kept: Array<{ topic: AdjudicatedTopic; cluster: Cluster }> = [];

  for (const e of entries) {
    if (e.topic.drop) {
      stats.drop++;
      continue;
    }
    if (e.topic.horse_race) {
      stats.horseRace++;
      continue;
    }
    // Klaster dengan 2 artikel dari 2 outlet tetap boleh; 1 artikel tidak.
    if (e.cluster.articles.length < 2) {
      stats.orphan++;
      continue;
    }
    if (isStale(e.cluster, now)) {
      stats.stale++;
      continue;
    }

    const local = isLocalCluster(e.cluster);
    if (scope === "lokal" && !local) {
      stats.localOnly++;
      continue;
    }

    kept.push(e);
  }

  return { kept, stats };
}

export interface Selection {
  selected: RankedTopic[];
  excludedByBudget: string[];
}

/**
 * Terapkan skor lalu batas kategori dan anggaran suasana hati.
 * Urutan penting: skor dulu, batas belakangan, supaya penolakan bisa dijelaskan.
 */
export function select(
  kept: Array<{ topic: AdjudicatedTopic; cluster: Cluster; topicId?: string }>,
  opts: RankOptions,
): Selection {
  const now = opts.now ?? new Date();
  const scope = opts.scope;
  const maxCat = opts.maxArticlesPerCategory ?? 2;
  const maxHeavy = opts.maxHeavy ?? (scope === "nasional" ? 2 : 1);

  const ranked: RankedTopic[] = kept
    .map((e) => {
      let score = scoreTopic(e, scope, now);
      const topicId = e.topicId ?? e.topic.title;
      if (opts.recentTop?.has(topicId)) score -= 0.15;
      return {
        topic: e.topic,
        topicId,
        cluster: e.cluster,
        local: isLocalCluster(e.cluster),
        tier1: hasTier1(e.cluster),
        score,
      };
    })
    .sort((a, b) => b.score - a.score);

  const selected: RankedTopic[] = [];
  const perCategory = new Map<TopicCategory, number>();
  const excluded: string[] = [];
  let heavy = 0;

  for (const r of ranked) {
    const cat = r.topic.category;
    const n = perCategory.get(cat) ?? 0;
    if (n >= maxCat) {
      excluded.push(`${r.topicId} (kategori ${cat})`);
      continue;
    }
    if (r.topic.heavy) {
      if (heavy >= maxHeavy) {
        excluded.push(`${r.topicId} (anggaran suasana hati)`);
        continue;
      }
      heavy++;
    }
    perCategory.set(cat, n + 1);
    selected.push(r);
  }

  return { selected, excludedByBudget: excluded };
}

export { urlOf };
