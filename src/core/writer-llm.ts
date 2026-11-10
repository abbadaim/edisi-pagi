import type { LlmAdapter } from "../adapters/llm/types.ts";
import { fetchWikiSummary } from "../adapters/wiki.ts";
import type { AdjudicatedTopic } from "./adjudicate.ts";
import type { Glossary } from "./writer.ts";
import { explainForTopic } from "./writer.ts";
import type { Card, ExplainItem } from "./types.ts";
import { computeTruth } from "./truth.ts";
import { isoWib } from "./time.ts";
import { features, similarity } from "./simhash.ts";

export interface BackgroundCandidate {
  key: string;
  q: string;
  a: string;
  outlet: string;
  url: string;
}

export interface LlmWriteContext {
  editionId: string;
  now: Date;
  topic: AdjudicatedTopic;
  topicId: string;
  cluster: { articles: Array<{ title: string; lead: string; url: string; outlet: string; publishedAt: string | null }>; outlets: string[] };
  sources: Array<{ outlet: string; url: string; published_at: string | null; tier: 1 | 2 | 3; accessed_at: string }>;
  local: boolean;
  revision: number;
  firstSeen: string;
  previousEdition: string | null;
}

interface RawCard {
  title?: unknown;
  angle?: unknown;
  body?: unknown;
  action?: unknown;
  claim?: unknown;
  explain?: unknown;
}

const MAX_TITLE = 70;
const MAX_ANGLE = 90;
const MAX_BODY = 480;
const MAX_ACTION = 160;

function clip(s: unknown, max: number): string {
  return typeof s === "string" ? s.trim().slice(0, max) : "";
}

/** Jaga agar angle/claim tidak membicarakan peristiwa lain dari klaster. */
function coherent(title: string, text: string, floor: number): boolean {
  if (!text) return false;
  return similarity(features(title), features(text)) >= floor;
}

/** Background yang diizinkan: glosarium + Wikipedia. Tidak ada yang lain. */
export async function backgroundCandidates(
  topic: AdjudicatedTopic,
  glossary: Glossary,
  max = 4,
): Promise<BackgroundCandidate[]> {
  const out: BackgroundCandidate[] = [];

  const known = explainForTopic(topic, glossary);
  if (known) {
    known.forEach((e, i) => {
      out.push({ key: `g${i + 1}`, q: e.q, a: e.a, outlet: e.source.outlet, url: e.source.url });
    });
  }

  for (const id of topic.entities.slice(0, 3)) {
    if (out.length >= max) break;
    const wiki = await fetchWikiSummary(id.replace(/_/g, " "));
    if (!wiki) continue;
    if (out.some((c) => c.url === wiki.url)) continue;
    out.push({
      key: `w${out.length + 1}`,
      q: `Apa yang perlu diketahui tentang ${wiki.title}?`,
      a: wiki.extract.slice(0, 400),
      outlet: "Wikipedia",
      url: wiki.url,
    });
  }

  return out.slice(0, max);
}

export function buildWriterPrompt(ctx: LlmWriteContext, candidates: BackgroundCandidate[]) {
  const system = [
    "Kamu editor brief berbahasa Indonesia untuk pembaca yang jarang membuka media sosial.",
    "Tulis kartu berita dari data yang diberikan. Jangan menambah fakta baru.",
    "Aturan:",
    "- title: maksimum 70 karakter, tanpa klikbait.",
    "- angle: maksimum 90 karakter.",
    "- body: 1–3 paragraf, tiap paragraf maksimum 480 karakter. Padat, tanpa basa-basi.",
    "- action: satu kalimat imperatif, maksimum 160 karakter, mulai dari hal yang bisa dilakukan pembaca.",
    "- claim: satu pernyataan yang bisa diperiksa dari isi kartu.",
    "- explain: 2–4 pertanyaan yang menjelaskan LATAR (istilah, orang, prosedur), bukan mengulang body.",
    "- Klaster bisa memuat beberapa peristiwa terkait. Pilih SATU peristiwa yang paling banyak artikelnya.",
    "- title, angle, body, dan claim WAJIB membicarakan peristiwa yang sama. Jangan mencampur.",
    "- Setiap explain WAJIB memakai source_key dari daftar background. Jangan mengarang sumber.",
    "- Balas JSON: {\"title\":\"\",\"angle\":\"\",\"body\":[\"\"],\"action\":\"\",\"claim\":\"\",\"explain\":[{\"q\":\"\",\"a\":\"\",\"source_key\":\"g1\"}]}",
  ].join("\n");

  const user = JSON.stringify(
    {
      topik: ctx.topic.title,
      kategori: ctx.topic.category,
      signifikansi: ctx.topic.significance,
      lokal: ctx.local,
      artikel: ctx.cluster.articles.slice(0, 6).map((a) => ({
        judul: a.title,
        ringkasan: a.lead.slice(0, 300),
        media: a.outlet,
      })),
      background: candidates.map((c) => ({ key: c.key, q: c.q, a: c.a, sumber: c.outlet })),
    },
    null,
    1,
  );

  return { system, user };
}

export function normaliseCard(
  raw: RawCard,
  candidates: BackgroundCandidate[],
  fallbackTitle: string,
): { title: string; angle: string; body: string[]; action: string; claim: string; explain: ExplainItem[] } | null {
  const byKey = new Map(candidates.map((c) => [c.key, c]));

  const explain: ExplainItem[] = [];
  for (const e of Array.isArray(raw.explain) ? raw.explain : []) {
    const item = e as { q?: unknown; a?: unknown; source_key?: unknown };
    const key = typeof item.source_key === "string" ? item.source_key : "";
    const cand = byKey.get(key);
    const q = clip(item.q, 90);
    const a = clip(item.a, 420);
    if (!cand || !q.endsWith("?") || q.length < 8 || a.length < 40) continue;
    if (explain.some((x) => x.q.toLowerCase() === q.toLowerCase())) continue;
    explain.push({ q, a, source: { outlet: cand.outlet, url: cand.url } });
    if (explain.length >= 4) break;
  }

  const body = (Array.isArray(raw.body) ? raw.body : [])
    .map((p) => clip(p, MAX_BODY))
    .filter(Boolean)
    .slice(0, 3);

  const title = clip(raw.title, MAX_TITLE) || fallbackTitle;
  const action = clip(raw.action, MAX_ACTION);

  // Angle/claim yang tidak nyambung dengan judul biasanya berasal dari
  // peristiwa lain di klaster yang sama. Jatuhkan ke judul.
  let angle = clip(raw.angle, MAX_ANGLE) || title;
  if (!coherent(title, angle, 0.12)) angle = title;

  let claim = clip(raw.claim, 160) || title;
  if (!coherent(title, claim, 0.1)) claim = title;

  if (body.length === 0 || !action || explain.length < 2) return null;

  return { title, angle, body, action, claim, explain };
}

export async function writeCardWithLlm(
  ctx: LlmWriteContext,
  deps: { llm: LlmAdapter; model: string; glossary: Glossary; candidates?: BackgroundCandidate[] },
): Promise<Card | null> {
  const candidates = deps.candidates ?? (await backgroundCandidates(ctx.topic, deps.glossary));
  if (candidates.length < 2) return null;

  const { system, user } = buildWriterPrompt(ctx, candidates);

  let raw: RawCard | null = null;
  for (let attempt = 0; attempt < 2 && !raw; attempt++) {
    try {
      const { data } = await deps.llm.json<RawCard>({ model: deps.model, system, user, maxTokens: 1800 });
      raw = data;
    } catch {
      raw = null;
    }
  }
  if (!raw) return null;

  const card = normaliseCard(raw, candidates, ctx.topic.title);
  if (!card) return null;

  const truth = computeTruth(
    { claim: card.claim, sources: ctx.sources, numeric: /\d/.test(card.title) },
    ctx.now,
  );

  return {
    id: "c1",
    type: "news",
    topic_id: ctx.topicId,
    angle: card.angle,
    kicker: ctx.local ? "Sleman" : "Nasional",
    title: card.title,
    status: truth.status,
    truth,
    body: card.body,
    explain: card.explain,
    action: card.action,
    image: null,
    sources: ctx.sources,
    place: ctx.local ? "lokal" : "nasional",
    revision: ctx.revision,
    first_seen: ctx.firstSeen,
    previous_edition: ctx.previousEdition,
    changes: [],
  } as Card;
}
