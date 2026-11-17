/**
 * Verifikasi sitasi Tanya AI (rencana 022, `DEC-0033`).
 *
 * Aturannya satu: kutipan yang tidak ditemukan di bahan yang benar-benar
 * dikirim ke model akan dibuang. Model tidak boleh menyebut URL; ia hanya
 * menunjuk id bahan (`s1`), dan id itulah yang dipetakan ke URL asli. Jadi
 * tidak ada jalur bagi model untuk menciptakan sumber.
 *
 * Modul ini murni — tanpa jaringan. Bahan `luar` (fase 5) diverifikasi dengan
 * aturan yang sama setelah teksnya diambil alih pipeline.
 */

import type { AskMaterial } from "./retrieve.ts";

export interface RawCitation {
  /** `s1`, `s2`, … */
  id: string;
  kutipan: string;
}

export interface VerifiedSource {
  id: string;
  url: string;
  outlet: string;
  published_at: string | null;
  quote: string;
  verified: true;
}

export interface CiteResult {
  sources: VerifiedSource[];
  /** Kutipan yang dibuang, sudah dipendekkan; dipakai untuk pesan di layar. */
  unsupported: string[];
}

/** Minimal 6 kata: cukup untuk membuktikan kalimat itu ada, cukup longgar untuk salah ketik kecil. */
const WINDOW = 6;
/** Kutipan di bawah 4 kata terlalu umum untuk membuktikan apa pun. */
const MIN_WORDS = 4;

function words(text: string): string[] {
  return norm(text).split(" ").filter(Boolean);
}

function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Benar bila ada jendela ≥6 kata dari kutipan yang muncul utuh di bahan.
 * Kutipan 4–5 kata harus muncul utuh — jendela 6 kata tidak mungkin dibentuk,
 * jadi yang diperiksa seluruh kutipan.
 */
export function quoteInText(quote: string, text: string): boolean {
  const q = norm(quote);
  const t = norm(text);
  if (q.length === 0) return false;
  const parts = words(quote);
  if (parts.length < MIN_WORDS) return false;
  if (parts.length < WINDOW) return t.includes(q);
  for (let i = 0; i + WINDOW <= parts.length; i++) {
    if (t.includes(parts.slice(i, i + WINDOW).join(" "))) return true;
  }
  return false;
}

export function verifyCitations(materials: AskMaterial[], citations: RawCitation[]): CiteResult {
  const byId = new Map(materials.map((m) => [m.id, m]));
  // Terima juga URL asli sebagai penanda — bukan untuk mempercayai model, tetapi
  // karena URL itu tetap harus sama dengan bahan yang kita kirim.
  const byUrl = new Map(materials.map((m) => [m.url, m]));
  const sources: VerifiedSource[] = [];
  const unsupported: string[] = [];
  const seen = new Set<string>();

  for (const c of citations ?? []) {
    const id = typeof c?.id === "string" ? c.id.trim() : "";
    const quote = typeof c?.kutipan === "string" ? c.kutipan.trim() : "";
    const material = byId.get(id) ?? byUrl.get(id);
    if (!material || quote.length === 0) {
      if (quote.length > 0) unsupported.push(quote.slice(0, 120));
      continue;
    }
    if (seen.has(material.url)) continue;
    if (!quoteInText(quote, material.text)) {
      unsupported.push(quote.slice(0, 120));
      continue;
    }
    seen.add(material.url);
    sources.push({
      id,
      url: material.url,
      outlet: material.outlet,
      published_at: material.published_at,
      quote,
      verified: true,
    });
  }

  return { sources, unsupported };
}

function corpusOf(materials: AskMaterial[]): string {
  return materials.map((m) => norm(m.text)).join(" \u0000 ");
}

/**
 * Kutipan di dalam badan jawaban ("..." atau “...”) harus ada di bahan.
 *
 * Sitasi di `sources[]` hanya membuktikan bahwa *sebagian* jawaban bersumber;
 * satu kalimat bisa menumpang tanpa dasar dan tetap terlihat sah. Kalimat yang
 * memuat kutipan tak ditemukan dibuang, bukan diterbitkan dengan tanda kutip
 * palsu. Ini penjaga termurah terhadap kalimat yang mengaku mengutip.
 */
export function stripUnverifiedQuotes(
  answer: string,
  materials: AskMaterial[],
): { text: string; dropped: string[] } {
  const corpus = corpusOf(materials);
  const sentences = answer.match(/[^.!?]+[.!?]*\s*/g) ?? [answer];
  const kept: string[] = [];
  const dropped: string[] = [];

  for (const sentence of sentences) {
    const inner = [...sentence.matchAll(/[“"]([^”"]{12,})[”"]/g)].map((m) => (m[1] ?? "").trim());
    const bad = inner.filter((q) => q.length > 0 && !corpus.includes(norm(q)));
    if (bad.length > 0) {
      dropped.push(...bad);
      continue;
    }
    kept.push(sentence);
  }

  return { text: kept.join("").trim(), dropped };
}
