import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ageNotes,
  emptyLedger,
  markAnswered,
  mergeLedger,
  noteSummary,
  notesFromEdit,
  openNotes,
  plannerNotes,
  questionSimilarity,
} from "../src/core/newsroom/notes.ts";
import type { Assignment, Draft, EditResult } from "../src/core/newsroom/contracts.ts";

const now = new Date("2026-11-10T20:00:00+07:00");

const assignment: Assignment = {
  cids: ["c01"],
  title: "KPK periksa kepala pertanahan",
  angle: "Dugaan setoran",
  category: "policy",
  significance: 4,
  heavy: false,
  depth: "standard",
  why_now: "Pemeriksaan hari ini",
  answers: [
    "Siapa saja yang diperiksa KPK",
    "Berapa nilai setoran yang diduga",
    "Apa bantahan pihak yang disebut",
  ],
  note_ids: [],
  drop: false,
  reason: null,
};

const draft: Draft = {
  title: "KPK periksa sembilan kepala kantor pertanahan",
  angle: "Dugaan setoran",
  dek: "",
  body: [
    "KPK memeriksa sembilan kepala kantor pertanahan pada Selasa (10/11).",
    "Penyidik menduga ada setoran Rp2,3 miliar.",
    "Belum ada bantahan resmi.",
  ],
  citations: [
    { paragraph: 0, sources: ["s1"] },
    { paragraph: 1, sources: ["s2"] },
    { paragraph: 2, sources: ["s1"] },
  ],
  action: "Tunggu keterangan resmi.",
  claim: "KPK memeriksa sembilan kepala kantor pertanahan",
  explain: [
    { q: "Apa itu KPK?", a: "Lembaga pemberantasan korupsi.", source: { outlet: "KPK", url: "https://kpk.go.id/" } },
    { q: "Apa itu setoran?", a: "Pembayaran tidak resmi kepada pejabat.", source: { outlet: "KPK", url: "https://kpk.go.id/" } },
  ],
  depth_achieved: "standard",
  depth_change: null,
  needs: [],
};

const edit: EditResult = {
  verdict: "revise",
  findings: [
    { code: "E-TONE", severity: "advisory", paragraph: 0, quote: "", issue: "judul terlalu kuat", fix: "lunakkan" },
    {
      code: "E-SRC",
      severity: "blocking",
      paragraph: 1,
      quote: "Penyidik menduga ada setoran Rp2,3 miliar",
      issue: "Angka setoran hanya ada di satu media dan belum dikonfirmasi",
      fix: "Cari rilis resmi KPK",
    },
  ],
  answers_covered: [0],
  answers_missing: [1, 2],
  depth_check: "standard",
  category_check: null,
  notes_resolved: [],
};

const input = {
  editionId: "2026-11-10",
  topicId: "t_kpk_pertanahan",
  threadTitle: "KPK periksa kepala pertanahan",
  assignment,
  draft,
  edit,
  now,
};

test("notesFromEdit hanya mengambil celah bahan dan verifikasi", () => {
  const notes = notesFromEdit(input);
  assert.equal(notes.filter((n) => n.kind === "coverage_gap").length, 2);
  assert.equal(notes.filter((n) => n.kind === "verification_gap").length, 1);
  assert.equal(notes.some((n) => n.question.includes("judul terlalu kuat")), false, "cacat gaya tidak masuk backlog");
  assert.ok(notes.every((n) => n.status === "open"));
  assert.ok(notes.every((n) => n.id.startsWith("n_")));
});

test("pertanyaan yang sama lintas hari digabung, bukan diduplikasi", () => {
  const first = notesFromEdit(input);
  let ledger = mergeLedger(emptyLedger(now), first, now).ledger;

  const later = notesFromEdit({
    ...input,
    editionId: "2026-11-11",
    now: new Date("2026-11-11T20:00:00+07:00"),
    assignment: { ...assignment, answers: ["Siapa saja yang diperiksa KPK", "Berapa nilai setoran yang diduga diterima", "Apa bantahan pihak yang disebut"] },
  });

  const merged = mergeLedger(ledger, later, new Date("2026-11-11T20:00:00+07:00"));
  ledger = merged.ledger;

  const gaps = ledger.notes.filter((n) => n.kind === "coverage_gap");
  assert.equal(gaps.length, 2, "tiga pertanyaan menjadi dua catatan karena satu sama");
  const similar = gaps.find((n) => n.question.toLowerCase().includes("setoran"));
  assert.ok(similar);
  assert.equal(similar!.attempts, 2);
  assert.equal(similar!.last_seen.slice(0, 10), "2026-11-11");
});

test("openNotes menyembunyikan answered, expired, dan mengurutkan bobot", () => {
  const notes = notesFromEdit(input);
  let ledger = mergeLedger(emptyLedger(now), notes, now).ledger;

  const firstId = ledger.notes[0]!.id;
  ledger = markAnswered(ledger, [{ id: firstId, quote: "KPK memeriksa sembilan kepala kantor pertanahan." }], { edition_id: "2026-11-11", card_title: "KPK" }, now);

  const open = openNotes(ledger, now);
  assert.equal(open.some((n) => n.id === firstId), false);

  const expired = { ...ledger.notes[1]!, id: "n_expired_test", expires_at: "2026-01-01T00:00:00Z" };
  const withExpired = { ...ledger, notes: [...ledger.notes, expired] };
  assert.equal(openNotes(withExpired, now).some((n) => n.id === expired.id), false);
});

test("catatan internal tidak dipotong pada batas tampilan", () => {
  const longIssue = "Klaim ini belum didukung sumber primer dan masih perlu dikonfirmasi. ".repeat(12);
  const notes = notesFromEdit({
    ...input,
    edit: {
      ...edit,
      findings: [
        {
          code: "E-SRC",
          severity: "advisory",
          paragraph: 1,
          quote: "Penyidik menduga ada setoran yang nilainya belum dirilis secara resmi oleh lembaga.",
          issue: longIssue,
          fix: "Cocokkan dengan rilis resmi dan putusan pengadilan.",
        },
      ],
    },
  });
  const verification = notes.find((n) => n.kind === "verification_gap");
  assert.ok(verification);
  assert.ok(verification!.detail.length > 600, "detail catatan harus utuh, bukan 300 karakter");
  assert.ok(verification!.question.length > 60);
});

test("plannerNotes tidak menawarkan catatan risiko sebagai ide artikel", () => {
  const risk = notesFromEdit({
    ...input,
    assignment: { ...assignment, answers: [] },
    edit: {
      ...edit,
      answers_missing: [],
      findings: [{ code: "E-SAFE", severity: "blocking", paragraph: 0, quote: "Nama tersangka", issue: "Risiko pencemaran nama baik", fix: "Anonimkan" }],
    },
  });
  const ledger = mergeLedger(emptyLedger(now), risk, now).ledger;
  assert.equal(plannerNotes(ledger, now).length, 0);
  assert.equal(openNotes(ledger, now).length, 1);
});

test("plannerNotes tidak menawarkan catatan waiting", () => {
  const ledger = mergeLedger(emptyLedger(now), notesFromEdit(input), now).ledger;
  const waiting = { ...ledger, notes: ledger.notes.map((n) => ({ ...n, status: "waiting" as const })) };
  assert.equal(plannerNotes(waiting, now).length, 0);
});

test("catatan lama berpindah ke waiting, bukan terus diulang", () => {
  const ledger = mergeLedger(emptyLedger(now), notesFromEdit(input), now).ledger;
  const later = new Date("2026-12-01T00:00:00+07:00");
  const aged = ageNotes(ledger, later, 14);
  assert.ok(aged.notes.every((n) => n.status === "waiting"));
  assert.equal(noteSummary(aged, later).waiting, aged.notes.length);
});

test("questionSimilarity menolak pertanyaan yang berbeda topik", () => {
  assert.ok(questionSimilarity("Siapa yang diperiksa KPK", "Siapa saja yang diperiksa KPK") >= 0.55);
  assert.ok(questionSimilarity("Berapa nilai setoran", "Kapan sidang etik digelar") < 0.2);
});
