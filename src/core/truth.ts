import type { ConfidenceBand, Source, Status, Truth } from "./types.ts";
import { isoWib } from "./time.ts";
import { ownerOfOutlet } from "./outlets.ts";
import type { OwnerLookup } from "./outlets.ts";

export interface TruthInput {
  claim: string;
  sources: Array<Pick<Source, "outlet" | "url" | "tier">>;
  contradicting?: number;
  numeric?: boolean;
  unchanged48h?: boolean;
  officialDenialPending?: boolean;
}

const BASE = {
  primary_confirms: 0.95,
  two_independent_tier2: 0.85,
  one_tier2: 0.7,
  tier3_only: 0.4,
  primary_contradicts: 0.05,
} as const;

type Strongest = keyof typeof BASE;

function band(confidence: number): ConfidenceBand {
  if (confidence >= 0.9) return "hampir_pasti";
  if (confidence >= 0.75) return "kemungkinan_besar";
  if (confidence >= 0.55) return "belum_pasti";
  if (confidence >= 0.3) return "diragukan";
  return "kemungkinan_tidak";
}

function statusOf(strongest: Strongest): Status {
  switch (strongest) {
    case "primary_confirms":
      return "terkonfirmasi";
    case "two_independent_tier2":
    case "one_tier2":
      return "sebagian";
    case "primary_contradicts":
      return "dibantah";
    default:
      return "belum";
  }
}

/**
 * Keyakinan dihitung dari kelas bukti, bukan dari penilaian model
 * (SCHEMA.md §2.5). Angka hanya untuk pengurutan; tampilan memakai `band`.
 */
export interface TruthOptions {
  /**
   * Pemilik media (rencana 017). Bila ada, kemandirian dihitung per pemilik,
   * bukan per domain: detik + CNN + CNBC = satu suara, bukan tiga.
   */
  ownerOf?: OwnerLookup;
}

/**
 * Varian yang selalu memakai registry pemilik (rencana 017). Dipakai pipeline;
 * `computeTruth()` tetap murni untuk tes dan pemanggil yang ingin memilih.
 */
export function computeTruthRegistered(input: TruthInput, now = new Date()): Truth {
  return computeTruth(input, now, { ownerOf: ownerOfOutlet });
}

export function computeTruth(input: TruthInput, now = new Date(), opts: TruthOptions = {}): Truth {
  const primary = input.sources.filter((s) => s.tier === 1).length;
  const tier2 = input.sources.filter((s) => s.tier === 2).length;
  const tier3 = input.sources.filter((s) => s.tier === 3).length;
  const contradicting = input.contradicting ?? 0;

  const domains = new Set(
    input.sources.map((s) => {
      try {
        return new URL(s.url).hostname.replace(/^www\./, "");
      } catch {
        return s.outlet;
      }
    }),
  );
  // Satu grup media (mis. kompas.com + nasional.kompas.com) dihitung satu.
  const groups = new Set([...domains].map((d) => d.split(".").slice(-2).join(".")));

  // Pemilik menggantikan domain bila registry terverifikasi.
  const units = new Set<string>();
  const owners = new Set<string>();
  for (const s of input.sources) {
    const owner = opts.ownerOf ? opts.ownerOf(s.outlet) : null;
    if (owner) {
      units.add(`owner:${owner}`);
      owners.add(owner);
    } else {
      try {
        units.add(`domain:${new URL(s.url).hostname.replace(/^www\./, "").split(".").slice(-2).join(".")}`);
      } catch {
        units.add(`outlet:${s.outlet}`);
      }
    }
  }
  const independent = opts.ownerOf ? units.size : groups.size;

  let strongest: Strongest;
  if (contradicting > 0) strongest = "primary_contradicts";
  else if (primary > 0) strongest = "primary_confirms";
  else if (tier2 >= 2) strongest = "two_independent_tier2";
  else if (tier2 === 1) strongest = "one_tier2";
  else strongest = "tier3_only";

  let c: number = BASE[strongest];
  if (strongest !== "primary_contradicts") {
    if (primary === 0) c -= 0.05;
    if (independent >= 3) c += 0.03;
    if (independent === 1) c -= 0.1;
    if (input.numeric) c -= 0.03;
    if (input.unchanged48h) c -= 0.02;
    if (input.officialDenialPending) c -= 0.05;
  }
  c = Number(Math.min(0.97, Math.max(0.05, c)).toFixed(2));

  return {
    claim: input.claim,
    status: statusOf(strongest),
    confidence: c,
    band: band(c),
    basis: {
      strongest,
      primary,
      tier2,
      independent_outlets: independent,
      ...(opts.ownerOf ? { independent_owners: owners.size } : {}),
      contradicting,
    },
    gaps: [],
    would_change_if: null,
    assessed_at: isoWib(now)!,
  };
}
