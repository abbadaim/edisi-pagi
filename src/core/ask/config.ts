/**
 * Setelan Tanya AI (rencana 022, `DEC-0036`).
 *
 * Dua lapis, dan lapis atas tidak boleh mengalahkan lapis bawah di tempat yang
 * berbahaya:
 *
 *   config/tanya.json   lantai. Berisi prompt dan teks penolakan.
 *   settings (Supabase) knob terstruktur: model, mode, bentuk, cari.
 *
 * Aplikasi hanya boleh mengubah knob. Prompt dan `tolak` selalu dari git:
 * prompt adalah tempat aturan "sitasi atau turun" ditegakkan, dan teks itu
 * tidak boleh bisa disunting dari ponsel tanpa diff.
 *
 * Modul ini murni — tanpa `fs`, tanpa jaringan (INFRA.md §8).
 */

import { createHash } from "node:crypto";

export type AnswerMode = "ringkas" | "latar" | "lacak";

export const ANSWER_MODES: AnswerMode[] = ["ringkas", "latar", "lacak"];

export interface AskConfig {
  schema_version: 1;
  model: { bawaan: string; uji: string[] };
  mode: AnswerMode;
  bentuk: { max_kata: number; max_paragraf: number; sitasi: "url" | "inline" };
  cari: { enabled: boolean; max_fetch: number; izin_luar_bahan: boolean };
  /** Selalu dari git. Tidak pernah dari klien. */
  tolak: string;
  /** Selalu dari git. Tidak pernah dari klien. */
  prompt: string;
}

/** Knob yang boleh datang dari `settings`. Sisanya diabaikan, bukan digabung. */
const KNOBS = ["model", "mode", "bentuk", "cari"] as const;

const MAX_KATA = { min: 60, max: 600 };
const MAX_PARAGRAF = { min: 1, max: 10 };
const MAX_FETCH = { min: 0, max: 8 };

function num(v: unknown, fallback: number, range: { min: number; max: number }): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(n)));
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** Parse `config/tanya.json`. Nilai rusak jatuh ke bawaan keras, bukan melempar. */
export function parseAskConfig(json: string): AskConfig {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const model = (raw.model ?? {}) as Record<string, unknown>;
  const bentuk = (raw.bentuk ?? {}) as Record<string, unknown>;
  const cari = (raw.cari ?? {}) as Record<string, unknown>;
  const mode = str(raw.mode, "ringkas");

  return {
    schema_version: 1,
    model: {
      bawaan: str(model.bawaan, "opencode/deepseek-v4.1-flash-free#low"),
      uji: Array.isArray(model.uji) ? model.uji.filter((m): m is string => typeof m === "string") : [],
    },
    mode: (ANSWER_MODES as string[]).includes(mode) ? (mode as AnswerMode) : "ringkas",
    bentuk: {
      max_kata: num(bentuk.max_kata, 180, MAX_KATA),
      max_paragraf: num(bentuk.max_paragraf, 4, MAX_PARAGRAF),
      sitasi: bentuk.sitasi === "inline" ? "inline" : "url",
    },
    cari: {
      enabled: bool(cari.enabled, true),
      max_fetch: num(cari.max_fetch, 3, MAX_FETCH),
      izin_luar_bahan: bool(cari.izin_luar_bahan, false),
    },
    tolak: str(raw.tolak, "Belum ada bahan yang cukup untuk menjawab ini."),
    prompt: str(raw.prompt, ""),
  };
}

/**
 * Model yang diminta klien hanya diterima bila ada di `uji` (atau sama dengan
 * `bawaan`). Selain itu dijepit — bukan ditolak dengan galat, karena menjepit
 * membuat jawaban tetap jalan sementara penyalahgunaan tidak menghasilkan apa
 * pun yang mahal.
 */
export function clampModel(base: AskConfig, requested: unknown): string {
  if (typeof requested !== "string") return base.model.bawaan;
  const want = requested.trim();
  if (!want) return base.model.bawaan;
  if (want === base.model.bawaan) return want;
  return base.model.uji.includes(want) ? want : base.model.bawaan;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Gabungkan knob dari `settings` ke atas lantai. Hanya `KNOBS` yang dibaca:
 * `prompt`, `tolak`, dan `schema_version` tidak pernah bisa ditimpa klien.
 */
export function mergeAskConfig(base: AskConfig, remote: unknown): AskConfig {
  if (!isPlainObject(remote)) return base;
  const knob = Object.fromEntries(KNOBS.filter((k) => k in remote).map((k) => [k, remote[k]]));
  if (Object.keys(knob).length === 0) return base;

  // Model dijepit di sini, bukan di pemanggil: satu tempat untuk satu aturan.
  const model = isPlainObject(knob.model) ? knob.model : {};
  const merged: AskConfig = {
    ...base,
    model: { ...base.model, bawaan: clampModel(base, model.bawaan) },
    mode: (ANSWER_MODES as string[]).includes(str(knob.mode, "")) ? (str(knob.mode, "") as AnswerMode) : base.mode,
    bentuk: {
      max_kata: num((knob.bentuk as Record<string, unknown>)?.max_kata, base.bentuk.max_kata, MAX_KATA),
      max_paragraf: num(
        (knob.bentuk as Record<string, unknown>)?.max_paragraf,
        base.bentuk.max_paragraf,
        MAX_PARAGRAF,
      ),
      sitasi: (knob.bentuk as Record<string, unknown>)?.sitasi === "inline" ? "inline" : base.bentuk.sitasi,
    },
    cari: {
      enabled: bool((knob.cari as Record<string, unknown>)?.enabled, base.cari.enabled),
      max_fetch: num((knob.cari as Record<string, unknown>)?.max_fetch, base.cari.max_fetch, MAX_FETCH),
      izin_luar_bahan: bool((knob.cari as Record<string, unknown>)?.izin_luar_bahan, base.cari.izin_luar_bahan),
    },
    // prompt + tolak sengaja TIDAK dibaca dari `remote`.
    tolak: base.tolak,
    prompt: base.prompt,
  };
  return merged;
}

/**
 * Sidik setelan efektif. Disimpan di tiap jawaban supaya bisa dilihat jawaban
 * mana yang lahir dari setelan mana — tanpa ini, "kok jawabannya beda" tidak
 * bisa dijawab.
 */
export function configHash(cfg: AskConfig): string {
  const material = JSON.stringify({
    model: cfg.model.bawaan,
    mode: cfg.mode,
    bentuk: cfg.bentuk,
    cari: cfg.cari,
    tolak: cfg.tolak,
    prompt: cfg.prompt,
  });
  return createHash("sha1").update(material).digest("hex").slice(0, 12);
}

/** Sidik prompt saja, untuk memisahkan perubahan aturan dari perubahan model. */
export function promptHash(cfg: AskConfig): string {
  return createHash("sha1").update(cfg.prompt).digest("hex").slice(0, 12);
}
