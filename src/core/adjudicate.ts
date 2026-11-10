import type { LlmAdapter } from "../adapters/llm/types.ts";
import type { Cluster } from "./cluster.ts";
import { truncateWords } from "./normalize.ts";

export type TopicKind = "breaking" | "ongoing" | "analysis" | "utility";
export type TopicCategory =
  | "policy"
  | "safety"
  | "economy"
  | "health"
  | "culture"
  | "crime"
  | "disaster"
  | "sport";

export const CATEGORIES: TopicCategory[] = [
  "policy", "safety", "economy", "health", "culture", "crime", "disaster", "sport",
];

export interface ClusterSummary {
  cid: string;
  n_articles: number;
  outlets: string[];
  entities: string[];
  titles: string[];
  ambiguous: boolean;
}

export interface AdjudicatedTopic {
  cids: string[];
  title: string;
  angle: string;
  kind: TopicKind;
  entities: string[];
  local: boolean;
  horse_race: boolean;
  drop: boolean;
  category: TopicCategory;
  significance: number;
  heavy: boolean;
  reason: string | null;
}

export interface AdjudicationResult {
  topics: AdjudicatedTopic[];
  fallback: boolean;
  usage: { tokens_in: number; tokens_out: number };
  dropped: string[];
}

const KINDS: TopicKind[] = ["breaking", "ongoing", "analysis", "utility"];

export function summarise(clusters: Cluster[]): ClusterSummary[] {
  return clusters.map((c, i) => ({
    cid: `c${String(i + 1).padStart(2, "0")}`,
    n_articles: c.articles.length,
    outlets: c.outlets.slice(0, 6),
    entities: c.entities.slice(0, 8),
    titles: c.articles.slice(0, 3).map((a) => a.title.slice(0, 110)),
    ambiguous: c.articles.length < 3,
  }));
}

export function buildPrompt(input: {
  date: string;
  place: string;
  clusters: ClusterSummary[];
}): { system: string; user: string } {
  const system = [
    "Kamu editor brief berbahasa Indonesia. Tugasmu: mengubah klaster artikel menjadi topik.",
    "Aturan:",
    "- Gabungkan klaster yang membahas peristiwa yang sama; pisahkan yang berbeda meski entitasnya mirip.",
    "- title: 3–6 kata, tanpa klikbait, tanpa kapital semua.",
    "- angle: maksimum 90 karakter, kejadian hari ini di dalam thread.",
    "- kind: breaking | ongoing | analysis | utility.",
    "- category: policy | safety | economy | health | culture | crime | disaster | sport.",
    "- significance: 1–5. 5 = menyangkut kebijakan nasional, keselamatan, atau uang banyak orang.",
    "- heavy: true hanya untuk kriminal, bencana, konflik, kecelakaan. Kebijakan dan harga = false.",
    "- local: true jika menyangkut Sleman atau DIY.",
    "- horse_race: true untuk elektabilitas, manuver partai, peluang kandidat.",
    "- drop: true untuk iklan, SEO filler, siaran pers tanpa substansi, jadwal siaran, twibbon.",
    "- Gunakan HANYA cid yang diberikan.",
    "- Balas JSON: {\"topics\":[{\"cid\":[\"c01\"],\"title\":\"\",\"angle\":\"\",\"kind\":\"\",\"entities\":[],\"local\":false,\"horse_race\":false,\"drop\":false,\"category\":\"\",\"significance\":3,\"heavy\":false,\"reason\":null}]}",
  ].join("\n");

  const user = JSON.stringify(
    { date: input.date, place: input.place, clusters: input.clusters },
    null,
    1,
  );

  return { system, user };
}

interface RawTopic {
  cid?: unknown;
  title?: unknown;
  angle?: unknown;
  kind?: unknown;
  entities?: unknown;
  local?: unknown;
  horse_race?: unknown;
  drop?: unknown;
  category?: unknown;
  significance?: unknown;
  heavy?: unknown;
  reason?: unknown;
}

interface RawResponse {
  topics?: RawTopic[];
}

function asString(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function asBool(v: unknown): boolean {
  return v === true;
}

export function normalise(
  raw: RawResponse,
  validCids: Set<string>,
): { topics: AdjudicatedTopic[]; dropped: string[] } {
  const dropped: string[] = [];
  const seen = new Set<string>();
  const topics: AdjudicatedTopic[] = [];

  for (const t of raw.topics ?? []) {
    const cids = (Array.isArray(t.cid) ? t.cid : [])
      .map((c) => String(c))
      .filter((c) => {
        if (!validCids.has(c)) {
          dropped.push(c);
          return false;
        }
        return true;
      })
      .filter((c) => {
        if (seen.has(c)) return false;
        seen.add(c);
        return true;
      });

    if (cids.length === 0) continue;

    const title = asString(t.title, 70);
    if (!title) {
      dropped.push(...cids);
      continue;
    }

    const kind = KINDS.includes(t.kind as TopicKind) ? (t.kind as TopicKind) : "ongoing";
    const category = CATEGORIES.includes(t.category as TopicCategory)
      ? (t.category as TopicCategory)
      : "policy";
    const sig = Number(t.significance);

    topics.push({
      cids,
      title,
      angle: asString(t.angle, 90) || title,
      kind,
      entities: (Array.isArray(t.entities) ? t.entities : [])
        .map((e) => String(e).toLowerCase().trim())
        .filter(Boolean)
        .slice(0, 12),
      local: asBool(t.local),
      horse_race: asBool(t.horse_race),
      drop: asBool(t.drop),
      category,
      significance: Number.isFinite(sig) ? Math.min(5, Math.max(1, Math.round(sig))) : 3,
      heavy: asBool(t.heavy),
      reason: typeof t.reason === "string" ? t.reason.slice(0, 120) : null,
    });
  }

  return { topics, dropped };
}

const CATEGORY_HINTS: Array<[TopicCategory, RegExp]> = [
  ["sport", /\b(liga|timnas|pertandingan|klasemen|piala|sepak ?bola|motogp|moto3|motogp|balap|sirkuit|badminton)\b/i],
  ["health", /\b(vape|rokok|kesehatan|rumah sakit|gizi|stunting|vaksin|dokter)\b/i],
  ["disaster", /\b(gempa|banjir|erupsi|kebakaran|longsor|tsunami|karhutla|kabut asap)\b/i],
  // Keselamatan dicek sebelum kriminal: kecelakaan juga menyebut polisi, tetapi
  // bagi pembaca itu peristiwa keselamatan, bukan perkara pidana.
  ["safety", /\b(kecelakaan|lakalantas|tabrakan|ditabrak|menabrak|terseret|tenggelam|hanyut|terperosok|pohon tumbang|roboh|tewas|meninggal|korban jiwa)\b/i],
  ["crime", /\b(polisi|tersangka|penangkapan|ditangkap|korupsi|kpk|kejagung|sidang|pidana|hukum|sajam|senjata tajam|mengamuk|amuk|dihajar|hajar|dikeroyok|pengeroyokan|begal|curanmor|perampokan|pembunuhan|aniaya)\b/i],
  ["economy", /\b(harga|saham|ihsg|rupiah|inflasi|investasi|bbm|beras|pajak|ojk|ekonomi|bank)\b/i],
  ["culture", /\b(festival|budaya|seni|film|musik|wisata|sejarah)\b/i],
];

function guessCategory(titles: string[]): TopicCategory {
  const text = titles.join(" ");
  for (const [cat, re] of CATEGORY_HINTS) if (re.test(text)) return cat;
  return "policy";
}

function guessSignificance(articles: number, outlets: number): number {
  if (articles >= 10 && outlets >= 4) return 5;
  if (articles >= 5) return 4;
  if (articles >= 3) return 3;
  return 2;
}

/** Mode deterministik saat LLM gagal: satu klaster = satu topik, dengan tebakan kategori. */
export function fallbackTopics(clusters: ClusterSummary[]): AdjudicatedTopic[] {
  return clusters.map((c) => {
    const category = guessCategory(c.titles);
    return {
      cids: [c.cid],
      // Jangan potong terlalu pendek: label ini juga dipakai writer sebagai
      // bahan judul kartu saat LLM cadangan yang menulis.
      title: truncateWords(c.titles[0] ?? c.entities[0] ?? c.cid, 90),
      angle: c.titles[0]?.slice(0, 90) ?? c.cid,
      kind: "ongoing" as TopicKind,
      entities: c.entities,
      local: false,
      horse_race: /\b(elektabilitas|survei|peluang|cawapres|capres)\b/i.test(c.titles.join(" ")),
      drop: /\b(twibbon|link streaming|jadwal siaran|ucapan|resep)\b/i.test(c.titles.join(" ")),
      category,
      significance: guessSignificance(c.n_articles, c.outlets.length),
      heavy: category === "crime" || category === "disaster" || category === "safety",
      reason: "fallback: LLM tidak tersedia",
    };
  });
}

export async function adjudicate(
  clusters: Cluster[],
  opts: { llm: LlmAdapter; model: string; date: string; place: string },
): Promise<AdjudicationResult> {
  const summaries = summarise(clusters);
  const validCids = new Set(summaries.map((s) => s.cid));
  const { system, user } = buildPrompt({
    date: opts.date,
    place: opts.place,
    clusters: summaries,
  });

  try {
    const { data, usage } = await opts.llm.json<RawResponse>({
      model: opts.model,
      system,
      user,
      maxTokens: 4096,
      temperature: 0.2,
    });

    const { topics, dropped } = normalise(data, validCids);
    if (topics.length === 0) throw new Error("respons tidak memuat topik yang bisa dipakai");

    return {
      topics,
      fallback: false,
      usage: { tokens_in: usage.tokens_in, tokens_out: usage.tokens_out },
      dropped,
    };
  } catch (e) {
    // Jangan diam: fallback yang tidak terlihat membuat kualitas turun tanpa jejak.
    const why = e instanceof Error ? e.message.slice(0, 240) : String(e);
    console.log(`  ! adjudikasi gagal (${why}) — memakai topik deterministik`);
    return {
      topics: fallbackTopics(summaries),
      fallback: true,
      usage: { tokens_in: 0, tokens_out: 0 },
      dropped: [],
    };
  }
}
