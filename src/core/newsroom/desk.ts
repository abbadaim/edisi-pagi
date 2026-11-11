/**
 * Meja terbit (NEWSROOM.md §4.5).
 *
 * Gerbang deterministik lebih dulu; satu panggilan LLM hanya untuk pertanyaan
 * tingkat edisi yang tidak bisa dihitung: sudut kembar, kelayakan set, dan
 * tindak lanjut yang dijanjikan.
 */

import type { LlmAdapter } from "../../adapters/llm/types.ts";
import { features, similarity } from "../simhash.ts";
import type { DeskResult, EditResult } from "./contracts.ts";

export interface DeskCard {
  card_id: string;
  title: string;
  angle: string;
  category: string;
  depth: string;
  body_chars: number;
  cited_paragraphs: number;
  paragraphs: number;
  sources: number;
  editor_verdict: EditResult["verdict"];
  depth_check: EditResult["depth_check"];
  blocking: number;
}

export function deterministicDesk(
  cards: DeskCard[],
  opts: { minPublish?: number } = {},
): { publish: boolean; reasons: string[]; advisory: string[]; rework: DeskResult["rework"] } {
  const minPublish = opts.minPublish ?? 1;
  const reasons: string[] = [];
  const advisory: string[] = [];
  const rework: DeskResult["rework"] = [];

  // Hanya kartu dengan temuan blocking (fakta salah / typo / terpotong) yang gugur.
  const usable = cards.filter((c) => c.blocking === 0 && c.editor_verdict !== "reject");

  for (const c of cards) {
    if (c.blocking > 0 || c.editor_verdict === "reject") {
      reasons.push(`${c.card_id} tidak terbit: ${c.blocking} temuan fakta/typo/terpotong`);
      rework.push({
        card_id: c.card_id,
        instruction: "Perbaiki fakta/typo/teks terpotong. Bila tidak bisa, gugurkan kartu ini.",
      });
    }
  }

  if (usable.length === 0) {
    reasons.push("tidak ada kartu yang lolos syarat fakta/typo/terpotong");
  } else if (usable.length < minPublish) {
    reasons.push(`hanya ${usable.length} kartu layak, minimum ${minPublish}`);
  }

  // Catatan editorial: tidak memblokir.
  for (const c of cards) {
    if (c.cited_paragraphs < c.paragraphs) {
      advisory.push(`${c.card_id} punya ${c.paragraphs - c.cited_paragraphs} paragraf tanpa sitasi`);
    }
    if (c.depth_check === "too_thin") {
      advisory.push(`${c.card_id} dinilai tipis untuk depth ${c.depth}`);
    }
  }

  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i]!;
      const b = cards[j]!;
      const sim = similarity(features(a.title), features(b.title));
      if (sim >= 0.55) {
        advisory.push(`${a.card_id} dan ${b.card_id} membahas sudut yang sama (${sim.toFixed(2)})`);
      }
    }
  }

  return { publish: usable.length >= minPublish, reasons, advisory, rework };
}

export async function reviewEdition(
  cards: DeskCard[],
  deps: { llm: LlmAdapter; model: string },
): Promise<{ desk: DeskResult; tokens_in: number; tokens_out: number; raw: unknown }> {
  const rule = deterministicDesk(cards);

  const system = [
    "Kamu redaktur pelaksana sebuah brief berbahasa Indonesia.",
    "Tugasmu menilai SATU SET edisi, bukan satu kartu. Kamu tidak boleh menambah kartu baru.",
    "Nilai: apakah set ini layak terbit hari ini? Apakah ada dua kartu yang sudutnya sama? Apakah ada janji tindak lanjut yang tidak ditepati?",
    "Jangan menilai gaya kalimat; itu sudah diperiksa editor kartu.",
    "Balas JSON: {\"publish\":true,\"reasons\":[\"\"],\"rework\":[{\"card_id\":\"c1\",\"instruction\":\"\"}]}",
  ].join("\n");

  const user = JSON.stringify(
    {
      temuan_aturan: rule,
      kartu: cards.map((c) => ({
        id: c.card_id,
        judul: c.title,
        sudut: c.angle,
        kategori: c.category,
        kedalaman: c.depth,
        karakter: c.body_chars,
        sitasi: `${c.cited_paragraphs}/${c.paragraphs}`,
        media: c.sources,
        vonis_editor: c.editor_verdict,
        temuan_blocking: c.blocking,
      })),
    },
    null,
    1,
  );

  try {
    const { data, usage } = await deps.llm.json<unknown>({
      model: deps.model,
      system,
      user,
      maxTokens: 1600,
      temperature: 0.1,
    });
    const o = data as Record<string, unknown>;
    const llmReasons = (Array.isArray(o.reasons) ? o.reasons : [])
      .map((r) => String(r).slice(0, 240))
      .filter(Boolean);
    const advisory = [
      ...rule.advisory,
      ...(o.publish === false ? llmReasons.map((r) => `desk: ${r}`) : []),
    ].slice(0, 12);

    // Newsworthiness bukan wewenang desk; publish ditentukan aturan.
    return {
      desk: { publish: rule.publish, reasons: rule.reasons, advisory, rework: rule.rework },
      tokens_in: usage.tokens_in,
      tokens_out: usage.tokens_out,
      raw: data,
    };
  } catch (e) {
    const why = e instanceof Error ? e.message.slice(0, 200) : String(e);
    console.log(`  ! desk gagal (${why}) — memakai gerbang deterministik`);
    return {
      desk: { publish: rule.publish, reasons: rule.reasons, advisory: rule.advisory, rework: rule.rework },
      tokens_in: 0,
      tokens_out: 0,
      raw: null,
    };
  }
}
