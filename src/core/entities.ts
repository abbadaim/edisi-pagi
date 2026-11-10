/**
 * Ekstraksi entitas deterministik (tanpa LLM) untuk blocking kandidat.
 * Tiga sumber: gazetteer alias, akronim huruf besar, rangkaian kata berhuruf besar.
 */

import type { Aliases } from "./normalize.ts";

export type EntityKind = "person" | "org" | "place" | "abbrev" | "proper" | "unknown";

export interface ExtractedEntity {
  id: string;
  name: string;
  kind: EntityKind;
  surface: string;
}

const ACRONYM_STOP = new Set([
  "THE", "AND", "FOR", "YOU", "ALL", "NEW", "TOP", "BEST", "LIVE", "VIDEO",
  "FOTO", "HOT", "DAN", "YANG", "INI", "ITU", "APA", "BISA", "TIDAK",
]);

const WORD_STOP = new Set([
  "Selasa", "Senin", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu", "Januari",
  "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September",
  "Oktober", "November", "Desember", "Indonesia", "Jakarta",
]);

export function entityId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function kindOf(canonical: string, aliases: Aliases): EntityKind {
  // Heuristik ringan: gazetteer tidak menyimpan jenis, jadi pakai bentuk.
  if (/^[a-z]{2,6}$/.test(canonical) && canonical.length <= 6) return "abbrev";
  return "unknown";
}

/**
 * @param titlesurface teks judul asli (bukan lowercase) agar akronim terbaca
 * @param aliases hasil buildAliases()
 */
export function extractEntities(title: string, lead: string, aliases: Aliases): ExtractedEntity[] {
  const out = new Map<string, ExtractedEntity>();
  const haystack = `${title} ${lead}`;
  const lower = ` ${haystack.toLowerCase()} `;

  // 1. Gazetteer: cocokkan surface terpanjang dulu.
  for (const surface of aliases.ordered) {
    if (surface.length < 2) continue;
    const re = new RegExp(`(?<=[\\s\\p{P}])${escapeRe(surface)}(?=[\\s\\p{P}])`, "u");
    if (re.test(lower)) {
      const canonical = aliases.surfaces.get(surface)!;
      const id = entityId(canonical);
      if (!out.has(id)) {
        out.set(id, { id, name: canonical, kind: kindOf(canonical, aliases), surface });
      }
    }
  }

  // 2. Akronim: HMP, OJK, SPHP, BMKG.
  for (const m of title.matchAll(/\b([A-Z]{2,6})\b/g)) {
    const a = m[1]!;
    if (ACRONYM_STOP.has(a)) continue;
    const id = entityId(a);
    if (!out.has(id)) out.set(id, { id, name: a, kind: "abbrev", surface: a });
  }

  // 3. Rangkaian kata berhuruf besar (2–4 kata), bukan di awal kalimat saja.
  for (const m of haystack.matchAll(/(?:^|[.!?]\s+|\s)((?:[A-Z][a-z]{2,})(?:\s+[A-Z][a-z]{2,}){1,3})/g)) {
    const phrase = m[1]!.trim();
    // Frasa yang sudah punya entri gazetteer jangan dibuatkan id kedua.
    if (aliases.surfaces.has(phrase.toLowerCase())) continue;
    const words = phrase.split(/\s+/);
    if (words.every((w) => WORD_STOP.has(w))) continue;
    if (words.length === 2 && WORD_STOP.has(words[0]!)) continue;
    const id = entityId(phrase);
    if (!out.has(id)) out.set(id, { id, name: phrase, kind: "proper", surface: phrase });
  }

  return [...out.values()];
}

/**
 * Filter: hanya entitas yang cukup diskriminatif. Dipakai saat blocking
 * setelah IDF dihitung (CLUSTERING.md §5.1).
 */
export function isDistinctive(idf: number, threshold = 1.5): boolean {
  return idf >= threshold;
}
