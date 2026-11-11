/**
 * Tipe kontrak edisi. Cermin dari schema/edition.schema.json.
 * Aturan: jangan menambah field di sini tanpa menambah di schema.
 */

export type Scope = "nasional" | "lokal" | "mingguan";

export type CardType =
  | "news"
  | "deep_dive"
  | "hoax_roundup"
  | "good_news"
  | "gap"
  | "change"
  | "debate"
  | "misread";

export type Status = "terkonfirmasi" | "sebagian" | "belum" | "dibantah";

export type ConfidenceBand =
  | "hampir_pasti"
  | "kemungkinan_besar"
  | "belum_pasti"
  | "diragukan"
  | "kemungkinan_tidak";

export type Tier = 1 | 2 | 3;

export type Timestamp = string; // ISO 8601 +07:00
export type DateOnly = string; // YYYY-MM-DD

export interface Source {
  outlet: string;
  url: string;
  published_at: Timestamp | null;
  tier: Tier;
  accessed_at: Timestamp;
}

export interface ChangeBasis {
  outlet: string;
  url: string;
}

export interface Change {
  field: "status" | "label" | "number" | "title" | "scope";
  from: string | number | null;
  to: string | number;
  at: Timestamp;
  basis: ChangeBasis;
}

export interface Truth {
  claim: string;
  status: Status;
  confidence: number;
  band: ConfidenceBand;
  basis: {
    strongest:
      | "primary_confirms"
      | "two_independent_tier2"
      | "one_tier2"
      | "tier3_only"
      | "primary_contradicts";
    primary: number;
    tier2: number;
    independent_outlets: number;
    contradicting: number;
  };
  gaps: string[];
  would_change_if: string | null;
  assessed_at: Timestamp;
}

export interface ImageRef {
  url: string; // harus .webp
  credit: string | null;
  alt: string;
  fallback?: boolean;
}

export interface ExplainSource {
  outlet: string;
  url: string;
}

/** Satu pertanyaan konteks. Menjawab latar, bukan mengulang isi kartu. */
export interface ExplainItem {
  q: string;
  a: string;
  source: ExplainSource;
}

export interface CardBase {
  id: string;
  type: CardType;
  topic_id: string;
  angle: string;
  kicker: string;
  title: string;
  status: Status;
  truth: Truth | null;
  body: string[];
  explain?: ExplainItem[];
  /** Pertanyaan yang belum terjawab bahan; tampil sebagai kotak transparansi. */
  unresolved?: string[];
  /** Peringatan kuat untuk klaim yang sumbernya bertentangan; tampil di atas body. */
  disclaimer?: string;
  action: string;
  image: ImageRef | null;
  sources: Source[];
  revision: number;
  first_seen: DateOnly;
  previous_edition: DateOnly | null;
  changes: Change[];
}

export interface NewsCard extends CardBase {
  type: "news";
  place: Scope;
}

export interface GoodNewsCard extends CardBase {
  type: "good_news";
  place: Scope;
}

export interface DeepDiveCard extends CardBase {
  type: "deep_dive";
  dek: string;
  optional: true;
  read_min: number;
  stats: Array<{ value: string; label: string }>;
}

export interface HoaxItem {
  claim: string;
  verdict: "salah" | "parodi" | "menyesatkan" | "konteks_hilang";
  reason: string;
  outlet: string;
  url: string;
}

export interface HoaxRoundupCard extends CardBase {
  type: "hoax_roundup";
  items: HoaxItem[];
  pattern?: string | null;
}

export interface CoverageEntry {
  at: Timestamp;
  outlet: string;
  url: string;
}

export interface GapCard extends CardBase {
  type: "gap";
  social: {
    reddit_score: number | null;
    reddit_comments: number | null;
    detik_comments: number | null;
    trend_interest: number | null;
    tiktok_delta: number | null;
  };
  coverage: { article_count: number; outlets: string[] };
  gap_rank: number;
  absent_angle: string;
  first_detected: Timestamp;
  days_watched: number;
  state: "luput" | "mulai_diliput" | "ditutup";
  coverage_timeline: CoverageEntry[];
}

export interface ChangeCard extends CardBase {
  type: "change";
  before: { at: Timestamp; label: string; quote: string; source: ChangeBasis };
  after: { at: Timestamp; label: string; quote: string; source: ChangeBasis };
  what_changed: string;
  what_unknown: string;
}

export interface DebateCard extends CardBase {
  type: "debate";
  volume: { platform: string; count: number };
  tone: string;
  quotes: Array<{ author: string; platform: string; text: string }>;
  comparison: { platform: string; count: number; note: string } | null;
  reading: string;
}

export interface MisreadCard extends CardBase {
  type: "misread";
  claim: string;
  reality: string;
  missing: string[];
  trigger: "headline_body_gap" | "repeat_question" | "search_query" | "fact_check";
}

export type Card =
  | NewsCard
  | GoodNewsCard
  | DeepDiveCard
  | HoaxRoundupCard
  | GapCard
  | ChangeCard
  | DebateCard
  | MisreadCard;

export interface ModelRef {
  provider: string;
  model: string;
}

export interface Edition {
  schema_version: 1;
  edition_id: DateOnly;
  scope: Scope;
  published_at: Timestamp;
  coverage: { from: Timestamp; to: Timestamp };
  generated_at: Timestamp;
  locale: string;
  place: { kabupaten: string; province: string };
  reading_time_min: number;
  generated_by: {
    adjudicate: ModelRef;
    write: ModelRef;
    verify: ModelRef;
    embed: ModelRef;
  };
  card_count: number;
  truncated_reason: string | null;
  cards: Card[];
}

export const META_TYPES: ReadonlySet<CardType> = new Set<CardType>([
  "gap",
  "change",
  "debate",
  "misread",
]);
