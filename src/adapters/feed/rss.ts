import { XMLParser } from "fast-xml-parser";

export interface RawFeedItem {
  title: string;
  link: string;
  publishedAt: string | null;
  description: string;
}

export interface ParsedFeed {
  title: string;
  items: RawFeedItem[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "#cdata",
  textNodeName: "#text",
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

type Node = unknown;

function asArray(v: Node): Node[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(v: Node): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(" ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o["#cdata"] === "string") return o["#cdata"];
    if (typeof o["#text"] === "string") return o["#text"];
    if (typeof o["@_href"] === "string") return o["@_href"];
  }
  return "";
}

function linkOf(v: Node): string {
  for (const item of asArray(v)) {
    if (typeof item === "string") return item.trim();
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const href = o["@_href"];
      if (typeof href === "string") return href.trim();
      const txt = o["#text"];
      if (typeof txt === "string") return txt.trim();
    }
  }
  return "";
}

function dateOf(v: Node): string | null {
  const raw = textOf(v);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseFeed(xml: string): ParsedFeed {
  const doc = parser.parse(xml) as Record<string, any>;

  const rss = doc?.rss?.channel;
  if (rss) {
    const items = asArray(rss.item).map((it: any): RawFeedItem => ({
      title: textOf(it.title),
      link: linkOf(it.link),
      publishedAt: dateOf(it.pubDate ?? it.published ?? it["dc:date"]),
      description: textOf(it.description ?? it["content:encoded"] ?? it.summary),
    }));
    return { title: textOf(rss.title), items };
  }

  const feed = doc?.feed;
  if (feed) {
    const items = asArray(feed.entry).map((it: any): RawFeedItem => ({
      title: textOf(it.title),
      link: linkOf(it.link),
      publishedAt: dateOf(it.published ?? it.updated),
      description: textOf(it.summary ?? it.content),
    }));
    return { title: textOf(feed.title), items };
  }

  return { title: "", items: [] };
}

export async function fetchFeed(
  url: string,
  timeoutMs = 15_000,
  userAgent = "EdisiPagi/0.1 (+personal news aggregator)",
): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "user-agent": userAgent,
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
