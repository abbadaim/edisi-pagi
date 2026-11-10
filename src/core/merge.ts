import type { AdjudicatedTopic } from "./adjudicate.ts";
import type { Cluster } from "./cluster.ts";
import { features, similarity } from "./simhash.ts";

export interface TopicEntry {
  topic: AdjudicatedTopic;
  cluster: Cluster;
}

export interface MergeRecord {
  kept: string;
  dropped: string;
  score: number;
  reason: "judul" | "artikel" | "entitas";
}

export interface MergeResult {
  entries: TopicEntry[];
  merges: MergeRecord[];
}

const sim = (a: string, b: string) => similarity(features(a), features(b));

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Judul artikel paling mirip antara dua klaster. */
function crossArticleSim(a: Cluster, b: Cluster): number {
  let best = 0;
  for (const x of a.articles.slice(0, 8)) {
    for (const y of b.articles.slice(0, 8)) {
      const s = sim(x.title, y.title);
      if (s > best) best = s;
    }
  }
  return best;
}

function unionCluster(a: Cluster, b: Cluster): Cluster {
  const byId = new Map<string, Cluster["articles"][number]>();
  for (const x of [...a.articles, ...b.articles]) byId.set(x.id, x);
  const articles = [...byId.values()].sort(
    (x, y) => Date.parse(x.publishedAt ?? "0") - Date.parse(y.publishedAt ?? "0"),
  );
  return {
    key: a.key,
    articles,
    outlets: [...new Set(articles.map((x) => x.outlet))],
    entities: [...new Set([...a.entities, ...b.entities])],
    score: a.score + b.score,
  };
}

/**
 * Gabungkan topik yang sebenarnya satu peristiwa.
 *
 * Adjudikasi kadang memecah satu thread menjadi dua topik (mis. "DPR sepakat"
 * dan "Gibran mundur"). Dua kartu untuk satu peristiwa terasa seperti
 * pengulangan, jadi digabung sebelum registry: satu topik, satu kartu, semua
 * artikelnya tetap dipakai writer.
 *
 * Ambang dibuat konservatif — lebih baik dua kartu daripada satu kartu yang
 * mencampur dua peristiwa berbeda.
 */
export function mergeDuplicateTopics(entries: TopicEntry[]): MergeResult {
  const sorted = [...entries].sort(
    (a, b) =>
      b.cluster.articles.length - a.cluster.articles.length ||
      b.topic.significance - a.topic.significance,
  );

  const kept: TopicEntry[] = [];
  const merges: MergeRecord[] = [];

  for (const e of sorted) {
    let target: TopicEntry | null = null;
    let record: MergeRecord | null = null;

    for (const k of kept) {
      // Peristiwa lokal dan nasional tidak pernah digabung: pembaca Sleman
      // perlu keduanya di edisi yang berbeda.
      if (Boolean(k.topic.local) !== Boolean(e.topic.local)) continue;

      const title = sim(
        `${k.topic.title} ${k.topic.angle}`,
        `${e.topic.title} ${e.topic.angle}`,
      );
      const cross = crossArticleSim(k.cluster, e.cluster);
      const ent = jaccard(k.topic.entities, e.topic.entities);

      // Peristiwa lokal punya judul yang sangat spesifik (nama tempat + jenis
      // kejadian), jadi ambangnya bisa lebih longgar tanpa mencampur cerita.
      const local = Boolean(k.topic.local) && Boolean(e.topic.local);
      const titleMin = local ? 0.28 : 0.4;
      const crossMin = local ? 0.45 : 0.55;
      const entMin = local ? 0.4 : 0.5;
      const entTitleMin = local ? 0.14 : 0.18;

      if (title >= titleMin) {
        target = k;
        record = { kept: k.topic.title, dropped: e.topic.title, score: title, reason: "judul" };
      } else if (cross >= crossMin) {
        target = k;
        record = { kept: k.topic.title, dropped: e.topic.title, score: cross, reason: "artikel" };
      } else if (ent >= entMin && title >= entTitleMin) {
        target = k;
        record = { kept: k.topic.title, dropped: e.topic.title, score: ent, reason: "entitas" };
      }
      if (target) break;
    }

    if (!target || !record) {
      kept.push(e);
      continue;
    }

    target.cluster = unionCluster(target.cluster, e.cluster);
    target.topic = {
      ...target.topic,
      cids: [...new Set([...target.topic.cids, ...e.topic.cids])],
      entities: [...new Set([...target.topic.entities, ...e.topic.entities])],
      significance: Math.max(target.topic.significance, e.topic.significance),
      heavy: target.topic.heavy || e.topic.heavy,
      horse_race: target.topic.horse_race && e.topic.horse_race,
      drop: target.topic.drop && e.topic.drop,
    };
    merges.push(record);
  }

  return { entries: kept, merges };
}
