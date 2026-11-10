import type { Card, Edition, ModelRef, Scope } from "./types.ts";

export interface AssembleInput {
  scope: Scope;
  editionId: string;
  publishedAt: string;
  coverage: { from: string; to: string };
  generatedAt: string;
  place: { kabupaten: string; province: string };
  cards: Card[];
  truncatedReason?: string | null;
  generatedBy: {
    adjudicate: ModelRef;
    write: ModelRef;
    verify: ModelRef;
    embed: ModelRef;
  };
}

function words(cards: Card[], scope: string): number {
  let n = 0;
  for (const c of cards) {
    // Deep dive tidak dihitung di edisi harian; di edisi mingguan ia justru isinya.
    if (c.type === "deep_dive" && c.optional && scope !== "mingguan") continue;
    for (const p of c.body) n += p.split(/\s+/).length;
    if (c.explain) for (const e of c.explain) n += e.a.split(/\s+/).length;
  }
  return n;
}

export function buildEdition(input: AssembleInput): Edition {
  const cards = input.cards.map((c, i) => ({ ...c, id: `c${i + 1}` }));

  return {
    schema_version: 1,
    edition_id: input.editionId,
    scope: input.scope,
    published_at: input.publishedAt,
    coverage: input.coverage,
    generated_at: input.generatedAt,
    locale: "id-ID",
    place: input.place,
    reading_time_min: Math.max(1, Math.ceil(words(cards, input.scope) / 200)),
    generated_by: input.generatedBy,
    card_count: cards.length,
    truncated_reason: input.truncatedReason ?? null,
    cards,
  };
}

const HOAX_VERDICT: Record<string, "salah" | "parodi" | "menyesatkan" | "konteks_hilang"> = {
  SALAH: "salah",
  PARODI: "parodi",
  MENYESATKAN: "menyesatkan",
  "KONTEKS HILANG": "konteks_hilang",
};

export interface HoaxRow {
  url: string;
  title: string;
  lead: string;
}

export interface HoaxItem {
  claim: string;
  verdict: "salah" | "parodi" | "menyesatkan" | "konteks_hilang";
  reason: string;
  outlet: string;
  url: string;
}

export function parseHoaxTitles(rows: HoaxRow[]): HoaxItem[] {
  const items: HoaxItem[] = [];
  for (const r of rows) {
    const m = r.title.match(/^\[([A-Z\s]+)\]\s*(.+)$/);
    if (!m) continue;
    const verdict = HOAX_VERDICT[m[1]!.trim()];
    if (!verdict) continue;
    const claim = m[2]!.trim().slice(0, 140);
    const reason = (r.lead || "").trim().slice(0, 300) || "Lihat pemeriksaan lengkap di TurnBackHoax.";
    items.push({ claim, verdict, reason, outlet: "TurnBackHoax", url: r.url });
    if (items.length >= 3) break;
  }
  return items;
}
