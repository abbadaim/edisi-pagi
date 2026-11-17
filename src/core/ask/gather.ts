/**
 * Sumber di luar korpus (rencana 022, fase 5).
 *
 * Model boleh mencari di web, tetapi ia tidak berhak menentukan apa yang benar.
 * Ia hanya boleh mengusulkan URL; pipeline yang mengambil halaman itu dan
 * memastikan kalimat yang dikutip benar-benar ada di sana. Cuplikan mesin
 * pencari sengaja TIDAK dipakai: cuplikan sering diparafrase, sehingga kutipan
 * yang lolos dari cuplikan belum tentu ada di halamannya.
 *
 * Modul ini murni terhadap jaringan: pengambil halaman disuntikkan, jadi uji
 * tidak butuh internet.
 */

import { extractArticleText } from "../newsroom/material.ts";
import { quoteInText, type VerifiedSource } from "./cite.ts";

export interface RawWebCitation {
  url: string;
  kutipan: string;
}

export interface FetchedPage {
  text: string;
  ok: boolean;
}

export type UrlFetcher = (url: string) => Promise<FetchedPage>;

export interface GatherResult {
  sources: VerifiedSource[];
  unsupported: string[];
  /** Teks halaman yang lolos, untuk verifikasi kutipan di badan jawaban. */
  texts: string[];
}

/** Rentang IP privat dan nama host lokal — URL datang dari model, jadi jangan dipercaya. */
const PRIVATE_V4 =
  /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "metadata", "metadata.google.internal"]);

/**
 * Hanya http(s) ke host publik. Tanpa ini, model bisa menyuruh pipeline
 * mengambil `http://127.0.0.1:8080/…` atau alamat metadata cloud.
 */
export function isPublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.has(host)) return false;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return false;
  if (PRIVATE_V4.test(host)) return false;
  if (host.includes(":")) return false; // IPv6 literal: tidak ada kasus pakai di sini
  if (!host.includes(".")) return false;
  return true;
}

function outletOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Ambil tiap URL paling banyak sekali, verifikasi kutipannya, dan kembalikan
 * yang lolos. `maxFetch` membatasi jumlah permintaan jaringan; sisanya dicatat
 * sebagai tidak terpakai, bukan diam-diam dibuang.
 */
export async function gatherWebSources(
  citations: RawWebCitation[],
  fetchUrl: UrlFetcher,
  maxFetch: number,
): Promise<GatherResult> {
  const seen = new Set<string>();
  const sources: VerifiedSource[] = [];
  const unsupported: string[] = [];
  const texts: string[] = [];
  let fetches = 0;

  for (const c of citations) {
    const url = (c.url ?? "").trim();
    const quote = (c.kutipan ?? "").trim();
    if (!url || !quote) continue;
    if (!isPublicHttpUrl(url)) {
      unsupported.push(`${outletOf(url)}: alamat tidak dipakai`);
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);

    if (fetches >= maxFetch) {
      unsupported.push(`${outletOf(url)}: batas ${maxFetch} pengambilan tercapai`);
      continue;
    }
    fetches += 1;

    let page: FetchedPage;
    try {
      page = await fetchUrl(url);
    } catch {
      page = { text: "", ok: false };
    }
    if (!page.ok || page.text.trim().length < 200) {
      unsupported.push(`${outletOf(url)}: halaman tidak bisa diambil`);
      continue;
    }
    if (!quoteInText(quote, page.text)) {
      unsupported.push(`${outletOf(url)}: kutipan tidak ditemukan di halaman`);
      continue;
    }

    texts.push(page.text);
    sources.push({
      id: outletOf(url),
      url,
      outlet: outletOf(url),
      published_at: null,
      quote,
      verified: true,
      tier: "luar",
    });
  }

  return { sources, unsupported, texts };
}

/** Pengambil halaman default: fetch biasa + ekstraktor yang sudah dipakai newsroom. */
export function createUrlFetcher(timeoutMs = 12_000): UrlFetcher {
  return async (url: string) => {
    if (!isPublicHttpUrl(url)) return { text: "", ok: false };
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "EdisiPagi/1.0 (+https://abbadaim.github.io/edisi-pagi/)", accept: "text/html" },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      if (!res.ok) return { text: "", ok: false };
      const html = await res.text();
      const text = extractArticleText(html).slice(0, 8000);
      return { text, ok: text.length >= 200 };
    } catch {
      return { text: "", ok: false };
    }
  };
}
