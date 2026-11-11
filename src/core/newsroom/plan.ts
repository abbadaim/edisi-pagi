/**
 * Meja tugas (NEWSROOM.md §4.1).
 *
 * Planner mengusulkan sudut, kedalaman, dan alasan "kenapa hari ini".
 * Ia tidak memilih slot final: aturan di `rank.ts` tetap menentukan kartu.
 */

import type { LlmAdapter } from "../../adapters/llm/types.ts";
import type { Cluster } from "../cluster.ts";
import { CATEGORIES, type AdjudicatedTopic, type TopicCategory } from "../adjudicate.ts";
import { truncateWords } from "../normalize.ts";
import type { Assignment, Depth, Plan } from "./contracts.ts";
import { isDepth } from "./contracts.ts";

export interface PlanCandidate {
  topic: AdjudicatedTopic;
  cid: string;
  articles: number;
  outlets: string[];
  entities: string[];
  first_seen: string | null;
  last_title: string | null;
  /** topic_id stabil dari registry, bila topik pernah terbit. */
  history_topic_id: string | null;
}

export interface PlannerInput {
  editionId: string;
  place: string;
  slots: { nasional: number; lokal: number };
  candidates: PlanCandidate[];
  openThreads: Array<{ title: string; first_seen: string; last_used: string | null }>;
  /** Catatan editor dari edisi sebelumnya yang belum tertutup. */
  openNotes?: Array<{
    id: string;
    topik: string;
    jenis: string;
    pertanyaan: string;
    umur_hari: number;
    percobaan: number;
    tindakan: string;
  }>;
  constraints: { maxHeavy: number; maxMeta: number };
}

function clip(s: unknown, max: number): string {
  return typeof s === "string" ? s.trim().slice(0, max) : "";
}

/** Heuristik §4.1 — dipakai planner sebagai titik awal dan sebagai fallback. */
export function depthFor(c: PlanCandidate): Depth {
  const days = c.first_seen ? Math.max(1, Math.round((Date.now() - Date.parse(c.first_seen)) / 86_400_000)) : 1;
  if (c.articles >= 5 || c.outlets.length >= 4 || c.entities.length >= 6 || days >= 3) return "deep";
  if (c.articles <= 1 || c.topic.significance <= 2) return "brief";
  return "standard";
}

export function buildPlannerPrompt(input: PlannerInput): { system: string; user: string } {
  const system = [
    "Kamu kepala meja tugas sebuah brief berbahasa Indonesia untuk pembaca yang jarang membuka media sosial.",
    "Tugasmu: memilih topik hari ini, menentukan sudut, kedalaman, dan daftar pertanyaan yang HARUS dijawab artikel.",
    "Aturan:",
    "- title: 3–6 kata, tanpa klikbait, tanpa kapital semua.",
    "- angle: maksimum 90 karakter, kejadian hari ini di dalam thread.",
    "- depth: brief (2 paragraf, 1 sumber) | standard (3 paragraf, 2 sumber) | deep (4–6 paragraf, 3 sumber, rentang ≥7 hari bila thread lama).",
    "- answers: 2–6 pertanyaan konkret yang harus dijawab artikel. Bukan pertanyaan retoris. Contoh: 'Berapa nilai setoran yang diduga', 'Siapa yang sudah ditetapkan tersangka', 'Apa bantahan pihak yang disebut'.",
    "- prioritaskan topik yang: menyangkut uang/keselamatan banyak orang, punya sumber primer, atau merupakan tindak lanjut dengan perkembangan baru.",
    "- follow_up_of: isi judul thread lama bila topik ini kelanjutannya; null bila baru.",
    "- drop: true untuk iklan, SEO filler, siaran pers tanpa substansi, jadwal siaran, twibbon, horse-race politik.",
    "- Jangan mengarang fakta. answers hanya boleh berisi hal yang plausibel diperiksa dari bahan berita.",
    "- `catatan_terbuka` adalah utang liputan dari edisi sebelumnya. Jadikan tugas tindak lanjut HANYA bila ada bahan baru atau perkembangan nyata hari ini. Jika tidak ada, biarkan catatan itu terbuka; jangan menulis ulang pertanyaan yang sama.",
    "- Bila sebuah tugas menutup catatan lama, isi `note_ids` dengan id catatan tersebut. Maksimum 2 catatan per tugas dan 2 tindak lanjut per edisi.",
    "- Balas JSON: {\"assignments\":[{\"cid\":[\"c01\"],\"title\":\"\",\"angle\":\"\",\"category\":\"policy\",\"significance\":3,\"heavy\":false,\"depth\":\"standard\",\"why_now\":\"\",\"answers\":[\"\"],\"follow_up_of\":null,\"note_ids\":[],\"drop\":false,\"reason\":null}]}",
  ].join("\n");

  const user = JSON.stringify(
    {
      tanggal: input.editionId,
      wilayah: input.place,
      slot: input.slots,
      batas: input.constraints,
      thread_terbuka: input.openThreads.slice(0, 20),
      catatan_terbuka: input.openNotes ?? [],
      kandidat: input.candidates.map((c) => ({
        cid: c.cid,
        judul: c.topic.title,
        sudut: c.topic.angle,
        kategori: c.topic.category,
        signifikansi: c.topic.significance,
        heavy: c.topic.heavy,
        artikel: c.articles,
        media: c.outlets.slice(0, 6),
        entitas: c.entities.slice(0, 8),
        pertama_terlihat: c.first_seen,
      })),
    },
    null,
    1,
  );

  return { system, user };
}

interface RawAssignment {
  cid?: unknown;
  title?: unknown;
  angle?: unknown;
  category?: unknown;
  significance?: unknown;
  heavy?: unknown;
  depth?: unknown;
  why_now?: unknown;
  answers?: unknown;
  follow_up_of?: unknown;
  note_ids?: unknown;
  drop?: unknown;
  reason?: unknown;
}

function normaliseAssignments(
  raw: unknown,
  candidates: PlanCandidate[],
): Assignment[] {
  const byCid = new Map(candidates.map((c) => [c.cid, c]));
  const out: Assignment[] = [];
  const seen = new Set<string>();
  const list = (raw as { assignments?: RawAssignment[] })?.assignments ?? [];

  for (const a of list) {
    const cids = (Array.isArray(a.cid) ? a.cid : [])
      .map((c) => String(c))
      .filter((c) => byCid.has(c) && !seen.has(c));
    if (cids.length === 0) continue;
    for (const c of cids) seen.add(c);

    const base = byCid.get(cids[0]!)!;
    const title = clip(a.title, 70) || base.topic.title;
    const category = CATEGORIES.includes(a.category as TopicCategory)
      ? (a.category as TopicCategory)
      : base.topic.category;
    const sig = Number(a.significance);

    const answers = (Array.isArray(a.answers) ? a.answers : [])
      .map((x) => clip(x, 800))
      .filter((x) => x.length >= 8)
      .slice(0, 6);

    out.push({
      cids,
      title,
      angle: clip(a.angle, 90) || truncateWords(base.topic.angle, 90),
      category,
      significance: Number.isFinite(sig) ? Math.min(5, Math.max(1, Math.round(sig))) : base.topic.significance,
      heavy: a.heavy === true,
      depth: isDepth(a.depth) ? a.depth : depthFor(base),
      why_now: clip(a.why_now, 160),
      answers: answers.length >= 2 ? answers : fallbackAnswers(base),
      note_ids: (Array.isArray(a.note_ids) ? a.note_ids : [])
        .map((x) => String(x))
        .filter((x) => x.startsWith("n_"))
        .slice(0, 2),
      drop: a.drop === true,
      reason: typeof a.reason === "string" ? a.reason.slice(0, 120) : null,
    });
  }

  return out;
}

function fallbackAnswers(c: PlanCandidate): string[] {
  return [
    `Apa yang terjadi pada ${c.topic.title}?`,
    "Angka, nama, atau tanggal spesifik apa yang tersedia?",
    "Apa yang belum jelas dan langkah berikutnya?",
  ];
}

/** Fallback deterministik bila planner gagal: satu kandidat = satu tugas. */
export function fallbackPlan(input: PlannerInput): Plan {
  return {
    edition_id: input.editionId,
    generated_at: new Date().toISOString(),
    assignments: input.candidates.map((c) => ({
      cids: [c.cid],
      title: c.topic.title,
      angle: c.topic.angle,
      category: c.topic.category,
      significance: c.topic.significance,
      heavy: c.topic.heavy,
      depth: depthFor(c),
      why_now: c.first_seen ? `Pertama terlihat ${c.first_seen}` : "Hari ini",
      answers: fallbackAnswers(c),
      note_ids: [],
      drop: false,
      reason: "fallback: planner tidak tersedia",
    })),
  };
}

export async function planEdition(
  input: PlannerInput,
  deps: { llm: LlmAdapter; model: string },
): Promise<{ plan: Plan; usedLlm: boolean }> {
  const { system, user } = buildPlannerPrompt(input);
  try {
    const { data } = await deps.llm.json<unknown>({
      model: deps.model,
      system,
      user,
      maxTokens: 4200,
      temperature: 0.2,
    });
    const assignments = normaliseAssignments(data, input.candidates);
    if (assignments.length === 0) throw new Error("tidak ada tugas yang bisa dipakai");
    return {
      plan: { edition_id: input.editionId, generated_at: new Date().toISOString(), assignments },
      usedLlm: true,
    };
  } catch (e) {
    const why = e instanceof Error ? e.message.slice(0, 200) : String(e);
    console.log(`  ! planner gagal (${why}) — memakai rencana deterministik`);
    return { plan: fallbackPlan(input), usedLlm: false };
  }
}

/** Ringkas kandidat dari hasil adjudikasi + klaster. */
export function candidatesFrom(
  topics: AdjudicatedTopic[],
  clusterByCid: Map<string, Cluster>,
  history: Array<{ topic_id: string; canonical_title: string; first_seen: string; revision: number }>,
): PlanCandidate[] {
  const histByTitle = history.map((h) => ({
    title: h.canonical_title.toLowerCase(),
    first: h.first_seen,
    topic_id: h.topic_id,
  }));

  return topics
    .map((topic) => {
      const cid = topic.cids[0];
      const cluster = cid ? clusterByCid.get(cid) : undefined;
      if (!cid || !cluster) return null;
      const guess = histByTitle.find((h) => topic.title.toLowerCase().includes(h.title.slice(0, 18)));
      return {
        topic,
        cid,
        articles: cluster.articles.length,
        outlets: cluster.outlets,
        entities: cluster.entities,
        first_seen: guess?.first ?? null,
        last_title: guess?.title ?? null,
        history_topic_id: guess?.topic_id ?? null,
      } satisfies PlanCandidate;
    })
    .filter((c): c is PlanCandidate => Boolean(c));
}
