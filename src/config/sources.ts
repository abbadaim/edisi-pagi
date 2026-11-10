import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { buildAliases, type Aliases } from "../core/normalize.ts";

export interface FeedConfig {
  id: string;
  url: string;
  outlet: string;
  weight: number;
  local?: boolean;
  kind?: string;
  /** Sebagian media memblokir UA non-browser. Override per feed. */
  userAgent?: string;
}

export function loadFeeds(path: string): FeedConfig[] {
  const raw = parseYaml(readFileSync(path, "utf8")) as { feeds?: FeedConfig[] } | null;
  const feeds = raw?.feeds ?? [];
  if (feeds.length === 0) throw new Error(`${path}: tidak ada feed`);

  return feeds.map((f) => {
    if (!f.id || !f.url || !f.outlet) throw new Error(`${path}: feed tanpa id/url/outlet`);
    return { ...f, weight: f.weight ?? 1 };
  });
}

export function loadAliases(path: string): Aliases {
  const raw = parseYaml(readFileSync(path, "utf8")) as { active?: Record<string, string[]> } | null;
  return buildAliases(raw?.active ?? {});
}
