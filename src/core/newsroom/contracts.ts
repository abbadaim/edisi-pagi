/**
 * Kontrak antar peran newsroom (NEWSROOM.md §4).
 * Semua keluaran model dinormalisasi ke bentuk di sini sebelum dipakai peran lain.
 */

import type { ExplainItem, Source } from "../types.ts";
import type { TopicCategory } from "../adjudicate.ts";

export type Depth = "brief" | "standard" | "deep";

export const DEPTHS: Depth[] = ["brief", "standard", "deep"];

export interface Assignment {
  cids: string[];
  title: string;
  angle: string;
  category: TopicCategory;
  significance: number;
  heavy: boolean;
  depth: Depth;
  why_now: string;
  /** Inventaris sudut: pertanyaan yang harus dijawab artikel. */
  answers: string[];
  /** Catatan editor lama yang hendak ditutup tugas ini. */
  note_ids: string[];
  drop: boolean;
  reason: string | null;
}

export interface Plan {
  edition_id: string;
  generated_at: string;
  assignments: Assignment[];
}

export interface MaterialItem {
  /** `s1`.. untuk bahan kutipan, `g1`/`w1` untuk latar. */
  id: string;
  kind: "article" | "primary" | "background";
  outlet: string;
  url: string;
  published_at: string | null;
  tier: 1 | 2 | 3;
  text: string;
  chars: number;
  /** true bila teks berasal dari halaman penuh, bukan ringkasan feed. */
  full_text: boolean;
}

export interface MaterialPack {
  topic_id: string;
  items: MaterialItem[];
  missing: string[];
  stats: {
    /** Karakter yang tersedia bagi writer lama: hanya lead. */
    lead_chars: number;
    /** Karakter yang tersedia setelah riset. */
    material_chars: number;
    fetched: number;
    cached?: number;
    primary?: number;
    failed: number;
    urls: string[];
  };
}

export interface Citation {
  paragraph: number;
  sources: string[];
}

export interface Draft {
  title: string;
  angle: string;
  dek: string;
  body: string[];
  citations: Citation[];
  action: string;
  claim: string;
  explain: ExplainItem[];
  depth_achieved: Depth;
  depth_change: Depth | null;
  needs: string[];
}

export type FindingCode =
  | "D-LEN"
  | "D-CITE"
  | "D-SRC"
  | "D-EXP"
  | "D-TITLE"
  | "D-TRUNC"
  | "D-TYPO"
  | "D-CAUS"
  | "D-NUM"
  | "D-BAN"
  | "E-FACT"
  | "E-INVENT"
  | "E-SRC"
  | "E-DEPTH"
  | "E-COH"
  | "E-CAUS"
  | "E-DUP"
  | "E-CAT"
  | "E-SAFE"
  | "E-TONE"
  | "E-ATTR"
  | "E-NUM";

export interface Finding {
  code: FindingCode;
  severity: "blocking" | "advisory";
  paragraph: number | null;
  quote: string;
  issue: string;
  fix: string;
  /** Dari lapis deterministik, bukan model. */
  rule?: boolean;
}

export interface EditResult {
  verdict: "approve" | "revise" | "reject";
  findings: Finding[];
  answers_covered: number[];
  answers_missing: number[];
  depth_check: Depth | "too_thin";
  category_check: TopicCategory | null;
  /** Catatan lama yang benar-benar dijawab draft ini, dengan kutipan bukti. */
  notes_resolved: Array<{ id: string; quote: string }>;
}

export interface DeskResult {
  publish: boolean;
  /** Alasan yang benar-benar memblokir: fakta salah, typo, teks terpotong. */
  reasons: string[];
  /** Catatan set-level yang tidak memblokir (sudut kembar, kedalaman, sitasi). */
  advisory: string[];
  rework: Array<{ card_id: string; instruction: string }>;
}

export interface UsageRow {
  role: "plan" | "research" | "write" | "edit" | "revise" | "desk";
  topic_id: string | null;
  attempt: number;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
}

export function isDepth(v: unknown): v is Depth {
  return typeof v === "string" && (DEPTHS as string[]).includes(v);
}

/** Sumber untuk `edition.json`. Bahan latar tidak pernah masuk daftar sumber kartu. */
export function sourcesFromPack(pack: MaterialPack, now: Date): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const item of pack.items) {
    if (item.kind === "background") continue;
    if (seen.has(item.outlet)) continue;
    seen.add(item.outlet);
    out.push({
      outlet: item.outlet,
      url: item.url,
      published_at: item.published_at,
      tier: item.tier,
      accessed_at: new Date(now.getTime() + 7 * 3_600_000).toISOString().replace(/\.\d+Z$/, "+07:00"),
    });
  }
  return out;
}
