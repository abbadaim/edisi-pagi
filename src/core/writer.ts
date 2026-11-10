import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { AdjudicatedTopic } from "./adjudicate.ts";
import type { Cluster } from "./cluster.ts";
import type { Card, ExplainItem, Source } from "./types.ts";
import { computeTruth } from "./truth.ts";
import { isoWib } from "./time.ts";

export interface GlossaryEntry {
  q: string;
  a: string;
  outlet: string;
  url: string;
}

export type Glossary = Map<string, GlossaryEntry>;

export function loadGlossary(path: string): Glossary {
  const raw = parseYaml(readFileSync(path, "utf8")) as Record<string, GlossaryEntry> | null;
  const m = new Map<string, GlossaryEntry>();
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (!v?.q || !v?.a || !v?.url) continue;
    m.set(k.toLowerCase(), v);
  }
  return m;
}

export interface WriteContext {
  editionId: string;
  publishedAt: string;
  now: Date;
  topic: AdjudicatedTopic;
  topicId: string;
  cluster: Cluster;
  revision: number;
  firstSeen: string;
  previousEdition: string | null;
  local: boolean;
}

export interface CardWriter {
  /** Kembalikan null jika kartu tidak bisa ditulis dengan jujur. */
  write(ctx: WriteContext): Card | null;
}

const KICKER: Record<string, string> = {
  policy: "Nasional",
  safety: "Nasional",
  economy: "Ekonomi",
  health: "Kesehatan",
  culture: "Budaya",
  crime: "Kriminal",
  disaster: "Bencana",
  sport: "Olahraga",
};

const ACTION: Record<string, string> = {
  policy: "Cek dokumen atau rilis resminya sebelum menyebarkan.",
  safety: "Kalau ini menyangkut wilayahmu, ikuti kanal resmi aparat.",
  economy: "Angka ini bisa berubah; cek rilis resmi sebelum mengambil keputusan.",
  health: "Untuk keputusan kesehatan, rujuk ke tenaga medis.",
  culture: "Tidak ada yang perlu dilakukan; ini untuk konteks.",
  crime: "Hindari menyebar identitas korban atau tersangka.",
  disaster: "Ikuti peringatan resmi BMKG atau BPBD setempat.",
  sport: "Tidak ada yang perlu dilakukan.",
};

function truncateWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
}

function tierOf(url: string): 1 | 2 | 3 {
  if (/\.go\.id\//i.test(url)) return 1;
  if (/^(https?:\/\/)([\w.-]+\.)?(detik|kompas|cnnindonesia|tirto|tempo|antaranews|cnbcindonesia|tribunnews|harianjogja|turnbackhoax)/i.test(url)) {
    return 2;
  }
  return 3;
}

export function sourcesFromCluster(cluster: Cluster, now: Date, max = 5): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const a of cluster.articles) {
    const key = a.outlet;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      outlet: a.outlet,
      url: a.url,
      published_at: isoWib(a.publishedAt),
      tier: tierOf(a.url),
      accessed_at: isoWib(now)!,
    });
    if (out.length >= max) break;
  }
  return out;
}

function toItem(g: GlossaryEntry): ExplainItem {
  return { q: g.q, a: g.a, source: { outlet: g.outlet, url: g.url } };
}

/**
 * Frasa yang dicari di teks berita untuk tiap entri glosarium.
 * Kunci pendek seperti `hmp` tidak akan pernah cocok sebagai kata, jadi
 * frasa diambil juga dari pertanyaannya ("Apa itu Hak Menyatakan Pendapat?").
 */
function phrasesFor(key: string, g: GlossaryEntry): string[] {
  const out: string[] = [];
  if (key.includes("_")) out.push(key.replace(/_/g, " "));
  else if (key.length >= 4) out.push(key.toLowerCase());

  const q = g.q.toLowerCase().replace(/\?+\s*$/, "");
  const stripped = q
    .replace(/^(apa itu|apa yang dimaksud dengan|apa yang dimaksud|siapa|bagaimana|mengapa|kenapa|kapan|di mana)\s+/, "")
    .trim();
  if (stripped.length >= 4 && stripped.split(/\s+/).length <= 6) out.push(stripped);

  return [...new Set(out)];
}

/** Teks klaster (judul + lead) dipakai untuk mencocokkan glosarium. */
export function clusterText(cluster: { articles: Array<{ title: string; lead: string }> }): string {
  return cluster.articles
    .slice(0, 12)
    .map((a) => `${a.title} ${a.lead}`)
    .join(" ");
}

/**
 * Minimal satu entri **spesifik** untuk topik ini. Sisanya boleh diisi
 * penjelas tingkat kategori. Tanpa satu pun entri spesifik, kartu tidak terbit:
 * konteks generik saja tidak cukup untuk disebut konteks.
 */
export function explainForTopic(
  topic: AdjudicatedTopic,
  glossary: Glossary,
  extraText = "",
): ExplainItem[] | null {
  const items: ExplainItem[] = [];
  const used = new Set<string>();
  const text = ` ${`${topic.title} ${topic.angle} ${extraText}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;

  // Kumpulkan kandidat, urutkan dari yang paling spesifik: entitas hasil
  // ekstraksi dulu, lalu frasa terpanjang ("hak menyatakan pendapat" >
  // "dpr").
  const found: Array<{ key: string; score: number }> = [];
  for (const id of topic.entities) {
    const key = id.toLowerCase();
    if (glossary.has(key) && !key.startsWith("category_")) {
      found.push({ key, score: 100 + key.length });
    }
  }
  for (const [key, g] of glossary) {
    if (key.startsWith("category_") || used.has(key)) continue;
    for (const phrase of phrasesFor(key, g)) {
      if (new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) {
        found.push({ key, score: phrase.length });
        break;
      }
    }
  }
  found.sort((a, b) => b.score - a.score);

  for (const { key } of found) {
    if (items.length >= 4) break;
    if (used.has(key)) continue;
    const g = glossary.get(key);
    if (!g) continue;
    used.add(key);
    items.push(toItem(g));
  }

  if (items.length === 0) return null;

  if (items.length < 2) {
    const cat = glossary.get(`category_${topic.category}`);
    if (cat) items.push(toItem(cat));
  }

  return items.length >= 2 ? items : null;
}

/**
 * Writer deterministik: menyusun kartu dari data klaster + glosarium.
 * Tidak mengarang latar. Jika glosarium tidak punya >=2 entri untuk topik ini,
 * kartu tidak diterbitkan — konteks adalah bagian dari produk, bukan hiasan.
 */
export function createDeterministicWriter(glossary: Glossary): CardWriter {
  return {
    write(ctx: WriteContext): Card | null {
      const explain = explainForTopic(ctx.topic, glossary, clusterText(ctx.cluster));
      if (!explain) return null;

      const sources = sourcesFromCluster(ctx.cluster, ctx.now);
      if (sources.length === 0) return null;

      const body = ctx.cluster.articles
        .slice(0, 2)
        .map((a) => (a.lead || a.title).slice(0, 460))
        .filter(Boolean);

      const truth = computeTruth(
        {
          claim: ctx.topic.angle,
          sources,
          numeric: /\d/.test(ctx.topic.title),
        },
        ctx.now,
      );

      return {
        id: "c1",
        type: "news",
        topic_id: ctx.topicId,
        angle: ctx.topic.angle.slice(0, 90),
        kicker: ctx.local ? "Sleman" : (KICKER[ctx.topic.category] ?? "Nasional"),
        title: truncateWords(ctx.topic.title, 68),
        status: truth.status,
        truth,
        body: body.length ? body : [ctx.topic.title],
        explain,
        action: ACTION[ctx.topic.category] ?? ACTION.policy!,
        image: null,
        sources,
        place: ctx.local ? "lokal" : "nasional",
        revision: ctx.revision,
        first_seen: ctx.firstSeen,
        previous_edition: ctx.previousEdition,
        changes: [],
      } as Card;
    },
  };
}
