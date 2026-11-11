import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openSqlite } from "../src/adapters/db/sqlite.ts";
import { writeNewsroomCard } from "../src/core/newsroom/card.ts";
import { loadLedger, persistLedger } from "../src/core/newsroom/store.ts";
import type { EditorNote, NoteLedger } from "../src/core/newsroom/notes.ts";
import type { Assignment } from "../src/core/newsroom/contracts.ts";
import type { AdjudicatedTopic } from "../src/core/adjudicate.ts";
import type { LlmAdapter } from "../src/adapters/llm/types.ts";
import type { Glossary } from "../src/core/writer.ts";

const glossary: Glossary = new Map([
  ["kpk", { q: "Apa itu KPK?", a: "Lembaga pemberantasan korupsi di Indonesia.", outlet: "KPK", url: "https://kpk.go.id/" }],
  ["category_policy", { q: "Apa itu kebijakan publik?", a: "Keputusan lembaga negara yang mengikat warga.", outlet: "KPK", url: "https://kpk.go.id/" }],
]);

const topic: AdjudicatedTopic = {
  cids: ["c01"],
  title: "KPK periksa kepala pertanahan",
  angle: "Dugaan setoran",
  kind: "ongoing",
  entities: ["kpk"],
  local: false,
  horse_race: false,
  drop: false,
  category: "policy",
  significance: 4,
  heavy: false,
  reason: null,
};

const assignment: Assignment = {
  cids: ["c01"],
  title: topic.title,
  angle: topic.angle,
  category: "policy",
  significance: 4,
  heavy: false,
  depth: "standard",
  why_now: "Hari ini",
  answers: ["Siapa yang diperiksa", "Berapa nilai setoran", "Apa bantahan pihak yang disebut"],
  note_ids: [],
  drop: false,
  reason: null,
};

const cluster = {
  key: "c01",
  outlets: ["kompas.com", "detik.com"],
  entities: ["kpk"],
  score: 1,
  articles: [
    { id: "a1", url: "https://kompas.com/a", outlet: "kompas.com", title: "KPK periksa kepala pertanahan", titleNorm: "kpk periksa kepala pertanahan", lead: "KPK memeriksa sembilan kepala kantor pertanahan pada Selasa (10/11).", publishedAt: "2026-11-10T10:00:00Z", entities: [] },
    { id: "a2", url: "https://detik.com/b", outlet: "detik.com", title: "Setoran Rp2,3 miliar diduga diterima", titleNorm: "setoran rp23 miliar diduga diterima", lead: "Penyidik menduga ada setoran Rp2,3 miliar menurut keterangan resmi.", publishedAt: "2026-11-10T11:00:00Z", entities: [] },
  ],
};

const draft = {
  title: "KPK periksa sembilan kepala kantor pertanahan",
  angle: "Dugaan setoran miliaran rupiah",
  dek: "",
  body: [
    "KPK memeriksa sembilan kepala kantor pertanahan pada Selasa (10/11). Pemeriksaan berlangsung di Jakarta.",
    "Penyidik menduga ada setoran Rp2,3 miliar. Angka itu disebut dalam keterangan resmi lembaga.",
    "Belum ada bantahan dari pihak yang diperiksa. KPK menyebut pemeriksaan akan berlanjut pekan ini.",
  ],
  citations: [
    { paragraph: 0, sources: ["s1"] },
    { paragraph: 1, sources: ["s2"] },
    { paragraph: 2, sources: ["s1", "s2"] },
  ],
  action: "Tunggu keterangan resmi KPK sebelum menyimpulkan.",
  claim: "KPK memeriksa sembilan kepala kantor pertanahan",
  explain: [
    { q: "Apa itu KPK?", a: "Lembaga pemberantasan korupsi di Indonesia.", source_key: "g1" },
    { q: "Apa itu setoran?", a: "Pembayaran tidak resmi yang diberikan kepada pejabat negara.", source_key: "g1" },
  ],
  depth_achieved: "standard",
  depth_change: null,
  needs: [],
};

const edit = {
  verdict: "approve",
  findings: [],
  answers_covered: [0, 1, 2],
  answers_missing: [],
  depth_check: "standard",
  category_check: null,
  notes_resolved: [],
};

const llm: LlmAdapter = {
  name: "deepseek",
  async json<T>() {
    const data = (globalThis as { __n?: number }).__n = ((globalThis as { __n?: number }).__n ?? 0) + 1;
    return { data: (data === 1 ? draft : edit) as T, usage: { tokens_in: 10, tokens_out: 5 } };
  },
  async text() {
    return { text: "", usage: { tokens_in: 0, tokens_out: 0 } };
  },
};

test("writeNewsroomCard menghasilkan kartu dengan sitasi dan explain", async () => {
  const res = await writeNewsroomCard(
    {
      editionId: "2026-11-10",
      now: new Date("2026-11-10T20:00:00+07:00"),
      topic,
      topicId: "t_kpk_pertanahan",
      cluster: cluster as never,
      assignment,
      local: false,
      revision: 1,
      firstSeen: "2026-11-10",
      previousEdition: null,
      prior: [],
      openNotes: [],
      asDeep: false,
      fromIso: "2026-11-09T20:00:00+07:00",
      toIso: "2026-11-10T20:00:00+07:00",
      fetchImpl: async () => ({ text: "", ok: false }),
    },
    { llm, model: "test", glossary },
  );

  assert.ok(res.card);
  assert.equal(res.card!.type, "news");
  assert.equal(res.card!.body.length, 3);
  assert.equal(res.card!.sources.length, 2);
  assert.equal(res.card!.explain?.length, 2);
  assert.equal(res.edit?.verdict, "approve");
});

const note: EditorNote = {
  id: "n_test",
  topic_id: "t_kpk_pertanahan",
  thread_title: "KPK periksa kepala pertanahan",
  kind: "coverage_gap",
  question: "Berapa nilai setoran yang diduga diterima?",
  detail: "Bahan belum memuat angka resmi.",
  origin: { edition_id: "2026-11-10", card_title: "KPK periksa kepala pertanahan", code: "E-DEPTH", paragraph: 1 },
  status: "open",
  first_seen: "2026-11-10T20:00:00+07:00",
  last_seen: "2026-11-10T20:00:00+07:00",
  attempts: 1,
  weight: 3,
  next_action: "Cari rilis resmi KPK.",
  expires_at: "2026-12-25T20:00:00+07:00",
  resolved_by: null,
};

test("kartu tetap punya 2 konteks meski glosarium kosong", async () => {
  (globalThis as { __n?: number }).__n = 0;
  const res = await writeNewsroomCard(
    {
      editionId: "2026-11-10",
      now: new Date("2026-11-10T20:00:00+07:00"),
      topic,
      topicId: "t_kpk_pertanahan",
      cluster: cluster as never,
      assignment,
      local: false,
      revision: 1,
      firstSeen: "2026-11-10",
      previousEdition: null,
      prior: [],
      openNotes: [],
      asDeep: false,
      fromIso: "2026-11-09T20:00:00+07:00",
      toIso: "2026-11-10T20:00:00+07:00",
      fetchImpl: async () => ({ text: "", ok: false }),
    },
    { llm, model: "test", glossary: new Map() },
  );
  assert.ok(res.card);
  assert.equal(res.card!.explain?.length, 2);
});

test("deep_dive hanya dipakai bila sumber cukup", async () => {
  (globalThis as { __n?: number }).__n = 0;
  const res = await writeNewsroomCard(
    {
      editionId: "2026-11-10",
      now: new Date("2026-11-10T20:00:00+07:00"),
      topic,
      topicId: "t_kpk_pertanahan",
      cluster: cluster as never,
      assignment: { ...assignment, depth: "deep" },
      local: false,
      revision: 1,
      firstSeen: "2026-11-10",
      previousEdition: null,
      prior: [],
      openNotes: [],
      asDeep: true,
      fromIso: "2026-11-09T20:00:00+07:00",
      toIso: "2026-11-10T20:00:00+07:00",
      fetchImpl: async () => ({ text: "", ok: false }),
    },
    { llm, model: "test", glossary },
  );
  assert.ok(res.card);
  assert.equal(res.card!.type, "news", "2 sumber belum cukup untuk deep_dive");
});

test("disclaimer selalu kalimat utuh, bukan potongan issue editor", async () => {
  let n = 0;
  const seq: LlmAdapter = {
    name: "deepseek",
    async json<T>() {
      n++;
      const data =
        n === 1
          ? draft
          : {
              ...edit,
              findings: [
                {
                  code: "E-SRC",
                  severity: "advisory",
                  paragraph: 1,
                  quote: "Kutipan sumber",
                  issue:
                    "Konflik sumber, bukan fakta salah: Draft menyatakan angka yang berbeda dari sumber resmi dan perlu diperiksa lebih lanjut. ".repeat(8),
                  fix: "Periksa sumber primer.",
                },
              ],
            };
      return { data: data as T, usage: { tokens_in: 10, tokens_out: 5 } };
    },
    async text() {
      return { text: "", usage: { tokens_in: 0, tokens_out: 0 } };
    },
  };

  const res = await writeNewsroomCard(
    {
      editionId: "2026-11-10",
      now: new Date("2026-11-10T20:00:00+07:00"),
      topic,
      topicId: "t_kpk_pertanahan",
      cluster: cluster as never,
      assignment,
      local: false,
      revision: 1,
      firstSeen: "2026-11-10",
      previousEdition: null,
      prior: [],
      openNotes: [],
      asDeep: false,
      fromIso: "2026-11-09T20:00:00+07:00",
      toIso: "2026-11-10T20:00:00+07:00",
      fetchImpl: async () => ({ text: "", ok: false }),
    },
    { llm: seq, model: "test", glossary },
  );

  assert.ok(res.card);
  assert.ok(res.card!.disclaimer);
  assert.match(res.card!.disclaimer!, /sumber primer\.$/);
  assert.ok(!res.card!.disclaimer!.includes("Draft menyatakan"));
  assert.ok(res.card!.disclaimer!.length <= 320);
});

test("sumber kartu hanya bahan yang benar-benar disitasi", async () => {
  let n = 0;
  const seq: LlmAdapter = {
    name: "deepseek",
    async json<T>() {
      n++;
      const data =
        n === 1
          ? {
              ...draft,
              citations: [
                { paragraph: 0, sources: ["s1"] },
                { paragraph: 1, sources: ["s1"] },
                { paragraph: 2, sources: ["s1"] },
              ],
            }
          : edit;
      return { data: data as T, usage: { tokens_in: 10, tokens_out: 5 } };
    },
    async text() {
      return { text: "", usage: { tokens_in: 0, tokens_out: 0 } };
    },
  };

  const res = await writeNewsroomCard(
    {
      editionId: "2026-11-10",
      now: new Date("2026-11-10T20:00:00+07:00"),
      topic,
      topicId: "t_kpk_pertanahan",
      cluster: cluster as never,
      assignment,
      local: false,
      revision: 1,
      firstSeen: "2026-11-10",
      previousEdition: null,
      prior: [],
      openNotes: [],
      asDeep: false,
      fromIso: "2026-11-09T20:00:00+07:00",
      toIso: "2026-11-10T20:00:00+07:00",
      fetchImpl: async () => ({ text: "", ok: false }),
    },
    { llm: seq, model: "test", glossary },
  );

  assert.ok(res.card);
  assert.equal(res.card!.sources.length, 1, "s2 tidak disitasi, jadi tidak masuk sumber");
});

test("editor hanya boleh menutup catatan yang ditautkan planner", async () => {
  const second = {
    ...note,
    id: "n_other",
    kind: "verification_gap" as const,
    question: "Verifikasi: nilai setoran belum dikonfirmasi sumber primer",
  };
  let n = 0;
  const seq: LlmAdapter = {
    name: "deepseek",
    async json<T>() {
      n++;
      const data =
        n === 1
          ? draft
          : {
              ...edit,
              notes_resolved: [
                { id: note.id, quote: "KPK memeriksa sembilan kepala kantor pertanahan pada Selasa (10/11)." },
                { id: second.id, quote: "Penyidik menduga ada setoran Rp2,3 miliar." },
              ],
            };
      return { data: data as T, usage: { tokens_in: 10, tokens_out: 5 } };
    },
    async text() {
      return { text: "", usage: { tokens_in: 0, tokens_out: 0 } };
    },
  };

  const res = await writeNewsroomCard(
    {
      editionId: "2026-11-10",
      now: new Date("2026-11-10T20:00:00+07:00"),
      topic,
      topicId: "t_kpk_pertanahan",
      cluster: cluster as never,
      assignment,
      local: false,
      revision: 1,
      firstSeen: "2026-11-10",
      previousEdition: null,
      prior: [],
      openNotes: [note, second],
      noteIds: [note.id],
      asDeep: false,
      fromIso: "2026-11-09T20:00:00+07:00",
      toIso: "2026-11-10T20:00:00+07:00",
      fetchImpl: async () => ({ text: "", ok: false }),
    },
    { llm: seq, model: "test", glossary },
  );

  assert.equal(res.edit?.notes_resolved.length, 1);
  assert.equal(res.edit?.notes_resolved[0]!.id, note.id);
});

test("kartu lokal dengan satu sumber tetap punya dua konteks", async () => {
  const topicLocal: AdjudicatedTopic = { ...topic, entities: [], title: "Warga Sleman gotong royong", angle: "Kerja bakti di padukuhan", local: true };
  const clusterLocal = {
    ...cluster,
    outlets: ["harianjogja.com"],
    articles: [
      {
        id: "a1",
        url: "https://harianjogja.com/a",
        outlet: "harianjogja.com",
        title: "Warga Sleman gotong royong",
        titleNorm: "warga sleman gotong royong",
        lead: "Warga Padukuhan X, Sleman, menggelar kerja bakti pada Minggu pagi.",
        publishedAt: "2026-11-10T10:00:00Z",
        entities: [],
      },
    ],
  } as never;
  (globalThis as { __n?: number }).__n = 0;

  const res = await writeNewsroomCard(
    {
      editionId: "2026-11-10",
      now: new Date("2026-11-10T20:00:00+07:00"),
      topic: topicLocal,
      topicId: "t_sleman",
      cluster: clusterLocal,
      assignment: { ...assignment, title: topicLocal.title, angle: topicLocal.angle, category: "culture" },
      local: true,
      revision: 1,
      firstSeen: "2026-11-10",
      previousEdition: null,
      prior: [],
      openNotes: [],
      asDeep: false,
      fromIso: "2026-11-09T20:00:00+07:00",
      toIso: "2026-11-10T20:00:00+07:00",
      fetchImpl: async () => ({ text: "", ok: false }),
    },
    { llm, model: "test", glossary: new Map() },
  );

  assert.ok(res.card);
  assert.equal((res.card as { place?: string }).place, "lokal");
  assert.equal(res.card!.sources.length, 1);
  assert.equal(res.card!.explain?.length, 2);
});

test("ledger dapat disimpan dan dibaca kembali dari SQLite", () => {
  const db = openSqlite(":memory:");
  db.exec(readFileSync(new URL("../migrations/004_editor_notes.sql", import.meta.url), "utf8"));

  const ledger: NoteLedger = {
    schema_version: 1,
    updated_at: "2026-11-10T20:00:00+07:00",
    notes: [note],
  };
  persistLedger(db, ledger);
  const loaded = loadLedger(db);
  assert.equal(loaded.notes.length, 1);
  assert.equal(loaded.notes[0]!.question, note.question);
  assert.equal(loaded.notes[0]!.thread_title, note.thread_title);

  persistLedger(db, {
    ...ledger,
    notes: [{ ...note, status: "answered", resolved_by: { edition_id: "2026-11-11", card_title: "KPK", quote: "Rp2,3 miliar" } }],
  });
  const again = loadLedger(db);
  assert.equal(again.notes[0]!.status, "answered");
  assert.equal(again.notes[0]!.resolved_by?.quote, "Rp2,3 miliar");
  db.close();
});

test("minDeepSources=2 mengizinkan deep_dive dengan dua sumber", async () => {
  (globalThis as { __n?: number }).__n = 0;
  const res = await writeNewsroomCard(
    {
      editionId: "2026-11-10",
      now: new Date("2026-11-10T20:00:00+07:00"),
      topic,
      topicId: "t_kpk_pertanahan",
      cluster: cluster as never,
      assignment: { ...assignment, depth: "deep" },
      local: false,
      revision: 1,
      firstSeen: "2026-11-10",
      previousEdition: null,
      prior: [],
      openNotes: [],
      asDeep: true,
      minDeepSources: 2,
      fromIso: "2026-11-09T20:00:00+07:00",
      toIso: "2026-11-10T20:00:00+07:00",
      fetchImpl: async () => ({ text: "", ok: false }),
    },
    { llm, model: "test", glossary },
  );
  assert.ok(res.card);
  assert.equal(res.card!.type, "deep_dive", "mingguan mengizinkan 2 sumber");
  assert.equal(res.card!.optional, true);
  assert.ok((res.card as { read_min: number }).read_min >= 4);
});
