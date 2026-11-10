import { createHash } from "node:crypto";
import type { Db } from "../adapters/db/sqlite.ts";
import type { AdjudicatedTopic } from "./adjudicate.ts";
import { features, similarity } from "./simhash.ts";

export interface TopicRecord {
  topic_id: string;
  canonical_title: string;
  kind: string;
  first_seen: string;
  last_updated: string;
  revision: number;
  entities: Set<string>;
  aliases: Set<string>;
}

export interface ResolveResult {
  topic_id: string;
  is_new: boolean;
  revision: number;
  j: number;
  c: number;
  confirmed: boolean;
}

const SLUG_MAX = 30;

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/_+$/g, "");
}

/**
 * `t_{slug}_{hash4}` — dibuat sekali, dibekukan (CLUSTERING.md §12).
 * Hash berasal dari himpunan entitas pendiri agar slug kembar tidak bertabrakan.
 */
export function makeTopicId(title: string, entityIds: string[]): string {
  const hash = createHash("sha1").update([...entityIds].sort().join("|")).digest("hex").slice(0, 4);
  const slug = slugify(title) || "topik";
  return `t_${slug}_${hash}`;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface ResolveThresholds {
  /** J & C minimum untuk match otomatis. */
  autoJ?: number;
  autoC?: number;
  /** Di bawah ini dianggap topik baru. */
  floorJ?: number;
  floorC?: number;
  /** Batas panggilan konfirmasi LLM per run. */
  maxConfirm?: number;
}

const DEFAULTS: Required<ResolveThresholds> = {
  autoJ: 0.5,
  autoC: 0.4,
  floorJ: 0.35,
  floorC: 0.7,
  maxConfirm: 5,
};

export function loadRegistry(db: Db, sinceIso: string): TopicRecord[] {
  const rows = db.all<{
    topic_id: string;
    canonical_title: string;
    kind: string | null;
    first_seen: string;
    last_updated: string;
    revision: number;
  }>(
    `SELECT topic_id, canonical_title, kind, first_seen, last_updated, revision
       FROM topics
      WHERE merged_into IS NULL AND last_updated >= ?
      ORDER BY last_updated DESC`,
    [sinceIso],
  );

  const ents = db.all<{ topic_id: string; entity_id: string }>(
    "SELECT topic_id, entity_id FROM topic_entities",
  );
  const aliases = db.all<{ topic_id: string; alias: string }>("SELECT topic_id, alias FROM topic_aliases");

  const entMap = new Map<string, Set<string>>();
  for (const e of ents) {
    const s = entMap.get(e.topic_id) ?? new Set<string>();
    s.add(e.entity_id);
    entMap.set(e.topic_id, s);
  }
  const aliasMap = new Map<string, Set<string>>();
  for (const a of aliases) {
    const s = aliasMap.get(a.topic_id) ?? new Set<string>();
    s.add(a.alias);
    aliasMap.set(a.topic_id, s);
  }

  return rows.map((r) => ({
    topic_id: r.topic_id,
    canonical_title: r.canonical_title,
    kind: r.kind ?? "ongoing",
    first_seen: r.first_seen,
    last_updated: r.last_updated,
    revision: Number(r.revision),
    entities: entMap.get(r.topic_id) ?? new Set(),
    aliases: aliasMap.get(r.topic_id) ?? new Set(),
  }));
}

export interface ResolveOptions extends ResolveThresholds {
  /** Konfirmasi LLM untuk kasus borderline. Opsional. */
  confirm?: (candidate: AdjudicatedTopic, record: TopicRecord) => Promise<boolean>;
  /** Dipakai untuk membatasi jumlah konfirmasi per run. */
  counter?: { n: number };
  now?: Date;
  editionId?: string;
}

/**
 * Cocokkan topik hasil adjudikasi dengan registry.
 *
 * Asimetri yang disengaja: `unclear` diperlakukan sebagai `different`.
 * Memecah thread menghasilkan dua kartu biasa — terlihat dan bisa digabung nanti.
 * Menggabungkan dua cerita berbeda merusak `changes[]` secara diam-diam.
 */
export async function resolveTopic(
  db: Db,
  candidate: AdjudicatedTopic,
  registry: TopicRecord[],
  opts: ResolveOptions = {},
): Promise<ResolveResult> {
  const o = { ...DEFAULTS, ...opts };
  const candEnts = new Set(candidate.entities);
  const candFeats = features(candidate.title);

  let best: { rec: TopicRecord; j: number; c: number } | null = null;

  for (const rec of registry) {
    const j = jaccard(candEnts, rec.entities);
    const c = Math.max(
      similarity(candFeats, features(rec.canonical_title)),
      ...[...rec.aliases].map((a) => similarity(candFeats, features(a))),
    );
    if (!best || j + c > best.j + best.c) best = { rec, j, c };
  }

  let chosen: { rec: TopicRecord; j: number; c: number } | null = null;
  let confirmed = false;

  if (best && (best.j >= o.autoJ! || (best.j >= o.autoJ! - 0.2 && best.c >= o.autoC!))) {
    chosen = best;
  } else if (best && (best.j >= o.floorJ! || best.c >= o.floorC!)) {
    const budget = o.counter ?? { n: 0 };
    if (o.confirm && budget.n < o.maxConfirm!) {
      budget.n++;
      confirmed = await o.confirm(candidate, best.rec);
      if (confirmed) chosen = best;
    }
  }

  const now = (opts.now ?? new Date()).toISOString();
  const editionId = opts.editionId ?? now.slice(0, 10);

  if (chosen) {
    const revision = chosen.rec.revision + 1;
    db.run(
      "UPDATE topics SET canonical_title = ?, kind = ?, last_updated = ?, revision = ? WHERE topic_id = ?",
      [candidate.title, candidate.kind, now, revision, chosen.rec.topic_id],
    );
    for (const e of candidate.entities) {
      db.run(
        "INSERT INTO topic_entities (topic_id, entity_id, weight) VALUES (?,?,1) ON CONFLICT(topic_id, entity_id) DO NOTHING",
        [chosen.rec.topic_id, e],
      );
    }
    if (!chosen.rec.aliases.has(candidate.title)) {
      db.run(
        "INSERT INTO topic_aliases (topic_id, alias, source, added_at) VALUES (?,?,'observed',?) ON CONFLICT(topic_id, alias) DO NOTHING",
        [chosen.rec.topic_id, candidate.title, now],
      );
    }
    db.run(
      "INSERT INTO revisions (topic_id, revision, edition_id, claim_json, sources_json, created_at) VALUES (?,?,?,?,?,?)",
      [
        chosen.rec.topic_id,
        revision,
        editionId,
        JSON.stringify({ title: candidate.title, angle: candidate.angle, kind: candidate.kind }),
        "[]",
        now,
      ],
    );

    chosen.rec.revision = revision;
    chosen.rec.canonical_title = candidate.title;
    for (const e of candidate.entities) chosen.rec.entities.add(e);
    chosen.rec.aliases.add(candidate.title);

    return {
      topic_id: chosen.rec.topic_id,
      is_new: false,
      revision,
      j: chosen.j,
      c: chosen.c,
      confirmed,
    };
  }

  const topicId = makeTopicId(candidate.title, candidate.entities);
  db.run(
    `INSERT INTO topics (topic_id, canonical_title, kind, first_seen, last_updated, revision, merged_into, status)
     VALUES (?,?,?,?,?,1,NULL,'active')
     ON CONFLICT(topic_id) DO NOTHING`,
    [topicId, candidate.title, candidate.kind, editionId, now],
  );
  for (const e of candidate.entities) {
    db.run(
      "INSERT INTO topic_entities (topic_id, entity_id, weight) VALUES (?,?,1) ON CONFLICT(topic_id, entity_id) DO NOTHING",
      [topicId, e],
    );
  }
  db.run(
    "INSERT INTO topic_aliases (topic_id, alias, source, added_at) VALUES (?,?,'founding',?) ON CONFLICT(topic_id, alias) DO NOTHING",
    [topicId, candidate.title, now],
  );
  db.run(
    "INSERT INTO revisions (topic_id, revision, edition_id, claim_json, sources_json, created_at) VALUES (?,1,?,?,?,?)",
    [
      topicId,
      editionId,
      JSON.stringify({ title: candidate.title, angle: candidate.angle, kind: candidate.kind }),
      "[]",
      now,
    ],
  );

  registry.push({
    topic_id: topicId,
    canonical_title: candidate.title,
    kind: candidate.kind,
    first_seen: editionId,
    last_updated: now,
    revision: 1,
    entities: new Set(candidate.entities),
    aliases: new Set([candidate.title]),
  });

  return { topic_id: topicId, is_new: true, revision: 1, j: best?.j ?? 0, c: best?.c ?? 0, confirmed: false };
}
