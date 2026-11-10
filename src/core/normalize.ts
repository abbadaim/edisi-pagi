/**
 * Normalisasi teks Indonesia untuk klastering (CLUSTERING.md §3).
 * Tanpa dependensi, tanpa stemming: imbuhan Indonesia rusak kalau di-stem.
 */

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&hellip;": "…",
  "&mdash;": "—",
  "&ndash;": "–",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&ldquo;": "“",
  "&rdquo;": "”",
};

const BOILERPLATE =
  /^(baca juga|simak|video|foto|infografik|editor|penulis|lihat juga|baca selengkapnya)\s*:?\s*/i;

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

export function stripTags(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h1|h2|h3|br)>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

export function cleanText(s: string): string {
  return decodeEntities(stripTags(s))
    .replace(/\s+/g, " ")
    .replace(/\s([,.;:!?])/g, "$1")
    .trim();
}

/** Judul untuk ditampilkan: buang boilerplate dan sufiks " - Nama Media". */
export function displayTitle(raw: string): string {
  let t = cleanText(raw);
  t = t.replace(BOILERPLATE, "");
  t = t.replace(/\s+[-–|]\s+[A-Z][\w.\s]{2,30}$/, "");
  return t.trim();
}

/**
 * Bentuk normal untuk perbandingan: huruf kecil, tanda baca jadi spasi.
 * Alias diterapkan terpisah (applyAliases) supaya asal-usul teks tetap jelas.
 */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface Aliases {
  /** surface (lowercase) -> kanonik */
  surfaces: Map<string, string>;
  /** daftar surface diurutkan dari terpanjang, untuk pencocokan greedy */
  ordered: string[];
}

export function buildAliases(raw: Record<string, string[]>): Aliases {
  const surfaces = new Map<string, string>();
  for (const [canonical, list] of Object.entries(raw)) {
    for (const surface of [canonical, ...(list ?? [])]) {
      const key = surface.toLowerCase().trim();
      if (key) surfaces.set(key, canonical);
    }
  }
  const ordered = [...surfaces.keys()].sort((a, b) => b.length - a.length);
  return { surfaces, ordered };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Ganti nama permukaan dengan kanonik. Dipakai pada title_norm saja. */
export function applyAliases(text: string, aliases: Aliases): string {
  let out = ` ${text.toLowerCase()} `;
  for (const surface of aliases.ordered) {
    if (surface.length < 2) continue;
    const canonical = aliases.surfaces.get(surface)!;
    if (surface === canonical) continue;
    const re = new RegExp(`(?<=[\\s\\p{P}])${escapeRe(surface)}(?=[\\s\\p{P}])`, "gu");
    out = out.replace(re, canonical);
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Potong di batas kata, bukan di tengah kata. */
export function truncateWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
}

/** Lead: 300 karakter pertama, dipotong di batas kata. */
export function makeLead(rawDescription: string, max = 300): string {
  const t = cleanText(rawDescription);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/** Angka perkiraan: "50-an", "puluhan", "ratusan". */
export function approxNumber(text: string): { value: number; approx: boolean } | null {
  const words: Record<string, number> = {
    sepasang: 2,
    beberapa: 3,
    puluhan: 30,
    ratusan: 300,
    ribuan: 3000,
    jutaan: 1_000_000,
  };
  const lower = text.toLowerCase();

  const suf = lower.match(/\b(\d{1,4})-an\b/);
  if (suf) return { value: Number(suf[1]), approx: true };

  for (const [w, v] of Object.entries(words)) {
    if (new RegExp(`\\b${w}\\b`).test(lower)) return { value: v, approx: true };
  }

  const exact = lower.match(/\b(\d{1,4})\b/);
  if (exact) return { value: Number(exact[1]), approx: false };

  return null;
}
