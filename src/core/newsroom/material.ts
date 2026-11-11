/**
 * Meja riset (NEWSROOM.md §4.2).
 *
 * Bukan agen: pengambilan bersifat deterministik dan dibatasi daftar izin.
 * LLM tidak pernah menentukan URL; ia hanya memilih bahan yang sudah diambil.
 */

import type { Db } from "../../adapters/db/sqlite.ts";
import { fetchWikiSummary } from "../../adapters/wiki.ts";
import type { AdjudicatedTopic } from "../adjudicate.ts";
import type { Cluster } from "../cluster.ts";
import type { Glossary } from "../writer.ts";
import { backgroundCandidates } from "../writer-llm.ts";
import { isoWib } from "../time.ts";
import type { MaterialItem, MaterialPack } from "./contracts.ts";
import type { FetchCache } from "./cache.ts";
import type { PrimaryCandidate } from "./primary.ts";

const UA = "EdisiPagi/0.1 (+personal news aggregator; POC)";

/** Domain yang boleh diambil. Sumber lain tidak pernah disentuh. */
const ALLOWED = [
  "detik.com",
  "kompas.com",
  "cnnindonesia.com",
  "antaranews.com",
  "tempo.co",
  "tirto.id",
  "cnbcindonesia.com",
  "tribunnews.com",
  "harianjogja.com",
  "krjogja.com",
  "republika.co.id",
  "sindonews.com",
  "okezone.com",
  "kumparan.com",
  "turnbackhoax.id",
];

function hostAllowed(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host.endsWith(".go.id") || ALLOWED.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function tierOf(url: string): 1 | 2 | 3 {
  if (/\.go\.id\//i.test(url)) return 1;
  if (ALLOWED.some((d) => url.includes(d))) return 2;
  return 3;
}

const JUNK = /(tautan telah disalin|menu detikcom|topik terkait|baca juga|advertisement|scroll|simak video|dapatkan berita|berbagi:|daftar isi|pedoman media|dilarang keras mengambil konten|penerjemah:|copyright antara|hak cipta dilindungi)/i;

/** Penanda dateline: potong awalan navigasi yang menempel pada paragraf pertama. */
const DATELINE = [
  /CNN Indonesia\s*[-–—]{1,2}\s*/i,
  /\(ANTARA\)\s*[-–—]{1,2}\s*/i,
  /detikcom\s*[-–—]{1,2}\s*/i,
  /\b(?:Jakarta|Sleman|Yogyakarta|Jogja|Bandung|Surabaya|Semarang|Medan|Moskow)\s*[-–—]{1,2}\s*/i,
];

function lowercaseRatio(s: string): number {
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (!letters) return 1;
  return (letters.match(/[a-z]/g) ?? []).length / letters.length;
}

function trimDateline(p: string): string {
  let out = p;
  for (const re of DATELINE) {
    // Hanya awalan navigasi yang dipotong; penyebutan "Jakarta -" di tengah
    // paragraf adalah bagian dari prosa.
    const hit = [...out.matchAll(new RegExp(re.source, "gi"))]
      .filter((m) => (m.index ?? 0) <= 160)
      .pop();
    if (hit && hit.index !== undefined) {
      out = out.slice(hit.index + hit[0].length);
    }
  }
  return out.trim();
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&[a-z]+;/gi, " ");
}

/** Ekstraktor heuristik: paragraf yang benar-benar prosa, bukan menu. */
export function extractArticleText(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " ");

  const paragraphs = [...cleaned.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => decode((m[1] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 60)
    .map(trimDateline)
    .filter((p) => p.length > 60)
    .filter((p) => !JUNK.test(p) && lowercaseRatio(p) >= 0.45)
    .filter((p) => !/^(arsip|foto|ilustrasi|video)\s*[-–—:]/i.test(p));

  return paragraphs.join("\n\n");
}

export async function fetchArticleText(
  url: string,
  timeoutMs = 12_000,
): Promise<{ text: string; ok: boolean }> {
  if (!hostAllowed(url)) return { text: "", ok: false };
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!res.ok) return { text: "", ok: false };
    const html = await res.text();
    const text = extractArticleText(html);
    return { text: text.length >= 200 ? text.slice(0, 6000) : "", ok: text.length >= 200 };
  } catch {
    return { text: "", ok: false };
  }
}

async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface ResearchOptions {
  maxFetch?: number;
  timeoutMs?: number;
  /** Untuk uji tanpa jaringan. */
  fetchImpl?: (url: string) => Promise<{ text: string; ok: boolean }>;
  /** Cache teks penuh (produksi). */
  cache?: FetchCache;
  /** Bahan primer yang sudah ditemukan sebelum paket ini dibangun. */
  primary?: PrimaryCandidate[];
}

/**
 * Paket material untuk satu topik. Bahan lama (lead) tetap ada; teks penuh
 * ditambahkan bila berhasil diambil sehingga writer punya isi, bukan hanya
 * ringkasan feed.
 */
export async function buildMaterialPack(
  topic: AdjudicatedTopic,
  cluster: Cluster,
  topicId: string,
  glossary: Glossary,
  opts: ResearchOptions = {},
): Promise<MaterialPack> {
  const maxFetch = opts.maxFetch ?? 4;
  const get = opts.fetchImpl ?? ((u: string) => fetchArticleText(u, opts.timeoutMs));

  const articles = cluster.articles.slice(0, maxFetch);
  const fetched = await pool(articles, 3, async (a) => {
    const cached = opts.cache ? await opts.cache.get(a.url) : null;
    if (cached) return { article: a, text: cached, ok: true, cached: true };
    const r = await get(a.url);
    if (r.ok && opts.cache) await opts.cache.set(a.url, r.text);
    return { article: a, ...r, cached: false };
  });

  const items: MaterialItem[] = [];
  let fetchedCount = 0;
  let cachedCount = 0;
  let failed = 0;
  const urls: string[] = [];

  for (const f of fetched) {
    urls.push(f.article.url);
    if (f.ok) fetchedCount++;
    else failed++;
    if (f.cached) cachedCount++;
    items.push({
      id: `s${items.length + 1}`,
      kind: /\.go\.id\//i.test(f.article.url) ? "primary" : "article",
      outlet: f.article.outlet,
      url: f.article.url,
      published_at: isoWib(f.article.publishedAt),
      tier: tierOf(f.article.url),
      text: f.ok ? f.text : f.article.lead,
      chars: (f.ok ? f.text : f.article.lead).length,
      full_text: f.ok,
    });
  }

  // Bahan primer (P4a): domain resmi / listing / artikel yang sudah ada.
  let primaryCount = 0;
  for (const p of opts.primary ?? []) {
    if (items.some((i) => i.url === p.url)) continue;
    items.push({
      id: `s${items.length + 1}`,
      kind: "primary",
      outlet: p.outlet,
      url: p.url,
      published_at: p.published_at,
      tier: 1,
      text: p.text,
      chars: p.text.length,
      full_text: true,
    });
    primaryCount++;
  }

  // Artikel klaster yang tidak diambil tetap berguna sebagai ringkasan.
  for (const a of cluster.articles.slice(maxFetch, maxFetch + 4)) {
    items.push({
      id: `s${items.length + 1}`,
      kind: "article",
      outlet: a.outlet,
      url: a.url,
      published_at: isoWib(a.publishedAt),
      tier: tierOf(a.url),
      text: a.lead,
      chars: a.lead.length,
      full_text: false,
    });
  }

  // Latar: glosarium + Wikipedia. Hanya boleh dipilih, bukan dikarang.
  const bg = await backgroundCandidates(topic, glossary, 4, "", cluster.articles);
  for (const c of bg) {
    items.push({
      id: c.key,
      kind: "background",
      outlet: c.outlet,
      url: c.url,
      published_at: null,
      tier: tierOf(c.url),
      text: c.a,
      chars: c.a.length,
      full_text: false,
    });
  }

  const leadChars = cluster.articles.reduce((n, a) => n + a.lead.length, 0);
  const materialChars = items
    .filter((i) => i.kind !== "background")
    .reduce((n, i) => n + i.chars, 0);

  return {
    topic_id: topicId,
    items,
    missing: [],
    stats: {
      lead_chars: leadChars,
      material_chars: materialChars,
      fetched: fetchedCount,
      cached: cachedCount,
      primary: primaryCount,
      failed,
      urls,
    },
  };
}

/**
 * Putaran bahan tambahan saat writer mengembalikan `needs[]`.
 * Deterministik: cari artikel lain di database, bukan menjelajah web.
 */
export function expandFromDb(
  db: Db,
  pack: MaterialPack,
  needs: string[],
  fromIso: string,
  toIso: string,
  max = 3,
): MaterialItem[] {
  const added: MaterialItem[] = [];
  const known = new Set(pack.items.map((i) => i.url));
  const terms = needs
    .join(" ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 5)
    .slice(0, 8);

  if (terms.length === 0) return added;

  const where = terms.map(() => "(lower(title_display) LIKE ? OR lower(lead) LIKE ?)").join(" OR ");
  const params: string[] = [];
  for (const t of terms) params.push(`%${t}%`, `%${t}%`);

  const rows = db.all<{
    url: string;
    outlet: string;
    title_display: string;
    lead: string | null;
    published_at: string | null;
  }>(
    `SELECT url, outlet, title_display, lead, published_at FROM articles
      WHERE is_duplicate_of IS NULL AND published_at BETWEEN ? AND ?
        AND (${where})
      ORDER BY published_at DESC LIMIT ?`,
    [fromIso, toIso, ...params, max],
  );

  for (const r of rows) {
    if (known.has(r.url)) continue;
    known.add(r.url);
    const text = `${r.title_display}. ${r.lead ?? ""}`.trim();
    added.push({
      id: `s${pack.items.length + added.length + 1}`,
      kind: /\.go\.id\//i.test(r.url) ? "primary" : "article",
      outlet: r.outlet,
      url: r.url,
      published_at: isoWib(r.published_at),
      tier: tierOf(r.url),
      text,
      chars: text.length,
      full_text: false,
    });
  }
  return added;
}

export { fetchWikiSummary, hostAllowed };
