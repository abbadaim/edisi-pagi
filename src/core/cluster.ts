import type { Db } from "../adapters/db/sqlite.ts";
import { features, similarity } from "./simhash.ts";

export interface ArticleRow {
  id: string;
  url: string;
  outlet: string;
  title: string;
  titleNorm: string;
  lead: string;
  publishedAt: string | null;
  entities: Array<{ id: string; idf: number; df: number }>;
}

export interface ClusterOptions {
  /** Ambang kemiripan gabungan. */
  threshold?: number;
  /** J dan C minimum untuk jalur alternatif (CLUSTERING.md §6). */
  jaccardMin?: number;
  cosineMin?: number;
  /** Minimal artikel dan outlet agar klaster lolos. */
  minArticles?: number;
  minOutlets?: number;
  /** Batas ukuran klaster. */
  maxArticles?: number;
  /** Jarak waktu maksimum antar artikel, jam. */
  maxGapHours?: number;
  /** IDF minimum agar entitas dianggap distintif. */
  minIdf?: number;
}

const DEFAULTS: Required<ClusterOptions> = {
  threshold: 0.3,
  jaccardMin: 0.5,
  cosineMin: 0.55,
  minArticles: 3,
  minOutlets: 2,
  maxArticles: 25,
  maxGapHours: 72,
  minIdf: 1.5,
};

export interface Cluster {
  key: string;
  articles: ArticleRow[];
  outlets: string[];
  entities: string[];
  score: number;
}

interface Prepared {
  row: ArticleRow;
  feats: Map<string, number>;
  ents: Map<string, number>;
  t: number;
}

/** Entitas distintif saja; IDf di bawah ambang dibuang dari kunci. */
/**
 * Hanya entitas yang (a) cukup distintif dan (b) muncul di >=2 artikel.
 *
 * Entitas df=1 tidak bisa membuat blok (CLUSTERING.md §5.2), tetapi kalau ikut
 * dihitung ia mendominasi Jaccard berbobot — satu artikel bisa membawa lima
 * singleton ber-IDF maksimum dan menekan J ke ~0,1 untuk cerita yang sama.
 * Bobot juga dibatasi 4 agar satu nama langka tidak menentukan segalanya.
 */
function entityWeights(row: ArticleRow, minIdf: number): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of row.entities) {
    if (e.idf >= minIdf && e.df >= 2) m.set(e.id, Math.min(e.idf, 4));
  }
  return m;
}

function weightedJaccard(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  let union = 0;
  for (const [k, w] of a) {
    const w2 = b.get(k);
    if (w2 === undefined) union += w;
    else {
      inter += Math.min(w, w2);
      union += Math.max(w, w2);
    }
  }
  for (const [k, w] of b) if (!a.has(k)) union += w;
  return union === 0 ? 0 : inter / union;
}

function timeFactor(a: number, b: number, maxGapHours: number): number {
  const hours = Math.abs(a - b) / 3_600_000;
  if (hours <= 12) return 1;
  if (hours <= maxGapHours) return 0.5;
  return 0;
}

function sharedEntities(a: Map<string, number>, b: Map<string, number>): number {
  let n = 0;
  for (const k of a.keys()) if (b.has(k)) n++;
  return n;
}

/**
 * Skor = 0,6 J + 0,4 C, tetapi hanya jika bukti cukup.
 *
 * Jaccard atas entitas mudah bernilai 1,0 ketika dua artikel hanya punya satu
 * entitas yang sama — dua berita Turki yang tidak berhubungan pernah dapat
 * J=1,00 dan C=0,04. Karena itu jumlah entitas bersama dipakai sebagai gerbang,
 * bukan sebagai bobot.
 */
export function similarityOf(
  a: Prepared,
  b: Prepared,
  opts: Required<ClusterOptions>,
): { total: number; j: number; c: number; t: number; shared: number } {
  const j = weightedJaccard(a.ents, b.ents);
  const c = similarity(a.feats, b.feats);
  const t = timeFactor(a.t, b.t, opts.maxGapHours);
  const shared = sharedEntities(a.ents, b.ents);

  let ok = t > 0;
  if (ok && shared === 0) ok = false;
  // Satu entitas bersama hanya cukup jika teksnya sendiri sudah mirip.
  if (ok && shared === 1 && c < 0.55) ok = false;

  return { total: ok ? 0.6 * j + 0.4 * c : 0, j, c, t, shared };
}

export function prepare(rows: ArticleRow[], opts: ClusterOptions = {}): Prepared[] {
  const o = { ...DEFAULTS, ...opts };
  return rows.map((row) => ({
    row,
    feats: features(`${row.titleNorm} ${row.lead}`),
    ents: entityWeights(row, o.minIdf),
    t: row.publishedAt ? Date.parse(row.publishedAt) : Number.NaN,
  }));
}

/**
 * Single-linkage dengan batas ukuran. Deterministik: urutan masukan menentukan
 * hasil saat ada seri, jadi artikel harus diurutkan sebelum masuk.
 */
export function clusterArticles(rows: ArticleRow[], opts: ClusterOptions = {}): Cluster[] {
  const o = { ...DEFAULTS, ...opts };
  const items = prepare(rows, opts);

  // Union-find sederhana.
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const s = similarityOf(items[i]!, items[j]!, o);
      if (s.total >= o.threshold) union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < items.length; i++) {
    const r = find(i);
    const arr = groups.get(r) ?? [];
    arr.push(i);
    groups.set(r, arr);
  }

  const clusters: Cluster[] = [];

  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;

    // Batasi ukuran: ambil yang paling dekat dengan pusat (kepadatan rata-rata).
    let members = idxs;
    if (members.length > o.maxArticles) {
      const density = members.map((i) => {
        let sum = 0;
        for (const j of members) if (i !== j) sum += similarityOf(items[i]!, items[j]!, o).total;
        return { i, d: sum / (members.length - 1) };
      });
      members = density
        .sort((a, b) => b.d - a.d)
        .slice(0, o.maxArticles)
        .map((x) => x.i);
    }

    const rowsIn = members.map((i) => items[i]!.row);
    const outlets = [...new Set(rowsIn.map((r) => r.outlet))];

    // CLUSTERING.md §6: cukup salah satu, bukan keduanya.
    if (rowsIn.length < o.minArticles && outlets.length < o.minOutlets) continue;

    // Skor klaster: ukuran × keragaman outlet × kepadatan rata-rata.
    let pairSum = 0;
    let pairs = 0;
    for (let a = 0; a < members.length; a++) {
      for (let b = a + 1; b < members.length; b++) {
        pairSum += similarityOf(items[members[a]!]!, items[members[b]!]!, o).total;
        pairs++;
      }
    }
    const density = pairs === 0 ? 0 : pairSum / pairs;

    const entCount = new Map<string, number>();
    for (const r of rowsIn) for (const e of r.entities) {
      if (e.idf >= o.minIdf && e.df >= 2) entCount.set(e.id, (entCount.get(e.id) ?? 0) + 1);
    }
    const topEntities = [...entCount.entries()]
      .filter(([, n]) => n >= Math.max(2, Math.ceil(rowsIn.length * 0.4)))
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);

    clusters.push({
      key: rowsIn
        .map((r) => r.id)
        .sort()
        .join("|")
        .slice(0, 40),
      articles: rowsIn.sort(
        (a, b) => Date.parse(a.publishedAt ?? "0") - Date.parse(b.publishedAt ?? "0"),
      ),
      outlets,
      entities: topEntities,
      score: rowsIn.length * Math.min(outlets.length, 5) * (0.5 + density),
    });
  }

  return clusters.sort((a, b) => b.score - a.score);
}

export function loadArticles(db: Db, fromIso: string, toIso: string): ArticleRow[] {
  const rows = db.all<{
    id: string;
    url: string;
    outlet: string;
    title_display: string;
    title_norm: string;
    lead: string | null;
    published_at: string | null;
  }>(
    `SELECT id, url, outlet, title_display, title_norm, lead, published_at
       FROM articles
      WHERE is_duplicate_of IS NULL
        AND published_at >= ? AND published_at <= ?
      ORDER BY published_at ASC`,
    [fromIso, toIso],
  );

  const ents = db.all<{ article_id: string; entity_id: string; idf: number; df: number }>(
    `SELECT ae.article_id, ae.entity_id, COALESCE(e.idf, 0) AS idf, COALESCE(e.df, 0) AS df
       FROM article_entities ae
       JOIN entities e ON e.id = ae.entity_id
       JOIN articles a ON a.id = ae.article_id
      WHERE a.is_duplicate_of IS NULL
        AND a.published_at >= ? AND a.published_at <= ?`,
    [fromIso, toIso],
  );

  const byArticle = new Map<string, Array<{ id: string; idf: number; df: number }>>();
  for (const e of ents) {
    const arr = byArticle.get(e.article_id) ?? [];
    arr.push({ id: e.entity_id, idf: Number(e.idf), df: Number(e.df) });
    byArticle.set(e.article_id, arr);
  }

  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    outlet: r.outlet,
    title: r.title_display,
    titleNorm: r.title_norm,
    lead: r.lead ?? "",
    publishedAt: r.published_at,
    entities: byArticle.get(r.id) ?? [],
  }));
}
