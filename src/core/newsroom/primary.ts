/**
 * Sumber primer (P4a). Bukan crawl bebas.
 *
 * Tiga jalur deterministik:
 * 1. artikel resmi yang sudah ada di klaster/database,
 * 2. tautan resmi yang disebut di teks klaster,
 * 3. halaman listing resmi dari `config/primary-sources.yaml`.
 *
 * Model tidak pernah menentukan URL. Ia hanya memilih bahan yang sudah diambil.
 */

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { Db } from "../../adapters/db/sqlite.ts";
import type { AdjudicatedTopic } from "../adjudicate.ts";
import type { Cluster } from "../cluster.ts";
import type { FetchCache } from "./cache.ts";

export interface PrimarySourceConfig {
  id: string;
  entities: string[];
  domains: string[];
  listing?: string;
  /** Endpoint BPS WebAPI; butuh BPS_API_KEY. `{key}` diganti otomatis. */
  api?: string;
}

export interface PrimaryCandidate {
  url: string;
  outlet: string;
  published_at: string | null;
  text: string;
}

const UA = "EdisiPagi/0.1 (+personal news aggregator; primary sources)";

export function loadPrimarySources(path: string): PrimarySourceConfig[] {
  try {
    const raw = parseYaml(readFileSync(path, "utf8")) as { sources?: PrimarySourceConfig[] } | null;
    return (raw?.sources ?? []).filter((s) => s.id && s.domains?.length);
  } catch {
    return [];
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function domainAllowed(host: string, configs: PrimarySourceConfig[]): boolean {
  return configs.some((c) => c.domains.some((d) => host === d || host.endsWith(`.${d}`)));
}

export function matchPrimarySources(
  configs: PrimarySourceConfig[],
  topic: AdjudicatedTopic,
): PrimarySourceConfig[] {
  const text = `${topic.title} ${topic.angle} ${topic.entities.join(" ")}`
    .toLowerCase()
    .replace(/_/g, " ");
  return configs.filter((c) =>
    c.entities.some((e) => {
      const phrase = e.toLowerCase().replace(/_/g, " ");
      return topic.entities.includes(e) || text.includes(phrase);
    }),
  );
}

export interface Anchor {
  url: string;
  text: string;
}

/** Ambil anchor dari halaman listing; hanya URL http(s) di domain yang sama. */
export function extractLinks(html: string, baseUrl: string, domains: string[]): Anchor[] {
  const base = new URL(baseUrl);
  const out: Anchor[] = [];
  const seen = new Set<string>();

  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = (m[1] ?? "").trim();
    if (!href || href.startsWith("#") || /^(javascript|mailto|tel):/i.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol)) continue;
    const host = url.hostname.replace(/^www\./, "");
    if (!domains.some((d) => host === d || host.endsWith(`.${d}`))) continue;
    const text = (m[2] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 15 || text.length > 180) continue;
    url.hash = "";
    const key = url.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: key, text });
  }
  return out;
}

function tokens(s: string): Set<string> {
  return new Set(
    (s.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter(
      (w) => !["yang", "untuk", "dari", "dengan", "pada", "dalam", "akan", "tidak", "juga", "disebut"].includes(w),
    ),
  );
}

function relevance(anchor: string, topic: AdjudicatedTopic): number {
  const target = tokens(`${topic.title} ${topic.angle} ${topic.entities.join(" ")}`);
  const text = tokens(anchor);
  let hit = 0;
  for (const t of text) if (target.has(t)) hit++;
  return hit;
}

export interface PrimarySearchInput {
  db?: Db;
  topic: AdjudicatedTopic;
  cluster: Cluster;
  configs: PrimarySourceConfig[];
  fromIso: string;
  toIso: string;
  cache?: FetchCache;
  max?: number;
  maxListing?: number;
  /** Untuk uji tanpa jaringan: listing dan artikel memakai fungsi ini. */
  fetchImpl?: (url: string) => Promise<{ text: string; ok: boolean }>;
}

export async function findPrimarySources(input: PrimarySearchInput): Promise<PrimaryCandidate[]> {
  if (input.configs.length === 0) return [];
  const max = input.max ?? 2;
  const maxListing = input.maxListing ?? 1;
  const matched = matchPrimarySources(input.configs, input.topic);
  if (matched.length === 0) return [];

  const out: PrimaryCandidate[] = [];
  const seen = new Set<string>();
  const add = (url: string, outlet: string, text: string, publishedAt: string | null) => {
    if (seen.has(url) || text.trim().length < 40) return;
    seen.add(url);
    out.push({ url, outlet, published_at: publishedAt, text: text.trim() });
  };

  // 1. Artikel resmi di klaster.
  for (const a of input.cluster.articles) {
    if (!domainAllowed(hostOf(a.url), matched)) continue;
    add(a.url, a.outlet, a.lead, a.publishedAt);
  }

  // 2. Artikel resmi yang sudah masuk database.
  if (input.db) {
    const likes = matched.flatMap((c) => c.domains.map(() => "url LIKE ?"));
    const params = matched.flatMap((c) => c.domains.map((d) => `%${d}%`));
    try {
      const rows = input.db.all<{
        url: string;
        outlet: string;
        lead: string | null;
        published_at: string | null;
      }>(
        `SELECT url, outlet, lead, published_at FROM articles
          WHERE is_duplicate_of IS NULL
            AND published_at BETWEEN ? AND ?
            AND (${likes.join(" OR ")})
          ORDER BY published_at DESC LIMIT 40`,
        [input.fromIso, input.toIso, ...params],
      );
      for (const r of rows) {
        if (!domainAllowed(hostOf(r.url), matched)) continue;
        add(r.url, r.outlet, r.lead ?? "", r.published_at);
        if (out.length >= max) break;
      }
    } catch {
      /* database lama tanpa kolom; abaikan */
    }
  }

  // 3. Halaman listing resmi (maksimum 1–2 fetch per topik).
  const get = async (url: string) => {
    if (input.fetchImpl) return input.fetchImpl(url);
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA },
        signal: AbortSignal.timeout(10_000),
        redirect: "follow",
      });
      if (!res.ok) return { text: "", ok: false };
      return { text: await res.text(), ok: true };
    } catch {
      return { text: "", ok: false };
    }
  };

  // BPS: API resmi (butuh kunci). Tanpa kunci, BPS tetap diambil dari
  // tautan resmi yang sudah ada di klaster/database.
  const bpsKey = process.env.BPS_API_KEY;
  if (bpsKey) {
    for (const cfg of matched.filter((c) => c.id.startsWith("bps") && c.api)) {
      if (out.length >= max) break;
      const apiUrl = cfg.api!.replace("{key}", encodeURIComponent(bpsKey));
      const page = await get(apiUrl);
      if (!page.ok) continue;
      try {
        const json = JSON.parse(page.text) as { data?: unknown };
        const rows = Array.isArray(json.data)
          ? json.data
          : Array.isArray((json.data as { data?: unknown })?.data)
            ? ((json.data as { data: unknown[] }).data)
            : [];
        for (const raw of rows.slice(0, 20)) {
          const row = raw as Record<string, unknown>;
          const title = String(row.title ?? row.judul ?? "").trim();
          const abstract = String(row.abstract ?? row.abstraksi ?? "").trim();
          if (!title || relevance(`${title} ${abstract}`, input.topic) === 0) continue;
          const url = String(row.link ?? row.url ?? "").trim();
          const text = (abstract || title).slice(0, 4000);
          if (url) add(url, new URL(url).hostname.replace(/^www\./, ""), text, String(row.updt_date ?? row.date ?? "").slice(0, 10) || null);
          if (out.length >= max) break;
        }
      } catch {
        /* bentuk respons BPS berubah; abaikan */
      }
    }
  }

  let listingFetches = 0;
  for (const cfg of matched) {
    if (out.length >= max || listingFetches >= maxListing || !cfg.listing) break;
    listingFetches++;
    const page = await get(cfg.listing);
    if (!page.ok) continue;

    const anchors = extractLinks(page.text, cfg.listing, cfg.domains)
      .map((a) => ({ ...a, score: relevance(a.text, input.topic) }))
      .filter((a) => a.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    for (const a of anchors) {
      if (out.length >= max) break;
      const article = await get(a.url);
      let text = article.ok ? article.text : "";
      if (!text && input.cache) text = (await input.cache.get(a.url)) ?? "";
      if (article.ok && input.cache) await input.cache.set(a.url, text);
      if (!text) text = a.text;
      add(a.url, new URL(a.url).hostname.replace(/^www\./, ""), text, null);
    }
  }

  return out.slice(0, max);
}

