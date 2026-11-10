import type { LlmAdapter } from "../adapters/llm/types.ts";
import type { ArticleRow, Cluster } from "./cluster.ts";
import type { Card, ExplainItem, Source } from "./types.ts";
import type { AdjudicatedTopic } from "./adjudicate.ts";
import type { Glossary } from "./writer.ts";
import { clusterText, explainForTopic } from "./writer.ts";
import { sourcesFromCluster } from "./writer.ts";
import { computeTruth } from "./truth.ts";
import { isoWib } from "./time.ts";
import { truncateWords } from "./normalize.ts";

export interface DeepDiveContext {
  now: Date;
  cluster: Cluster;
  topic: AdjudicatedTopic;
  topicId: string;
  glossary: Glossary;
  local: boolean;
  /** Minimal sumber independen. Harian 3, rekap mingguan 2. */
  minSources?: number;
}

function daysBetween(cluster: Cluster): number {
  const ts = cluster.articles
    .map((a) => (a.publishedAt ? Date.parse(a.publishedAt) : NaN))
    .filter((n) => Number.isFinite(n));
  if (ts.length < 2) return 1;
  return Math.max(1, Math.round((Math.max(...ts) - Math.min(...ts)) / 86_400_000));
}

function statsOf(cluster: Cluster): Array<{ value: string; label: string }> {
  return [
    { value: String(cluster.articles.length), label: "artikel" },
    { value: String(cluster.outlets.length), label: "media" },
    { value: `${daysBetween(cluster)} hari`, label: "berjalan" },
  ];
}

function pickSpread(articles: ArticleRow[], n: number): ArticleRow[] {
  if (articles.length <= n) return articles;
  const out: ArticleRow[] = [];
  for (let i = 0; i < n; i++) {
    out.push(articles[Math.round((i * (articles.length - 1)) / (n - 1))]!);
  }
  return out;
}

function wordCount(body: string[], explain: ExplainItem[]): number {
  const b = body.join(" ").split(/\s+/).length;
  const e = explain.reduce((n, x) => n + x.a.split(/\s+/).length, 0);
  return b + e;
}

/**
 * Deep dive deterministik: timeline thread, tanpa mengarang latar.
 * Dipakai sebagai cadangan bila LLM tidak tersedia atau hasilnya gagal validasi.
 */
export function buildDeepDive(ctx: DeepDiveContext): Card | null {
  const explain = explainForTopic(ctx.topic, ctx.glossary, clusterText(ctx.cluster));
  if (!explain) return null;

  const sources = sourcesFromCluster(ctx.cluster, ctx.now, 5);
  if (sources.length < 3) return null;

  const body = pickSpread(ctx.cluster.articles, 3)
    .map((a) => (a.lead || a.title).slice(0, 460))
    .filter(Boolean);

  const readMin = Math.min(8, Math.max(4, Math.ceil(wordCount(body, explain) / 200)));

  const truth = computeTruth(
    { claim: ctx.topic.angle, sources, numeric: /\d/.test(ctx.topic.title) },
    ctx.now,
  );

  return {
    id: "c1",
    type: "deep_dive",
    topic_id: ctx.topicId,
    angle: `Rekap ${daysBetween(ctx.cluster)} hari`,
    kicker: ctx.local ? "Sleman" : "Mendalam",
    title: ctx.topic.title.slice(0, 68),
    status: truth.status,
    truth,
    body: body.length ? body : [ctx.topic.title],
    explain,
    action: "Ini bacaan panjang. Edisi harian sudah selesai tanpanya.",
    image: null,
    sources,
    revision: 1,
    first_seen: (ctx.cluster.articles[0]?.publishedAt ?? isoWib(ctx.now)!).slice(0, 10),
    previous_edition: null,
    changes: [],
    dek: truncateWords(ctx.cluster.articles[0]?.lead || ctx.topic.title, 150),
    optional: true,
    read_min: readMin,
    stats: statsOf(ctx.cluster),
  } as Card;
}

interface RawDeepDive {
  title?: unknown;
  dek?: unknown;
  body?: unknown;
  action?: unknown;
  claim?: unknown;
  explain?: unknown;
}

function clip(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function clipParagraph(v: unknown, max: number): string {
  const t = typeof v === "string" ? v.trim() : "";
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (stop >= max * 0.6) return cut.slice(0, stop + 1).trim();
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
}

/**
 * Versi LLM: menulis thread jadi bacaan panjang. Konteks tetap hanya boleh
 * dipilih dari kandidat (glosarium/Wikipedia), sama seperti kartu harian.
 */
export async function buildDeepDiveWithLlm(
  ctx: DeepDiveContext,
  deps: { llm: LlmAdapter; model: string; candidates: Array<{ key: string; q: string; a: string; outlet: string; url: string }> },
): Promise<Card | null> {
  if (deps.candidates.length < 2) {
    if (process.env.DEBUG_DEEPDIVE) console.log(`  dd: kandidat ${deps.candidates.length} untuk ${ctx.topic.title.slice(0, 40)}`);
    return buildDeepDive(ctx);
  }

  const system = [
    "Kamu editor brief berbahasa Indonesia. Tulis satu bacaan mendalam (long read) dari sebuah thread berita.",
    "Aturan:",
    "- Fokus pada apa yang BERUBAH dan mengapa ini penting, bukan mengulang satu kejadian.",
    "- title: maksimum 68 karakter.",
    "- dek: satu kalimat, maksimum 150 karakter, menyatakan tesis.",
    "- body: 3–4 paragraf, tiap paragraf maksimum 620 karakter, urut kronologis.",
    "- action: satu kalimat, maksimum 160 karakter.",
    "- claim: satu pernyataan yang bisa diperiksa.",
    "- explain: 2–4 pertanyaan latar; WAJIB memakai source_key dari daftar background.",
    "- Jangan menambah fakta di luar artikel dan background.",
    "- Balas JSON: {\"title\":\"\",\"dek\":\"\",\"body\":[\"\"],\"action\":\"\",\"claim\":\"\",\"explain\":[{\"q\":\"\",\"a\":\"\",\"source_key\":\"g1\"}]}",
  ].join("\n");

  const user = JSON.stringify(
    {
      topik: ctx.topic.title,
      rentang: `${daysBetween(ctx.cluster)} hari`,
      artikel: pickSpread(ctx.cluster.articles, 6).map((a) => ({
        tanggal: a.publishedAt?.slice(0, 10) ?? null,
        judul: a.title,
        ringkasan: a.lead.slice(0, 300),
        media: a.outlet,
      })),
      background: deps.candidates.map((c) => ({ key: c.key, q: c.q, a: c.a, sumber: c.outlet })),
    },
    null,
    1,
  );

  let raw: RawDeepDive | null = null;
  for (let i = 0; i < 2 && !raw; i++) {
    try {
      const { data } = await deps.llm.json<RawDeepDive>({ model: deps.model, system, user, maxTokens: 2200 });
      raw = data;
    } catch {
      raw = null;
    }
  }
  if (!raw) {
    if (process.env.DEBUG_DEEPDIVE) console.log(`  dd: llm gagal untuk ${ctx.topic.title.slice(0, 40)}`);
    return buildDeepDive(ctx);
  }

  const byKey = new Map(deps.candidates.map((c) => [c.key, c]));
  const explain: ExplainItem[] = [];
  for (const e of Array.isArray(raw.explain) ? raw.explain : []) {
    const it = e as { q?: unknown; a?: unknown; source_key?: unknown };
    const cand = byKey.get(typeof it.source_key === "string" ? it.source_key : "");
    const q = clip(it.q, 90);
    const a = clip(it.a, 420);
    if (!cand || !q.endsWith("?") || a.length < 40) continue;
    explain.push({ q, a, source: { outlet: cand.outlet, url: cand.url } });
    if (explain.length >= 4) break;
  }

  const body = (Array.isArray(raw.body) ? raw.body : [])
    .map((p) => clipParagraph(p, 620))
    .filter(Boolean)
    .slice(0, 4);
  const title = clip(raw.title, 68);
  const dek = clip(raw.dek, 150);
  const action = clip(raw.action, 160) || "Baca sampai akhir; latar lengkapnya jarang masuk potongan berita.";

  if (body.length < 2 || explain.length < 2 || !title || !action) {
    if (process.env.DEBUG_DEEPDIVE) {
      console.log(
        `  dd: hasil ditolak (body ${body.length}, explain ${explain.length}, title ${Boolean(title)}, action ${Boolean(action)}) untuk ${ctx.topic.title.slice(0, 40)}`,
      );
    }
    return buildDeepDive(ctx);
  }

  const sources = sourcesFromCluster(ctx.cluster, ctx.now, 5);
  if (sources.length < (ctx.minSources ?? 3)) {
    if (process.env.DEBUG_DEEPDIVE) {
      console.log(`  dd: sumber ${sources.length} < ${ctx.minSources ?? 3} untuk ${ctx.topic.title.slice(0, 40)}`);
    }
    return null;
  }

  // Dek memang boleh memperkenalkan sudut baru; tidak perlu tumpang tindih judul.

  const truth = computeTruth(
    { claim: clip(raw.claim, 160) || dek, sources, numeric: /\d/.test(title) },
    ctx.now,
  );

  return {
    id: "c1",
    type: "deep_dive",
    topic_id: ctx.topicId,
    angle: `Rekap ${daysBetween(ctx.cluster)} hari`,
    kicker: ctx.local ? "Sleman" : "Mendalam",
    title,
    status: truth.status,
    truth,
    body,
    explain,
    action,
    image: null,
    sources,
    revision: 1,
    first_seen: (ctx.cluster.articles[0]?.publishedAt ?? isoWib(ctx.now)!).slice(0, 10),
    previous_edition: null,
    changes: [],
    dek,
    optional: true,
    read_min: Math.min(8, Math.max(4, Math.ceil(wordCount(body, explain) / 200))),
    stats: statsOf(ctx.cluster),
  } as Card;
}
