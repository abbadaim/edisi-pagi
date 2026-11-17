/**
 * Satu jawaban Tanya AI (rencana 022).
 *
 * Model hanya meringkas bahan yang diberikan, dan boleh mencari di web bila
 * diizinkan. Ia tidak pernah boleh menentukan bahwa sesuatu itu benar: setiap
 * sitasi — dari arsip maupun dari halaman luar — harus dibuktikan oleh pipeline.
 * Bila tidak ada yang lolos, jawaban ditahan (`DEC-0032`, `DEC-0033`).
 */

import type { LlmAdapter, Usage } from "../../adapters/llm/types.ts";
import type { AskConfig } from "./config.ts";
import {
  stripUnverifiedQuotesIn,
  verifyCitations,
  type RawCitation,
  type VerifiedSource,
} from "./cite.ts";
import { gatherWebSources, isPublicHttpUrl, type RawWebCitation, type UrlFetcher } from "./gather.ts";
import { renderMaterial, type AskMaterial } from "./retrieve.ts";

export interface AskAnswer {
  state: "answered" | "refused";
  answer: string;
  sources: VerifiedSource[];
  unsupported: string[];
  reason: string | null;
  usage?: Usage;
  /** Keluaran mentah model; hanya untuk diagnosis, tidak pernah diterbitkan. */
  raw?: string;
}

interface RawAnswer {
  jawaban?: unknown;
  sitasi?: unknown;
  tidak_terjawab?: unknown;
}

function parseJson(text: string): RawAnswer | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as RawAnswer;
  } catch {
    return null;
  }
}

/**
 * Pisahkan sitasi menjadi dua jenis. Model kadang menulis `id` (s1), kadang
 * `url` — untuk bahan arsip keduanya diterima, karena verifikasi tetap
 * mencocokkan isinya. URL di luar bahan masuk jalur pengambilan halaman.
 */
export function splitCitations(
  raw: unknown,
  materials: AskMaterial[],
): { corpus: RawCitation[]; web: RawWebCitation[] } {
  const byId = new Set(materials.map((m) => m.id));
  const byUrl = new Set(materials.map((m) => m.url));
  const corpus: RawCitation[] = [];
  const web: RawWebCitation[] = [];

  for (const item of Array.isArray(raw) ? raw : []) {
    const obj = (item ?? {}) as Record<string, unknown>;
    const key = typeof obj.id === "string" ? obj.id.trim() : typeof obj.url === "string" ? obj.url.trim() : "";
    const quote = typeof obj.kutipan === "string" ? obj.kutipan.trim() : "";
    if (!key || !quote) continue;
    if (byId.has(key) || byUrl.has(key)) corpus.push({ id: key, kutipan: quote });
    else if (isPublicHttpUrl(key)) web.push({ url: key, kutipan: quote });
  }

  return { corpus, web };
}

/**
 * Cacat yang bisa dipastikan tanpa model. Jawaban juga dibaca di ponsel, jadi
 * aturan D-TYPO/D-TRUNC berlaku; bedanya di sini tidak ada editor yang bisa
 * memperbaiki setelahnya, jadi temuan berarti jawaban ditahan.
 */
export function lintAnswer(text: string): string[] {
  const issues: string[] = [];
  const t = text.trim();
  if (/…\s*$/.test(t)) issues.push("teks berakhir dengan elipsis");
  const dup = t.match(/\b(\p{L}{3,})\s+\1\b/giu);
  if (dup) issues.push(`kata ganda: ${dup[0]}`);
  if ((t.match(/"/g) ?? []).length % 2 !== 0) issues.push("tanda kutip tidak seimbang");
  if (t.length < 40) issues.push("terlalu pendek untuk menjawab");
  return issues;
}

/**
 * Potong ke batas kata pada batas kalimat. Tidak memakai elipsis: jawaban yang
 * berakhir "…" adalah cacat tampilan, bukan gaya (`D-TRUNC`).
 */
export function trimToWords(text: string, maxKata: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxKata) return text.trim();
  const kept: string[] = [];
  for (const sentence of text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text]) {
    const next = [...kept, sentence.trim()].filter(Boolean);
    if (next.join(" ").split(/\s+/).length > maxKata) break;
    kept.push(sentence.trim());
  }
  if (kept.length === 0) return words.slice(0, maxKata).join(" ") + ".";
  return kept.join(" ");
}

export function buildAskPrompt(
  question: string,
  materials: AskMaterial[],
  cfg: AskConfig,
  allowWeb: boolean,
): { system: string; user: string } {
  const system = [
    cfg.prompt,
    `Bentuk jawaban: maksimum ${cfg.bentuk.max_kata} kata, maksimum ${cfg.bentuk.max_paragraf} paragraf.`,
    "Sitasi dari bahan memakai id (s1, s2, …). Jangan menulis URL bahan; URL dipetakan dari id.",
    allowWeb
      ? "Tool websearch boleh dipakai bila bahan tidak menjawab. Untuk sumber dari web, sitasi memakai {\"url\":\"https://…\",\"kutipan\":\"…\"}, dan kutipan disalin dari HALAMANNYA, bukan dari cuplikan hasil pencarian."
      : "Tool websearch jangan dipakai. Hanya bahan di bawah yang boleh dirujuk.",
    `Bila bahan tidak menjawab pertanyaan, balas dengan "jawaban" berisi: ${cfg.tolak}`,
  ].join("\n\n");

  const user = [
    `Pertanyaan pembaca: ${question}`,
    "",
    "Bahan (hanya ini yang boleh dipakai tanpa verifikasi halaman):",
    renderMaterial(materials),
  ].join("\n");

  return { system, user };
}

interface Evaluation {
  sources: VerifiedSource[];
  unsupported: string[];
  jawaban: string;
  texts: string[];
}

/** Verifikasi satu keluaran model: sitasi arsip + sitasi halaman luar. */
export async function evaluateAnswer(
  text: string,
  materials: AskMaterial[],
  opts: { allowWeb: boolean; maxFetch: number; fetchUrl?: UrlFetcher },
): Promise<Evaluation | null> {
  const raw = parseJson(text);
  const jawaban = typeof raw?.jawaban === "string" ? raw.jawaban.trim() : "";
  if (!raw || jawaban.length === 0) return null;

  const { corpus, web } = splitCitations(raw.sitasi, materials);
  const local = verifyCitations(materials, corpus);
  const remote =
    opts.allowWeb && opts.fetchUrl && web.length > 0
      ? await gatherWebSources(web, opts.fetchUrl, opts.maxFetch)
      : { sources: [], unsupported: [], texts: [] };

  return {
    sources: [...local.sources, ...remote.sources],
    unsupported: [...local.unsupported, ...remote.unsupported],
    jawaban,
    texts: [...materials.map((m) => m.text), ...remote.texts],
  };
}

export async function writeAnswer(
  llm: LlmAdapter,
  model: string,
  question: string,
  materials: AskMaterial[],
  cfg: AskConfig,
  opts: { fetchUrl?: UrlFetcher } = {},
): Promise<AskAnswer> {
  let usage: Usage = { tokens_in: 0, tokens_out: 0 };
  const allowWeb = cfg.cari.enabled && cfg.cari.izin_luar_bahan;

  if (materials.length === 0 && !allowWeb) {
    return { state: "refused", answer: cfg.tolak, sources: [], unsupported: [], reason: "tanpa bahan", usage };
  }

  const { system, user } = buildAskPrompt(question, materials, cfg, allowWeb);

  let text = "";
  let result: Evaluation | null = null;

  // Bentuk keluaran dan sitasi kosong diulang SEKALI (`DEC-0026`). Timeout dan
  // galat jaringan tidak diulang (`DEC-0025`).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await llm.text({ model, system, user, maxTokens: 900 });
      text = res.text;
      usage = {
        tokens_in: usage.tokens_in + res.usage.tokens_in,
        tokens_out: usage.tokens_out + res.usage.tokens_out,
      };
    } catch (e) {
      return {
        state: "refused",
        answer: cfg.tolak,
        sources: [],
        unsupported: [],
        reason: e instanceof Error ? e.message : "panggilan model gagal",
        usage,
      };
    }

    result = await evaluateAnswer(text, materials, {
      allowWeb,
      maxFetch: cfg.cari.max_fetch,
      fetchUrl: opts.fetchUrl,
    });
    if (result && result.sources.length > 0) break;
  }

  if (!result) {
    return {
      state: "refused",
      answer: cfg.tolak,
      sources: [],
      unsupported: [],
      reason: "keluaran bukan JSON yang sah",
      usage,
      raw: text,
    };
  }

  const { sources, texts } = result;
  const unsupported = [...result.unsupported];

  // Tidak ada satu pun sitasi yang lolos → tidak ada dasar untuk menerbitkan
  // jawaban, sekalipun kalimatnya terdengar meyakinkan.
  if (sources.length === 0) {
    return {
      state: "refused",
      answer: cfg.tolak,
      sources: [],
      unsupported,
      reason: "tidak ada sitasi yang lolos verifikasi",
      usage,
      raw: text,
    };
  }

  // Kalimat yang mengutip teks di luar bahan dan di luar halaman yang diambil
  // dibuang sebelum apa pun dinilai.
  const cleaned = stripUnverifiedQuotesIn(result.jawaban, texts);
  const trimmed = trimToWords(cleaned.text, cfg.bentuk.max_kata);
  unsupported.push(...cleaned.dropped);

  if (trimmed.length < 40) {
    return {
      state: "refused",
      answer: cfg.tolak,
      sources: [],
      unsupported,
      reason: "setelah kutipan tak terverifikasi dibuang, tidak ada yang tersisa",
      usage,
    };
  }

  const lint = lintAnswer(trimmed);
  if (lint.length > 0) {
    return {
      state: "refused",
      answer: cfg.tolak,
      sources: [],
      unsupported,
      reason: `cacat teks: ${lint.join("; ")}`,
      usage,
    };
  }

  return { state: "answered", answer: trimmed, sources, unsupported, reason: null, usage };
}
