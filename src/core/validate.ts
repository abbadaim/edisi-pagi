import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Card, Edition, GapCard, HoaxRoundupCard, DeepDiveCard } from "./types.ts";
import { META_TYPES } from "./types.ts";

export interface ValidationError {
  code: string;
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

export const CODES: Record<string, string> = {
  E000: "melanggar JSON Schema",
  E001: "jumlah kartu tidak sesuai scope",
  E002: "truncated_reason kosong padahal kartu kurang",
  E003: "kartu tanpa sumber atau tanpa action",
  E004: "status terkonfirmasi tanpa sumber tier 1",
  E005: "changes tanpa basis",
  E006: "gap_rank di bawah ambang",
  E007: "hoax_roundup kosong tanpa pattern",
  E008: "item hoaks tanpa url",
  E009: "kartu meta melebihi batas",
  E010: "kartu lokal tanpa sumber DIY",
  E011: "topic_id duplikat",
  E012: "revision > 1 tanpa previous_edition",
  E013: "gambar bukan .webp",
  E014: "jumlah deep_dive salah",
  E015: "deep_dive kurang sumber atau optional salah",
  E016: "jendela coverage bukan ~24 jam",
  E017: "kartu berita tanpa blok konteks (explain) yang memadai",
};

const SCHEMA = JSON.parse(
  readFileSync(new URL("../../schema/edition.schema.json", import.meta.url), "utf8"),
);

interface StructuralError {
  instancePath?: string;
  message?: string;
  params?: unknown;
}

interface ValidateFn {
  (data: unknown): boolean;
  errors?: StructuralError[] | null;
}

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020.js") as new (opts?: object) => {
  compile(schema: object): ValidateFn;
};
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateStructural = ajv.compile(SCHEMA);

const DIY_HOSTS =
  /(^|\.)(jogja\.tribunnews\.com|harianjogja\.com|krjogja\.com|radarjogja\.co\.id|jogjaprov\.go\.id|slemankab\.go\.id|polda\.jogjaprov\.go\.id)$/;

function isLocalSource(url: string): boolean {
  try {
    const u = new URL(url);
    return DIY_HOSTS.test(u.hostname) || u.pathname.startsWith("/jogja/");
  } catch {
    return false;
  }
}

function err(code: string, path: string, message?: string): ValidationError {
  return { code, path, message: message ?? CODES[code] ?? code };
}

export function validateEdition(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  const structural = validateStructural(input);
  if (!structural) {
    for (const e of validateStructural.errors ?? []) {
      errors.push(
        err("E000", `${e.instancePath || "/"}${e.params ? ` (${JSON.stringify(e.params)})` : ""}`, e.message),
      );
    }
    return { ok: false, errors };
  }

  const ed = input as Edition;
  const cards = ed.cards;

  // E001 — jumlah kartu per scope
  // 8 adalah target, bukan jaminan: hari sepi boleh 6 (P5).
  const expected =
    ed.scope === "nasional" ? { min: 5, max: 8 } : ed.scope === "lokal" ? { min: 2, max: 5 } : { min: 3, max: 6 };
  if (cards.length < expected.min || cards.length > expected.max) {
    errors.push(err("E001", "/cards", `scope ${ed.scope}: ${cards.length} kartu, harus ${expected.min}–${expected.max}`));
  }
  if (ed.card_count !== cards.length) {
    errors.push(err("E001", "/card_count", `card_count ${ed.card_count} != cards.length ${cards.length}`));
  }

  // E002 — alasan pemendekan
  if (cards.length < expected.max && !ed.truncated_reason) {
    errors.push(err("E002", "/truncated_reason"));
  }

  // E009 — jumlah kartu meta
  const metaCount = cards.filter((c) => META_TYPES.has(c.type)).length;
  const metaMax = ed.scope === "lokal" ? 1 : ed.scope === "mingguan" ? 0 : 2;
  if (metaCount > metaMax) {
    errors.push(err("E009", "/cards", `${metaCount} kartu meta, maksimum ${metaMax}`));
  }

  // E014 — jumlah deep_dive
  const deepCount = cards.filter((c) => c.type === "deep_dive").length;
  const deepMax = ed.scope === "mingguan" ? 5 : 1;
  if (deepCount > deepMax) {
    errors.push(err("E014", "/cards", `maksimum ${deepMax} deep_dive, ada ${deepCount}`));
  }

  // E016 — jendela coverage ~24 jam
  const from = Date.parse(ed.coverage.from);
  const to = Date.parse(ed.coverage.to);
  const hours = (to - from) / 3_600_000;
  const okWindow =
    ed.scope === "mingguan" ? hours >= 144 && hours <= 192 : Math.abs(hours - 24) <= 1;
  if (!Number.isFinite(hours) || !okWindow) {
    const want = ed.scope === "mingguan" ? "≈168" : "≈24";
    errors.push(err("E016", "/coverage", `jendela ${hours.toFixed(1)} jam, harus ${want}`));
  }

  // Pemeriksaan per kartu
  const seenTopics = new Set<string>();

  cards.forEach((card, i) => {
    const p = `/cards/${i}`;

    // E003
    if (card.sources.length === 0) errors.push(err("E003", `${p}/sources`));
    if (!card.action?.trim()) errors.push(err("E003", `${p}/action`));

    // E004
    if (card.status === "terkonfirmasi" && !card.sources.some((s) => s.tier === 1)) {
      errors.push(err("E004", `${p}/sources`));
    }

    // E005
    card.changes.forEach((ch, j) => {
      if (!ch.basis?.url) errors.push(err("E005", `${p}/changes/${j}/basis`));
    });

    // E006
    if (card.type === "gap") {
      const g = card as GapCard;
      if (Math.abs(g.gap_rank) < 5) {
        errors.push(err("E006", `${p}/gap_rank`, `gap_rank ${g.gap_rank}, ambang |5|`));
      }
    }

    // E007, E008
    if (card.type === "hoax_roundup") {
      const h = card as HoaxRoundupCard;
      if (h.items.length === 0 && !h.pattern) errors.push(err("E007", `${p}`));
      h.items.forEach((it, j) => {
        if (!it.url) errors.push(err("E008", `${p}/items/${j}/url`));
      });
    }

    // E010
    if (card.type === "news" || card.type === "good_news") {
      if (card.place === "lokal" && !card.sources.some((s) => isLocalSource(s.url))) {
        errors.push(err("E010", `${p}/sources`, "tidak ada sumber domain DIY"));
      }
    }

    // E011
    if (seenTopics.has(card.topic_id)) {
      errors.push(err("E011", `${p}/topic_id`, card.topic_id));
    }
    seenTopics.add(card.topic_id);

    // E012
    if (card.revision > 1 && card.previous_edition === null) {
      errors.push(err("E012", `${p}/previous_edition`));
    }

    // E017 — konteks (explain): wajib untuk kartu berita, 2–4 pertanyaan unik
    if (card.type === "news" || card.type === "good_news") {
      const ex = card.explain;
      if (!ex) {
        errors.push(err("E017", `${p}/explain`, "wajib untuk kartu berita"));
      } else if (ex.length < 2 || ex.length > 4) {
        errors.push(err("E017", `${p}/explain`, `${ex.length} pertanyaan, harus 2–4`));
      } else if (new Set(ex.map((x) => x.q.trim().toLowerCase())).size !== ex.length) {
        errors.push(err("E017", `${p}/explain`, "pertanyaan duplikat"));
      }
    } else if (card.explain && card.explain.length > 4) {
      errors.push(err("E017", `${p}/explain`, "maksimum 4 pertanyaan"));
    }

    // E013
    if (card.image && !card.image.url.endsWith(".webp")) {
      errors.push(err("E013", `${p}/image/url`));
    }

    // E015
    if (card.type === "deep_dive") {
      const d = card as DeepDiveCard;
      // Rekap mingguan menggabungkan thread; 3 outlet adalah lantai praktis.
      const minSources = ed.scope === "mingguan" ? 2 : 3;
      if (d.sources.length < minSources) {
        errors.push(err("E015", `${p}/sources`, `${d.sources.length} sumber, minimum ${minSources}`));
      }
      if (d.optional !== true) errors.push(err("E015", `${p}/optional`));
    }
  });

  return { ok: errors.length === 0, errors };
}

/**
 * Edisi tipis (kurang kartu) masih boleh terbit untuk pengujian, tetapi hanya
 * jika kesalahannya memang soal jumlah — bukan struktur atau isi.
 */
export function allowsThin(errors: ValidationError[]): boolean {
  return errors.length > 0 && errors.every((e) => e.code === "E001" || e.code === "E002");
}

export function assertValid(input: unknown): Edition {
  const r = validateEdition(input);
  if (!r.ok) {
    const msg = r.errors.map((e) => `${e.code} ${e.path}: ${e.message}`).join("\n");
    throw new Error(`edisi tidak valid\n${msg}`);
  }
  return input as Edition;
}

export function formatErrors(errors: ValidationError[]): string {
  return errors.map((e) => `  ${e.code}  ${e.path}  ${e.message}`).join("\n");
}

export type { Card, Edition };
