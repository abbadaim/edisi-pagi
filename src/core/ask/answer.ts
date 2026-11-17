/**
 * Satu jawaban Tanya AI (rencana 022, fase 2).
 *
 * Model hanya meringkas bahan yang diberikan. Ia tidak mencari, tidak menyebut
 * URL, dan tidak boleh menambah pengetahuan dari luar bahan (`DEC-0034`).
 * Bila sitasi tidak lolos verifikasi, jawaban turun menjadi "belum ada bahan
 * terverifikasi" — lebih baik kosong daripada terlihat meyakinkan.
 */

import type { LlmAdapter, Usage } from "../../adapters/llm/types.ts";
import type { AskConfig } from "./config.ts";
import { stripUnverifiedQuotes, verifyCitations, type RawCitation, type VerifiedSource } from "./cite.ts";
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

function citationsOf(raw: RawAnswer): RawCitation[] {
  if (!Array.isArray(raw.sitasi)) return [];
  return raw.sitasi
    .map((c) => {
      const obj = (c ?? {}) as Record<string, unknown>;
      // Sebagian model menulis `url` walau diminta `id`; terima keduanya dan
      // biarkan verifikasi yang memutuskan apakah penandanya nyata.
      const key = typeof obj.id === "string" ? obj.id : typeof obj.url === "string" ? obj.url : "";
      return {
        id: key.trim(),
        kutipan: typeof obj.kutipan === "string" ? obj.kutipan : "",
      };
    })
    .filter((c) => c.id.length > 0 && c.kutipan.length > 0);
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
): { system: string; user: string } {
  const system = [
    cfg.prompt,
    `Bentuk jawaban: maksimum ${cfg.bentuk.max_kata} kata, maksimum ${cfg.bentuk.max_paragraf} paragraf.`,
    "Sitasi merujuk id bahan (s1, s2, …) yang diberikan. Jangan menulis URL; URL dipetakan dari id.",
    `Bila bahan tidak menjawab pertanyaan, balas dengan "jawaban" berisi: ${cfg.tolak}`,
  ].join("\n\n");

  const user = [
    `Pertanyaan pembaca: ${question}`,
    "",
    "Bahan (hanya ini yang boleh dipakai):",
    renderMaterial(materials),
  ].join("\n");

  return { system, user };
}

/**
 * Cacat yang bisa dipastikan tanpa model. Jawaban juga dibaca di ponsel, jadi
 * aturan D-TYPO/D-TRUNC berlaku; bedanya di sini tidak ada editor yang bisa
 * memperbaiki setelahnya, jadi temuan berarti jawaban ditahan.
 */
export function lintAnswer(text: string): string[] {
  const issues: string[] = [];
  const t = text.trim();
  if (/[.…]\s*$/.test(t) && /…\s*$/.test(t)) issues.push("teks berakhir dengan elipsis");
  const dup = t.match(/\b(\p{L}{3,})\s+\1\b/giu);
  if (dup) issues.push(`kata ganda: ${dup[0]}`);
  if ((t.match(/"/g) ?? []).length % 2 !== 0) issues.push("tanda kutip tidak seimbang");
  if (t.length < 40) issues.push("terlalu pendek untuk menjawab");
  return issues;
}

export async function writeAnswer(
  llm: LlmAdapter,
  model: string,
  question: string,
  materials: AskMaterial[],
  cfg: AskConfig,
): Promise<AskAnswer> {
  let usage: Usage = { tokens_in: 0, tokens_out: 0 };

  if (materials.length === 0) {
    return { state: "refused", answer: cfg.tolak, sources: [], unsupported: [], reason: "tanpa bahan", usage };
  }

  const { system, user } = buildAskPrompt(question, materials, cfg);

  let text: string;
  try {
    const res = await llm.text({ model, system, user, maxTokens: 900 });
    text = res.text;
    usage = res.usage;
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

  // Bentuk keluaran dan sitasi yang kosong diulang SEKALI (`DEC-0026`). Timeout
  // dan galat jaringan tidak diulang: mengulang timeout hanya menggandakan
  // waktu tunggu (`DEC-0025`). Model gratis memang kadang lupa mengisi sitasi.
  const attempts = [text];
  let parsed: { raw: RawAnswer | null; sources: VerifiedSource[]; unsupported: string[]; jawaban: string } | null = null;
  for (let i = 0; i < attempts.length; i++) {
    const raw = parseJson(attempts[i] ?? "");
    const jawaban = typeof raw?.jawaban === "string" ? raw.jawaban.trim() : "";
    if (raw && jawaban.length > 0) {
      const { sources, unsupported } = verifyCitations(materials, citationsOf(raw));
      parsed = { raw, sources, unsupported, jawaban };
      if (sources.length > 0) break;
    }
    if (i === 0) {
      try {
        const again = await llm.text({ model, system, user, maxTokens: 900 });
        attempts.push(again.text);
        usage = {
          tokens_in: usage.tokens_in + again.usage.tokens_in,
          tokens_out: usage.tokens_out + again.usage.tokens_out,
        };
        text = again.text;
      } catch {
        /* biarkan putaran pertama yang dipakai */
      }
    }
  }

  if (!parsed) {
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

  const { sources, unsupported, jawaban } = parsed;

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

  // Kalimat yang mengutip teks di luar bahan dibuang sebelum apa pun dinilai.
  const cleaned = stripUnverifiedQuotes(jawaban, materials);
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

  return {
    state: "answered",
    answer: trimmed,
    sources,
    unsupported,
    reason: null,
    usage,
  };
}
