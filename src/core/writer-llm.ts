import type { LlmAdapter } from "../adapters/llm/types.ts";
import { fetchWikiSummary } from "../adapters/wiki.ts";
import type { AdjudicatedTopic } from "./adjudicate.ts";
import type { Glossary } from "./writer.ts";
import { clusterText, explainForTopic } from "./writer.ts";
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
const MAX_BODY = 640;
const MAX_ACTION = 160;

/**
 * Kata yang tidak boleh menjadi akhir judul. Judul yang berhenti di sini
 * hampir selalu hasil potong, bukan kalimat utuh.
 */
const DANGLING = new Set([
  "soal", "untuk", "dari", "di", "ke", "yang", "dan", "atau", "dengan", "pada",
  "dalam", "oleh", "sebagai", "karena", "agar", "bagi", "terhadap", "tentang",
  "sejak", "hingga", "sampai", "akan", "telah", "sudah", "ini", "itu", "jadi",
  "usai", "saat", "ketika", "jika", "bila", "tanpa", "secara", "para", "atas",
]);

const bare = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function endsDangling(s: string): boolean {
  const words = bare(s).split(/\s+/);
  return words.length > 0 && DANGLING.has(words[words.length - 1]!);
}

/**
 * Judul dari model kadang menyalin label topik yang sudah terpotong
 * ("... Pendapat soal"). Perbaiki dari judul artikel asli, jangan biarkan
 * pembaca menerima frasa yang menggantung.
 */
function repairTitle(raw: string, articleTitles: string[], fallback: string): string {
  const title = raw.trim();
  const usable = articleTitles.map((t) => t.trim()).filter((t) => t.length > 0);

  if (endsDangling(title) || title.length < 24) {
    // Perluas ke judul artikel yang berawalan sama, asal tetap <= MAX_TITLE.
    const stem = bare(title).slice(0, Math.min(bare(title).length, 48));
    for (const t of usable) {
      const candidate = clipWords(t, MAX_TITLE);
      if (bare(t).startsWith(stem) && candidate.length > title.length) return candidate;
    }
  }

  if (endsDangling(title)) {
    const words = title.split(/\s+/);
    while (words.length > 3 && DANGLING.has(bare(words[words.length - 1]!))) words.pop();
    const trimmed = words.join(" ").replace(/[\s,;:–—-]+$/u, "");
    if (trimmed.length >= 16) return trimmed;
  }

  return title || fallback;
}

function clip(s: unknown, max: number): string {
  return typeof s === "string" ? s.trim().slice(0, max) : "";
}

/** Potong di batas kata — jangan pernah menyerahkan kata yang terbelah. */
function clipWords(s: unknown, max: number): string {
  const t = typeof s === "string" ? s.trim() : "";
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
}

/**
 * Potong paragraf di akhir kalimat terdekat. Memotong tepat di 480 karakter
 * menghasilkan kalimat yang berhenti di tengah ("... rumor yang belu").
 */
function clipParagraph(s: unknown, max: number): string {
  const t = typeof s === "string" ? s.trim() : "";
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (stop >= max * 0.6) return cut.slice(0, stop + 1).trim();
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
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
  text = "",
  articles: Array<{ title: string; lead: string; url: string; outlet: string }> = [],
): Promise<BackgroundCandidate[]> {
  const out: BackgroundCandidate[] = [];

  const known = explainForTopic(topic, glossary, text);
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

  // Jaring terakhir: konteks yang dilaporkan artikel itu sendiri. Pertanyaannya
  // sengaja tanpa "?" supaya tidak bisa disalin mentah sebagai explain.
  const anchor = articles[0];
  if (anchor && out.length < max) {
    out.push({
      key: "a1",
      q: "konteks dari artikel",
      a: (anchor.lead || anchor.title).slice(0, 500),
      outlet: anchor.outlet,
      url: anchor.url,
    });
  }

  return out.slice(0, max);
}

export function buildWriterPrompt(ctx: LlmWriteContext, candidates: BackgroundCandidate[]) {
  const system = [
    "Kamu editor brief berbahasa Indonesia untuk pembaca yang jarang membuka media sosial.",
    "Pembaca ingin MENGERTI, bukan sekadar tahu. Kedalaman lebih penting daripada ringkas.",
    "Tulis kartu berita dari data yang diberikan. Jangan menambah fakta baru.",
    "Aturan:",
    "- title: 45–70 karakter, satu frasa utuh dan spesifik. Jangan menyalin judul mentah apa adanya. Jangan berhenti di kata sambung (soal, untuk, dari, di, yang, dan, atau).",
    "- angle: maksimum 90 karakter, sudut hari ini di dalam thread.",
    "- body: WAJIB 3 paragraf, total minimal 700 karakter, tiap paragraf maksimum 600 karakter.",
    "  · Paragraf 1: apa yang terjadi — siapa, apa, kapan, angka, nama lembaga.",
    "  · Paragraf 2: latar dan mengapa ini penting bagi pembaca.",
    "  · Paragraf 3: apa yang belum jelas, langkah berikutnya, atau hal yang sering disalahpahami.",
    "- Tulis ulang dengan kalimatmu sendiri. Jangan menyalin potongan ringkasan.",
    "- Kalau detail tidak ada di artikel, tulis bahwa detail itu belum jelas. Jangan mengarang.",
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
      angle_topik: ctx.topic.angle,
      kategori: ctx.topic.category,
      signifikansi: ctx.topic.significance,
      lokal: ctx.local,
      artikel: ctx.cluster.articles.slice(0, 8).map((a) => ({
        judul: a.title,
        ringkasan: a.lead.slice(0, 600),
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
  articleTitles: string[] = [],
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
    .map((p) => clipParagraph(p, MAX_BODY))
    .filter(Boolean)
    .slice(0, 3);

  const title = repairTitle(clipWords(raw.title, MAX_TITLE) || fallbackTitle, articleTitles, fallbackTitle);
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
  const candidates =
    deps.candidates ??
    (await backgroundCandidates(ctx.topic, deps.glossary, 4, clusterText(ctx.cluster), ctx.cluster.articles));
  if (candidates.length < 1) {
    console.log(`  ! tulis: kandidat konteks hanya ${candidates.length} untuk "${ctx.topic.title.slice(0, 40)}"`);
    return null;
  }

  const { system, user } = buildWriterPrompt(ctx, candidates);
  const articleTitles = ctx.cluster.articles.map((a) => a.title);

  // Percobaan kedua hanya dipakai kalau hasil pertama terlalu tipis.
  const retryNote =
    "\n\nPERBAIKAN: hasil sebelumnya terlalu pendek. Tulis body 3 paragraf penuh, total minimal 800 karakter, dan pastikan judul tidak terpotong di tengah frasa.";

  let best: ReturnType<typeof normaliseCard> = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: RawCard | null = null;
    for (let parse = 0; parse < 2 && !raw; parse++) {
      try {
        const { data } = await deps.llm.json<RawCard>({
          model: deps.model,
          system: attempt === 0 ? system : system + retryNote,
          user,
          maxTokens: 3800,
        });
        raw = data;
      } catch (e) {
        const why = e instanceof Error ? e.message.slice(0, 240) : String(e);
        console.log(`  ! tulis gagal untuk "${ctx.topic.title.slice(0, 40)}": ${why}`);
        raw = null;
      }
    }
    if (!raw) break;

    const card = normaliseCard(raw, candidates, ctx.topic.title, articleTitles);
    if (!card) continue;

    const size = card.body.join(" ").length;
    if (size >= 600) {
      best = card;
      break;
    }
    if (!best || card.body.join(" ").length > best.body.join(" ").length) best = card;
  }

  if (!best) {
    console.log(`  ! tulis: hasil model ditolak untuk "${ctx.topic.title.slice(0, 40)}"`);
    return null;
  }
  const card = best;

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
