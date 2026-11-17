#!/usr/bin/env node
/**
 * Pantau pembaca (rencana 022, fase 3).
 *
 *   sync    sebelum build: tarik `asks` mode='watch' dari Supabase ke ledger,
 *           lalu naikkan bobot catatan yang punya bahan baru. Tanpa token:
 *           pemeriksaan hanya SQL + pencocokan kata.
 *   report  sesudah build: kirim hasilnya kembali ke Supabase (keadaan + kartu
 *           yang menutupnya), supaya aplikasi bisa menampilkan tautan edisi.
 *
 * Keduanya fail-soft: Supabase yang tidak terjangkau tidak boleh menggagalkan
 * edisi. Bila `SUPABASE_SERVICE_KEY` kosong, langkah ini hanya dilewati.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "../src/config/env.ts";
import { openSqlite } from "../src/adapters/db/sqlite.ts";
import { loadLedger, persistLedger } from "../src/core/newsroom/store.ts";
import { mergeLedger, plannerNotes, type EditorNote } from "../src/core/newsroom/notes.ts";
import { hasNewMaterial, watchStateOf, type WatchCandidate, type WatchRow } from "../src/core/newsroom/watch.ts";

const root = new URL("..", import.meta.url).pathname;
loadEnvFile(join(root, ".env.local"));

const command = process.argv[2] ?? "sync";
const dbPath = process.env.DATABASE_PATH ?? join(root, "local.db");

const publicCfg = (() => {
  try {
    return JSON.parse(readFileSync(join(root, "public", "config.json"), "utf8")) as {
      supabaseUrl?: string;
      supabaseKey?: string;
    };
  } catch {
    return {};
  }
})();

const SUPABASE_URL = process.env.SUPABASE_URL ?? publicCfg.supabaseUrl;
const KEY = process.env.SUPABASE_SERVICE_KEY;

async function sb<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY as string,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`supabase ${res.status}: ${text.slice(0, 160)}`);
  return data as T;
}

/** Jendela pemeriksaan. Bisa diperlebar saat menguji dengan basis data lama. */
const WINDOW_HOURS = Number(process.env.WATCH_WINDOW_HOURS ?? 48);

function rowsSince(hours: number): WatchCandidate[] {
  const db = openSqlite(dbPath);
  try {
    return db.all<WatchCandidate>(
      `SELECT url, title_display AS title, lead, published_at
         FROM articles
        WHERE COALESCE(is_duplicate_of, '') = '' AND published_at >= ?
        ORDER BY published_at DESC LIMIT 400`,
      [new Date(Date.now() - hours * 3_600_000).toISOString()],
    );
  } finally {
    db.close();
  }
}

async function sync(): Promise<void> {
  if (!SUPABASE_URL || !KEY) {
    console.log("pantau: Supabase tidak dikonfigurasi — dilewati");
    return;
  }

  const asks = await sb<WatchRow[]>(
    "asks?mode=eq.watch&state=neq.failed&select=id,question,topic_id,created_at&order=created_at.asc&limit=50",
  );
  if (asks.length === 0) {
    console.log("pantau: belum ada pertanyaan pantau");
    return;
  }

  const db = openSqlite(dbPath);
  try {
    let ledger = loadLedger(db);
    const candidates = rowsSince(WINDOW_HOURS);
    const now = new Date();

    const incoming: EditorNote[] = asks.map((a) => ({
      id: `n_pantau_${a.id.replace(/-/g, "").slice(0, 12)}`,
      topic_id: a.topic_id ?? `watch_${a.id.slice(0, 8)}`,
      thread_title: a.question.slice(0, 80),
      kind: "coverage_gap",
      question: a.question,
      detail: "Pertanyaan pantau dari pembaca.",
      origin: { edition_id: a.created_at.slice(0, 10), card_title: a.question.slice(0, 80), code: "READER", paragraph: null },
      status: "open",
      first_seen: a.created_at,
      last_seen: a.created_at,
      attempts: 1,
      weight: 5,
      next_action: "Cari bahan baru untuk pertanyaan pembaca ini.",
      expires_at: new Date(Date.now() + 60 * 86_400_000).toISOString(),
      resolved_by: null,
      source: "reader",
      source_ref: a.id,
      checked_at: now.toISOString(),
    }));

    const merged = mergeLedger(ledger, incoming, now);
    ledger = merged.ledger;

    // Naikkan bobot hanya bila ada bahan baru — itulah satu-satunya sinyal yang
    // boleh membangunkan pembaca, dan ia dihitung tanpa model.
    let woke = 0;
    for (const note of ledger.notes) {
      if (note.source !== "reader") continue;
      if (note.status !== "open" && note.status !== "waiting") continue;
      if (hasNewMaterial(note.question, candidates)) {
        note.weight = Math.max(note.weight, 7);
        if (note.status === "waiting") note.status = "open";
        woke += 1;
      }
      note.checked_at = now.toISOString();
    }

    persistLedger(db, ledger, now);
    console.log(
      `pantau: ${asks.length} baris · ${merged.added.length} baru · ${woke} punya bahan baru · ` +
        `${plannerNotes(ledger, now).length} ditawarkan ke planner`,
    );
  } finally {
    db.close();
  }
}

/** Kolom watch_state/edition_id baru ada setelah supabase/003_watch.sql dijalankan. */
async function hasWatchColumns(): Promise<boolean> {
  try {
    await sb("asks?select=watch_state&limit=1");
    return true;
  } catch {
    return false;
  }
}

async function report(): Promise<void> {
  if (!SUPABASE_URL || !KEY) return;

  const withColumns = await hasWatchColumns();
  if (!withColumns) {
    console.log("pantau: kolom watch_state/edition_id belum ada — jalankan supabase/003_watch.sql; laporan dilewati");
    return;
  }

  const db = openSqlite(dbPath);
  try {
    const ledger = loadLedger(db);
    const reader = ledger.notes.filter((n) => n.source === "reader" && n.source_ref);
    if (reader.length === 0) return;

    const candidates = rowsSince(WINDOW_HOURS);
    let sent = 0;

    for (const note of reader) {
      const hasMaterial = hasNewMaterial(note.question, candidates);
      const watch_state = watchStateOf(note, hasMaterial);
      const edition = note.status === "answered" && note.resolved_by ? note.resolved_by.edition_id : null;
      const cardTitle = note.status === "answered" && note.resolved_by ? note.resolved_by.card_title : null;

      await sb(`asks?id=eq.${encodeURIComponent(note.source_ref as string)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          watch_state,
          edition_id: edition,
          error: cardTitle,
          answer_id: edition,
        }),
      }).catch(() => null);
      sent += 1;
    }

    console.log(`pantau: ${sent} baris diperbarui di Supabase`);
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  if (command === "report") await report();
  else await sync();
}

main().catch((e) => {
  // Fail-soft: pantau tidak boleh menggagalkan edisi.
  console.log(`pantau: dilewati (${e instanceof Error ? e.message : String(e)})`);
});
