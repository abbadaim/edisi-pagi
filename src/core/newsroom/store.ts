/**
 * Penyimpanan ledger catatan editor di SQLite (NEWSROOM.md §4.6, §7).
 * Aturan dedupe/lifecycle tetap di `notes.ts`; modul ini hanya memetakan baris.
 */

import type { Db } from "../../adapters/db/sqlite.ts";
import type { EditorNote, NoteKind, NoteLedger, NoteStatus } from "./notes.ts";

interface NoteRow {
  id: string;
  topic_id: string;
  kind: string;
  question: string;
  detail: string;
  origin_json: string;
  status: string;
  first_seen: string;
  last_seen: string;
  attempts: number;
  weight: number;
  next_action: string;
  expires_at: string;
  resolved_json: string | null;
}

function parse<T>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export function loadLedger(db: Db, now = new Date()): NoteLedger {
  const rows = db.all<NoteRow>(
    `SELECT id, topic_id, kind, question, detail, origin_json, status, first_seen,
            last_seen, attempts, weight, next_action, expires_at, resolved_json
       FROM editor_notes`,
  );

  const notes: EditorNote[] = rows.map((r) => ({
    id: r.id,
    topic_id: r.topic_id,
    thread_title: (parse<{ thread_title?: string }>(r.origin_json)?.thread_title ?? r.topic_id),
    kind: r.kind as NoteKind,
    question: r.question,
    detail: r.detail,
    origin: parse<EditorNote["origin"]>(r.origin_json) ?? {
      edition_id: r.first_seen.slice(0, 10),
      card_title: r.topic_id,
      code: "E-DEPTH",
      paragraph: null,
    },
    status: r.status as NoteStatus,
    first_seen: r.first_seen,
    last_seen: r.last_seen,
    attempts: r.attempts,
    weight: r.weight,
    next_action: r.next_action,
    expires_at: r.expires_at,
    resolved_by: parse<EditorNote["resolved_by"]>(r.resolved_json),
  }));

  return { schema_version: 1, updated_at: now.toISOString(), notes };
}

export function persistLedger(db: Db, ledger: NoteLedger, now = new Date()): void {
  for (const n of ledger.notes) {
    db.run(
      `INSERT INTO editor_notes
         (id, topic_id, kind, question, detail, origin_json, status, first_seen,
          last_seen, attempts, weight, next_action, expires_at, resolved_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         topic_id = excluded.topic_id,
         kind = excluded.kind,
         question = excluded.question,
         detail = excluded.detail,
         origin_json = excluded.origin_json,
         status = excluded.status,
         last_seen = excluded.last_seen,
         attempts = excluded.attempts,
         weight = excluded.weight,
         next_action = excluded.next_action,
         expires_at = excluded.expires_at,
         resolved_json = excluded.resolved_json`,
      [
        n.id,
        n.topic_id,
        n.kind,
        n.question,
        n.detail,
        JSON.stringify({ ...n.origin, thread_title: n.thread_title }),
        n.status,
        n.first_seen,
        n.last_seen,
        n.attempts,
        n.weight,
        n.next_action,
        n.expires_at,
        n.resolved_by ? JSON.stringify(n.resolved_by) : null,
      ],
    );
  }
  // `last_seen` hanya berubah lewat mergeLedger, bukan setiap kali disimpan.
}
