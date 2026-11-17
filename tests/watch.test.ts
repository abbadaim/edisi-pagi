/**
 * Rencana 022 fase 3: pantau pembaca.
 *
 * Yang dikunci: pembangunan pembaca hanya boleh terjadi karena bahan baru, dan
 * keadaan yang ditampilkan mengikuti siklus `gap_watch`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  cardRef,
  findDuplicate,
  hasNewMaterial,
  watchStateOf,
  type WatchCandidate,
} from "../src/core/newsroom/watch.ts";
import type { EditorNote } from "../src/core/newsroom/notes.ts";

function note(over: Partial<EditorNote> = {}): EditorNote {
  return {
    id: "n1",
    topic_id: "t1",
    thread_title: "PBI BPJS Sleman",
    kind: "coverage_gap",
    question: "Kenapa PBI BPJS warga Sleman dinonaktifkan?",
    detail: "",
    origin: { edition_id: "2026-11-17", card_title: "PBI", code: "READER", paragraph: null },
    status: "open",
    first_seen: "2026-11-17T00:00:00Z",
    last_seen: "2026-11-17T00:00:00Z",
    attempts: 1,
    weight: 5,
    next_action: "",
    expires_at: "2027-01-17T00:00:00Z",
    resolved_by: null,
    source: "reader",
    source_ref: "ask-1",
    checked_at: null,
    ...over,
  };
}

const cand = (title: string, lead = ""): WatchCandidate => ({
  url: `https://x/${encodeURIComponent(title)}`,
  title,
  lead,
  published_at: "2026-11-17T00:00:00Z",
});

test("bahan baru butuh dua kata yang cocok, bukan satu", () => {
  const q = "Kenapa PBI BPJS warga Sleman dinonaktifkan?";
  assert.equal(hasNewMaterial(q, [cand("Cuaca Sleman cerah")]), false, "satu kata tidak cukup");
  assert.equal(hasNewMaterial(q, [cand("BPJS PBI Sleman dinonaktifkan")]), true);
  assert.equal(hasNewMaterial(q, [cand("Lain", "PBI BPJS di Sleman disiapkan reaktivasi")]), true);
});

test("pertanyaan tanpa kata bermakna tidak membangunkan apa pun", () => {
  assert.equal(hasNewMaterial("apa itu", [cand("apa itu")]), false);
});

test("keadaan pantau mengikuti siklus gap_watch", () => {
  assert.equal(watchStateOf(note(), false), "menunggu");
  assert.equal(watchStateOf(note(), true), "mulai_diliput");
  assert.equal(watchStateOf(note({ status: "waiting" }), true), "menunggu");
  assert.equal(watchStateOf(note({ status: "dropped" }), false), "ditutup");
  assert.equal(
    watchStateOf(
      note({
        status: "answered",
        resolved_by: { edition_id: "2026-11-18", card_title: "PBI BPJS dinonaktifkan" },
      }),
      true,
    ),
    "diliput",
  );
});

test("tautan kartu hanya ada bila catatan benar-benar ditutup kartu", () => {
  assert.equal(cardRef(note()), null);
  const closed = cardRef(
    note({ status: "answered", resolved_by: { edition_id: "2026-11-18", card_title: "PBI" } }),
  );
  assert.deepEqual(closed, { edition_id: "2026-11-18", card_title: "PBI" });
});

test("pantau yang sudah dijawab catatan lain ditutup, bukan diulang", () => {
  const mine = note();
  const other = note({
    id: "n2",
    status: "answered",
    question: "Kenapa PBI BPJS warga Sleman dinonaktifkan?",
    resolved_by: { edition_id: "2026-11-18", card_title: "PBI" },
  });
  assert.equal(findDuplicate(mine, [mine, other])?.id, "n2");
  assert.equal(findDuplicate(mine, [mine]), null);
});
