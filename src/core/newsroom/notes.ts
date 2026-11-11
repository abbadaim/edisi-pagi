/**
 * Catatan editor sebagai utang liputan (NEWSROOM.md §4.6).
 *
 * Temuan editor yang bukan cacat tulisan — pertanyaan yang tidak dijawab bahan,
 * klaim yang belum terverifikasi, risiko hukum — disimpan sebagai catatan.
 * Catatan hidup di luar `edition.json` (edisi tetap immutable) dan dibaca
 * planner pada hari berikutnya sebagai kandidat tindak lanjut.
 */

import { createHash } from "node:crypto";
import { slugify } from "../registry.ts";
import type { Assignment, Draft, EditResult, Finding } from "./contracts.ts";

export type NoteKind = "coverage_gap" | "verification_gap" | "risk";
export type NoteStatus = "open" | "waiting" | "answered" | "dropped";

export interface EditorNote {
  id: string;
  topic_id: string;
  thread_title: string;
  kind: NoteKind;
  /** Pertanyaan yang belum terjawab, atau klaim yang belum terverifikasi. */
  question: string;
  /** Penjelasan editor, sudah dibersihkan dari id bahan. */
  detail: string;
  origin: {
    edition_id: string;
    card_title: string;
    code: string;
    paragraph: number | null;
  };
  status: NoteStatus;
  first_seen: string;
  last_seen: string;
  /** Berapa kali topik ini ditulis tanpa menutup catatan. */
  attempts: number;
  weight: number;
  next_action: string;
  expires_at: string;
  resolved_by: { edition_id: string; card_title: string; url?: string; quote?: string } | null;
}

export interface NoteLedger {
  schema_version: 1;
  updated_at: string;
  notes: EditorNote[];
}

export interface NoteExtractionInput {
  editionId: string;
  topicId: string;
  threadTitle: string;
  assignment: Assignment;
  draft: Draft;
  edit: EditResult;
  now: Date;
}

const TTL_DAYS: Record<NoteKind, number> = {
  coverage_gap: 45,
  verification_gap: 21,
  risk: 30,
};

const WEIGHT: Record<NoteKind, number> = {
  coverage_gap: 3,
  verification_gap: 2,
  risk: 3,
};

const MAX_PER_CARD = 5;

/**
 * Batas internal, bukan batas tampilan. Catatan disimpan utuh di SQLite;
 * pemendekan hanya boleh terjadi saat dirender ke publik (`unresolved`,
 * `disclaimer`, yang memang dibatasi skema).
 */
const MAX_QUESTION = 1200;
const MAX_DETAIL = 8000;
const MAX_ACTION = 1200;

export function emptyLedger(now = new Date()): NoteLedger {
  return { schema_version: 1, updated_at: now.toISOString(), notes: [] };
}

/** Id bahan tidak boleh masuk catatan yang dibaca manusia. */
function clean(s: string, max = MAX_DETAIL): string {
  return s
    .replace(/\b[swg]\d+\b/gi, "bahan")
    .replace(/\(bahan(?:,\s*bahan)*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, max);
}

function firstSentence(s: string, max = 400): string {
  const t = s.trim();
  const cut = t.search(/[.!?]\s/);
  const one = cut > 20 ? t.slice(0, cut + 1) : t;
  return one.slice(0, max);
}

function iso(now: Date): string {
  return now.toISOString();
}

function expires(now: Date, kind: NoteKind): string {
  return new Date(now.getTime() + TTL_DAYS[kind] * 86_400_000).toISOString();
}

function noteId(topicId: string, question: string): string {
  const h = createHash("sha1").update(`${topicId}|${question.toLowerCase()}`).digest("hex").slice(0, 8);
  return `n_${slugify(topicId).slice(0, 28)}_${h}`;
}

/**
 * Ubah hasil edit menjadi catatan. Hanya hal yang tidak bisa diperbaiki
 * dengan menulis ulang: pertanyaan tanpa bahan, klaim tanpa sumber,
 * dan risiko hukum. Cacat gaya/koherensi tidak masuk backlog.
 */
export function notesFromEdit(input: NoteExtractionInput): EditorNote[] {
  const { editionId, topicId, threadTitle, assignment, draft, edit, now } = input;
  const out: EditorNote[] = [];
  const seen = new Set<string>();

  const push = (
    kind: NoteKind,
    question: string,
    detail: string,
    code: string,
    paragraph: number | null,
    nextAction: string,
  ) => {
    const q = clean(question, MAX_QUESTION);
    if (q.length < 8) return;
    const id = noteId(topicId, q);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      topic_id: topicId,
      thread_title: threadTitle,
      kind,
      question: q,
      detail: clean(detail, MAX_DETAIL),
      origin: { edition_id: editionId, card_title: draft.title, code, paragraph },
      status: "open",
      first_seen: iso(now),
      last_seen: iso(now),
      attempts: 1,
      weight: WEIGHT[kind],
      next_action: clean(nextAction, MAX_ACTION) || "Cari bahan tambahan sebelum menulis ulang.",
      expires_at: expires(now, kind),
      resolved_by: null,
    });
  };

  // 1. Pertanyaan wajib yang tidak terjawab bahan → celah liputan.
  const depthFinding = edit.findings.find((f) => f.code === "E-DEPTH");
  for (const idx of edit.answers_missing) {
    const q = assignment.answers[idx];
    if (!q) continue;
    push(
      "coverage_gap",
      q,
      depthFinding?.issue ?? "Bahan yang tersedia belum menjawab pertanyaan ini.",
      "E-DEPTH",
      depthFinding?.paragraph ?? null,
      "Cari sumber primer atau data resmi; bila tidak ada, nyatakan terbuka di artikel.",
    );
  }

  // 2. Klaim/atribusi yang belum terverifikasi → utang verifikasi.
  // Severity tidak lagi menentukan: temuan advisory tetap utang verifikasi.
  for (const f of edit.findings) {
    // Fakta salah yang memblokir bukan backlog; konflik sumber yang advisory adalah backlog.
    if (f.code === "E-FACT" && f.severity === "blocking") continue;
    if (!["E-FACT", "E-SRC", "E-ATTR", "E-CAUS"].includes(f.code)) continue;

    // Perbaikan yang murni menyunting prosa bukan utang liputan.
    if (/hapus frasa|hapus kata|cukup andalkan|entri citations|gunakan citations|jangan sebut/i.test(f.fix)) {
      continue;
    }

    const paragraphText = f.paragraph !== null ? (draft.body[f.paragraph] ?? "") : "";
    let claim = (f.quote || "").trim();
    if (claim.length < 24) claim = firstSentence(paragraphText);
    if (claim.length < 24) claim = f.issue;
    if (claim.length < 24) continue;

    push(
      "verification_gap",
      `Verifikasi: ${claim}`,
      f.issue,
      f.code,
      f.paragraph,
      f.fix || "Cocokkan klaim dengan sumber primer sebelum dipakai lagi.",
    );
  }

  // 3. Risiko hukum / pencemaran nama baik → catatan, bukan ide artikel.
  for (const f of edit.findings) {
    if (f.code !== "E-SAFE") continue;
    push("risk", f.quote || f.issue, f.issue, f.code, f.paragraph, f.fix || "Konsultasikan sebelum menyebut nama.");
  }

  return out.slice(0, MAX_PER_CARD);
}

function tokens(s: string): Set<string> {
  return new Set(
    (s.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((w) => !["bahan", "dengan", "untuk", "tidak"].includes(w)),
  );
}

const THREAD_STOP = new Set([
  "dan", "yang", "untuk", "dari", "dengan", "pada", "dalam", "soal", "akan",
  "ini", "itu", "para", "usai", "atau", "juga", "disebut", "menjadi",
]);

function threadTokens(s: string): Set<string> {
  return new Set(
    (s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !THREAD_STOP.has(w)),
  );
}

/** Cocokkan judul thread yang berubah antar hari (mis. "DPR pakai hak…" vs "Delapan Fraksi DPR…"). */
export function threadMatch(a: string, b: string, min = 0.4): boolean {
  const A = threadTokens(a);
  const B = threadTokens(b);
  if (A.size === 0 || B.size === 0) return false;
  let hit = 0;
  for (const x of A) if (B.has(x)) hit++;
  return hit / Math.min(A.size, B.size) >= min;
}

/** Kecocokan pertanyaan lintas hari. Jaccard cukup stabil untuk kalimat pendek. */
export function questionSimilarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let hit = 0;
  for (const x of A) if (B.has(x)) hit++;
  return hit / (A.size + B.size - hit);
}

export interface MergeResult {
  ledger: NoteLedger;
  added: EditorNote[];
  updated: EditorNote[];
}

/** Gabung catatan baru ke ledger. Pertanyaan yang sama tidak menjadi duplikat. */
export function mergeLedger(ledger: NoteLedger, incoming: EditorNote[], now = new Date()): MergeResult {
  const notes = ledger.notes.map((n) => ({ ...n }));
  const added: EditorNote[] = [];
  const updated: EditorNote[] = [];
  const nowIso = iso(now);

  for (const note of incoming) {
    if (note.status === "answered" || note.status === "dropped") continue;

    const match = notes.find(
      (n) =>
        n.topic_id === note.topic_id &&
        n.kind === note.kind &&
        (n.status === "open" || n.status === "waiting") &&
        questionSimilarity(n.question, note.question) >= 0.55,
    );

    if (match) {
      match.last_seen = nowIso;
      match.attempts += 1;
      match.weight = Math.max(match.weight, note.weight);
      match.next_action = note.next_action;
      if (note.detail.length > match.detail.length) match.detail = note.detail;
      updated.push(match);
    } else {
      notes.push(note);
      added.push(note);
    }
  }

  return {
    ledger: { schema_version: 1, updated_at: nowIso, notes },
    added,
    updated,
  };
}

export function isExpired(note: EditorNote, now = new Date()): boolean {
  return Date.parse(note.expires_at) < now.getTime();
}

/** Catatan yang masih layak dikerjakan. */
export function openNotes(
  ledger: NoteLedger,
  now = new Date(),
  opts: { kind?: NoteKind; limit?: number } = {},
): EditorNote[] {
  const limit = opts.limit ?? 50;
  return ledger.notes
    .filter((n) => (n.status === "open" || n.status === "waiting") && !isExpired(n, now))
    .filter((n) => (opts.kind ? n.kind === opts.kind : true))
    .sort((a, b) => b.weight - a.weight || Date.parse(b.last_seen) - Date.parse(a.last_seen))
    .slice(0, limit);
}

/** Bentuk ringkas untuk prompt planner. `risk` tidak dijadikan ide artikel. */
export function plannerNotes(
  ledger: NoteLedger,
  now = new Date(),
  limit = 12,
): Array<{ id: string; topik: string; jenis: NoteKind; pertanyaan: string; umur_hari: number; percobaan: number; tindakan: string }> {
  return openNotes(ledger, now, { limit: limit * 2 })
    .filter((n) => n.kind !== "risk" && n.status === "open")
    .slice(0, limit)
    .map((n) => ({
      id: n.id,
      topik: n.thread_title,
      jenis: n.kind,
      pertanyaan: n.question,
      umur_hari: Math.max(0, Math.round((now.getTime() - Date.parse(n.first_seen)) / 86_400_000)),
      percobaan: n.attempts,
      tindakan: n.next_action,
    }));
}

/** Tandai catatan yang benar-benar dijawab draft baru. */
export function markAnswered(
  ledger: NoteLedger,
  resolved: Array<{ id: string; quote: string }>,
  by: { edition_id: string; card_title: string; url?: string },
  now = new Date(),
): NoteLedger {
  const byId = new Map(resolved.map((r) => [r.id, r.quote]));
  return {
    schema_version: 1,
    updated_at: iso(now),
    notes: ledger.notes.map((n) =>
      byId.has(n.id) && (n.status === "open" || n.status === "waiting")
        ? {
            ...n,
            status: "answered" as const,
            resolved_by: { ...by, quote: byId.get(n.id) },
            last_seen: iso(now),
          }
        : n,
    ),
  };
}

/** Catatan lama tanpa perkembangan menjadi `waiting`, bukan terus diulang. */
export function ageNotes(ledger: NoteLedger, now = new Date(), waitAfterDays = 14): NoteLedger {
  return {
    ...ledger,
    updated_at: iso(now),
    notes: ledger.notes.map((n) => {
      if (n.status !== "open") return n;
      const age = (now.getTime() - Date.parse(n.first_seen)) / 86_400_000;
      return age >= waitAfterDays ? { ...n, status: "waiting" as const } : n;
    }),
  };
}

export function noteSummary(ledger: NoteLedger, now = new Date()): {
  open: number;
  waiting: number;
  answered: number;
  expired: number;
} {
  const active = ledger.notes.filter((n) => n.status === "open" || n.status === "waiting");
  return {
    open: active.filter((n) => n.status === "open").length,
    waiting: active.filter((n) => n.status === "waiting").length,
    answered: ledger.notes.filter((n) => n.status === "answered").length,
    expired: active.filter((n) => isExpired(n, now)).length,
  };
}
