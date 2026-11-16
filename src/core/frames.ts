/**
 * “Siapa menyorot apa”: judul asli per media untuk satu kartu (rencana 016).
 *
 * Sumbernya tabel `articles` (judul dari RSS). Tanpa registry pemilik, satu
 * baris = satu media; pengelompokan per pemilik menyusul di rencana 017.
 * Tidak ada panggilan model: judul sudah ada, hanya perlu ditempelkan.
 */

export interface FrameSource {
  outlet: string;
  url: string;
  published_at?: string | null;
}

export interface FrameItem {
  outlet: string;
  title: string;
  url: string;
  at: string | null;
}

/** Cadangan bila URL sumber tidak ada di tabel `articles` (mis. kanonik beda). */
export function headlineFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const segs = path.split("/").filter(Boolean);
    const slug = segs.sort((a, b) => (b.match(/-/g)?.length ?? 0) - (a.match(/-/g)?.length ?? 0))[0] ?? "";
    const words = slug.split(/[-_]+/).filter((w) => w && !/^id[A-Z]{2}$/.test(w));
    const text = words.join(" ").trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
  } catch {
    return "";
  }
}

/**
 * Satu baris per media, urut terbaru. `limit` menjaga strip tetap tiga baris di
 * layar; sisanya dibuka lewat “Lihat semua”.
 */
export function buildFrames(
  sources: FrameSource[],
  titles: Map<string, string>,
  limit = 6,
): FrameItem[] {
  const seen = new Set<string>();
  const out: FrameItem[] = [];

  for (const s of sources) {
    if (!s.url || seen.has(s.outlet)) continue;
    const title = (titles.get(s.url) ?? "").trim() || headlineFromUrl(s.url);
    if (!title) continue;
    seen.add(s.outlet);
    out.push({ outlet: s.outlet, title, url: s.url, at: s.published_at ?? null });
  }

  return out
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
    .slice(0, limit);
}

/** Strip hanya berguna bila ada minimal dua media yang bisa dibandingkan. */
export function hasFrames(items: FrameItem[]): boolean {
  return items.length >= 2;
}
