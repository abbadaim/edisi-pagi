/**
 * “Siapa menyorot apa”: judul asli per media untuk satu kartu (rencana 016/017).
 *
 * Sumbernya tabel `articles` (judul dari RSS). Bila registry pemilik tersedia,
 * baris dikelompokkan per **pemilik**: tiga media CT Corp menjadi satu baris
 * dengan penanda “3 media”. Tanpa registry, satu baris = satu media.
 * Tidak ada panggilan model.
 */

import type { OwnerLookup } from "./outlets.ts";

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
  /** Pemilik media, bila registry terverifikasi. */
  owner?: string | null;
  /** Jumlah media dalam grup ini (1 bila tanpa registry). */
  media?: number;
}

export interface FrameOptions {
  ownerOf?: OwnerLookup;
  limit?: number;
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
 * Satu baris per pemilik (atau per media tanpa registry), judul terbaru di
 * grup itu dipakai sebagai wakil. `limit` menjaga strip tetap tiga baris.
 */
export function buildFrames(sources: FrameSource[], titles: Map<string, string>, opts: FrameOptions = {}): FrameItem[] {
  const limit = opts.limit ?? 6;
  const groups = new Map<string, FrameItem>();

  for (const s of sources) {
    if (!s.url) continue;
    const title = (titles.get(s.url) ?? "").trim() || headlineFromUrl(s.url);
    if (!title) continue;

    const owner = opts.ownerOf ? opts.ownerOf(s.outlet) : null;
    const key = owner ? `owner:${owner}` : `outlet:${s.outlet}`;
    const item: FrameItem = {
      outlet: s.outlet,
      title,
      url: s.url,
      at: s.published_at ?? null,
      owner: owner ?? null,
      media: 1,
    };

    const prev = groups.get(key);
    if (!prev) {
      groups.set(key, item);
      continue;
    }
    // Grup yang sama: simpan yang terbaru sebagai wakil, tambah hitungan media.
    const newer = (item.at ?? "").localeCompare(prev.at ?? "") > 0;
    groups.set(key, {
      ...(newer ? item : prev),
      media: (prev.media ?? 1) + 1,
    });
  }

  return [...groups.values()]
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
    .slice(0, limit);
}

/** Strip hanya berguna bila ada minimal dua grup yang bisa dibandingkan. */
export function hasFrames(items: FrameItem[]): boolean {
  return items.length >= 2;
}
