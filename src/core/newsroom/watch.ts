/**
 * Pantau pembaca (rencana 022, fase 3).
 *
 * Pembaca menitipkan pertanyaan; tiap pagi pipeline memeriksa apakah ada bahan
 * baru. Pemeriksaan itu **deterministik dan tanpa token**: hanya menghitung
 * artikel baru sejak `checked_at` yang cocok dengan pertanyaannya. Kalau tidak
 * ada, catatan tidak disentuh dan tidak ada panggilan model.
 *
 * Siklusnya sama dengan `gap_watch` (RANKING.md §6.5): menunggu → mulai
 * diliput → diliput → ditutup. Bedanya, di sini yang menulis barisnya manusia.
 */

import type { EditorNote } from "./notes.ts";
import { questionSimilarity } from "./notes.ts";

export type WatchState = "menunggu" | "mulai_diliput" | "diliput" | "ditutup";

export interface WatchRow {
  /** id baris `asks` di Supabase (mode = 'watch'). */
  id: string;
  question: string;
  topic_id: string | null;
  created_at: string;
  /** `menunggu` | `mulai_diliput` | `diliput` | `ditutup` (dari pipeline). */
  watch_state: string | null;
}

export interface WatchCandidate {
  url: string;
  title: string;
  lead: string | null;
  published_at: string | null;
}

const STOP = new Set([
  "yang", "untuk", "dari", "dengan", "pada", "dalam", "soal", "akan", "ini",
  "itu", "para", "usai", "atau", "juga", "disebut", "menjadi", "adalah",
  "apakah", "bagaimana", "kenapa", "mengapa", "kapan", "siapa", "berapa",
  "masih", "sudah", "belum", "tidak", "apa", "dan", "ada", "oleh", "kepada",
]);

function tokens(text: string): Set<string> {
  const raw = text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  return new Set(raw.filter((w) => !STOP.has(w)));
}

/**
 * Apakah ada bahan baru yang menyentuh pertanyaan ini?
 *
 * Ambang 2 token, sama seperti pengambilan bahan Tanya AI — satu kata yang
 * kebetulan muncul tidak cukup untuk membangunkan pembaca.
 */
export function hasNewMaterial(question: string, candidates: WatchCandidate[], minHits = 2): boolean {
  const want = tokens(question);
  if (want.size === 0) return false;
  const need = Math.min(minHits, want.size);
  for (const c of candidates) {
    const hay = `${c.title} ${c.lead ?? ""}`.toLowerCase();
    let hit = 0;
    for (const t of want) if (hay.includes(t)) hit += 1;
    if (hit >= need) return true;
  }
  return false;
}

/** Catatan ledger yang berasal dari pembaca. */
export function isReaderNote(note: EditorNote): boolean {
  return note.origin.code === "READER";
}

/**
 * Petakan catatan pembaca menjadi keadaan yang ditampilkan aplikasi.
 * `answered`/`resolved_by` menang atas apa pun: kalau kartunya sudah terbit,
 * tidak ada gunanya menyebut "menunggu".
 */
export function watchStateOf(note: EditorNote, hasMaterial: boolean): WatchState {
  if (note.status === "answered" && note.resolved_by) return "diliput";
  if (note.status === "dropped") return "ditutup";
  if (note.status === "waiting") return "menunggu";
  return hasMaterial ? "mulai_diliput" : "menunggu";
}

/**
 * Catatan pembaca yang pertanyaannya sudah dijawab draft lain tapi bukan
 * dirinya — dipakai untuk menutup pantau saat topiknya kebetulan sudah diliput.
 */
export function findDuplicate(note: EditorNote, ledger: EditorNote[]): EditorNote | null {
  for (const other of ledger) {
    if (other.id === note.id) continue;
    if (other.status !== "answered") continue;
    if (other.topic_id !== note.topic_id) continue;
    if (questionSimilarity(other.question, note.question) >= 0.5) return other;
  }
  return null;
}

/** Tautan kartu untuk ditampilkan di aplikasi: `edition_id` + judul kartu. */
export function cardRef(note: EditorNote): { edition_id: string; card_title: string } | null {
  if (!note.status || note.status !== "answered" || !note.resolved_by) return null;
  return {
    edition_id: note.resolved_by.edition_id,
    card_title: note.resolved_by.card_title,
  };
}
