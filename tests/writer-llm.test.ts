import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseCard, writeCardWithLlm, type BackgroundCandidate } from "../src/core/writer-llm.ts";
import type { LlmAdapter } from "../src/adapters/llm/types.ts";
import type { AdjudicatedTopic } from "../src/core/adjudicate.ts";
import { createDeterministicWriter, loadGlossary } from "../src/core/writer.ts";

const candidates: BackgroundCandidate[] = [
  { key: "g1", q: "Apa itu HMP?", a: "Hak konstitusional DPR untuk menyatakan pendapat.", outlet: "DPR RI", url: "https://dpr.go.id/" },
  { key: "g2", q: "Siapa Puan?", a: "Ketua DPR RI periode 2024–2029.", outlet: "DPR RI", url: "https://dpr.go.id/" },
];

const topic: AdjudicatedTopic = {
  cids: ["c01"],
  title: "HMP soal ijazah",
  angle: "Usulan bergulir",
  kind: "ongoing",
  entities: ["dpr", "hmp"],
  local: false,
  horse_race: false,
  drop: false,
  category: "policy",
  significance: 5,
  heavy: false,
  reason: null,
};

const ctx = {
  editionId: "2026-11-11",
  now: new Date("2026-11-11T05:00:00+07:00"),
  topic,
  topicId: "t_hmp_soal_ijazah_abcd",
  cluster: {
    articles: [
      { title: "HMP bergulir", lead: "DPR membahas usulan.", url: "https://detik.com/a", outlet: "detik.com", publishedAt: "2026-11-10T12:00:00Z" },
    ],
    outlets: ["detik.com", "cnnindonesia.com"],
  },
  sources: [
    { outlet: "detik.com", url: "https://detik.com/a", published_at: "2026-11-10T12:00:00+07:00", tier: 2 as const, accessed_at: "2026-11-11T05:00:00+07:00" },
    { outlet: "cnnindonesia.com", url: "https://cnnindonesia.com/b", published_at: "2026-11-10T11:00:00+07:00", tier: 2 as const, accessed_at: "2026-11-11T05:00:00+07:00" },
  ],
  local: false,
  revision: 1,
  firstSeen: "2026-11-10",
  previousEdition: null,
};

const llmReturning = (data: unknown): LlmAdapter => ({
  name: "deepseek",
  async json<T>() {
    return { data: data as T, usage: { tokens_in: 100, tokens_out: 50 } };
  },
  async text() {
    return { text: "", usage: { tokens_in: 0, tokens_out: 0 } };
  },
});

test("normaliseCard membuang explain dengan source_key tak dikenal", () => {
  const out = normaliseCard(
    {
      title: "HMP bergulir di DPR",
      body: ["Paragraf satu yang cukup panjang untuk lolos validasi isi."],
      action: "Baca dokumen resminya.",
      explain: [
        { q: "Apa itu HMP?", a: "Hak konstitusional DPR untuk menyatakan pendapat atas kebijakan pemerintah.", source_key: "g1" },
        { q: "Siapa Puan?", a: "Ketua DPR RI periode 2024–2029 yang memimpin paripurna.", source_key: "g2" },
        { q: "Apa itu DPR?", a: "Lembaga legislatif yang anggotanya dipilih lewat pemilu lima tahunan.", source_key: "zzz" },
      ],
    },
    candidates,
    "HMP",
  );
  assert.ok(out);
  assert.equal(out!.explain.length, 2, "entri dengan kunci tak dikenal harus dibuang");
  assert.equal(out!.explain[0]!.source.url, "https://dpr.go.id/");
});

test("normaliseCard menolak jika konteks kurang dari dua", () => {
  const out = normaliseCard(
    {
      title: "HMP",
      body: ["Paragraf."],
      action: "Baca.",
      explain: [{ q: "Apa itu HMP?", a: "Hak konstitusional DPR untuk menyatakan pendapat atas kebijakan.", source_key: "g1" }],
    },
    candidates,
    "HMP",
  );
  assert.equal(out, null);
});

test("normaliseCard menolak pertanyaan tanpa tanda tanya", () => {
  const out = normaliseCard(
    {
      title: "HMP",
      body: ["Paragraf."],
      action: "Baca.",
      explain: [
        { q: "Apa itu HMP", a: "Hak konstitusional DPR untuk menyatakan pendapat atas kebijakan.", source_key: "g1" },
        { q: "Siapa Puan?", a: "Ketua DPR RI periode 2024 sampai 2029.", source_key: "g2" },
      ],
    },
    candidates,
    "HMP",
  );
  assert.equal(out, null);
});

test("writeCardWithLlm menghasilkan kartu valid", async () => {
  const card = await writeCardWithLlm(ctx, {
    llm: llmReturning({
      title: "HMP bergulir di DPR",
      angle: "Usulan HMP soal ijazah",
      body: ["DPR membahas usulan HMP terkait ijazah wapres."],
      action: "Cek dokumen resminya sebelum menyebarkan.",
      claim: "DPR membahas usulan HMP",
      explain: [
        { q: "Apa itu HMP?", a: "Hak konstitusional DPR untuk menyatakan pendapat atas kebijakan pemerintah.", source_key: "g1" },
        { q: "Siapa Puan?", a: "Ketua DPR RI periode 2024–2029 yang memimpin paripurna.", source_key: "g2" },
      ],
    }),
    model: "m",
    glossary: loadGlossary("config/glossary.yaml"),
    candidates,
  });

  assert.ok(card);
  assert.equal(card!.type, "news");
  assert.equal(card!.explain!.length, 2);
  assert.ok(card!.truth);
});

test("writeCardWithLlm mengembalikan null saat LLM gagal", async () => {
  const failing: LlmAdapter = {
    name: "deepseek",
    async json<T>(): Promise<{ data: T; usage: { tokens_in: number; tokens_out: number } }> {
      throw new Error("mati");
    },
    async text() {
      throw new Error("mati");
    },
  };
  const card = await writeCardWithLlm(ctx, { llm: failing, model: "m", glossary: loadGlossary("config/glossary.yaml"), candidates });
  assert.equal(card, null);
});

test("writer deterministik tetap jadi cadangan yang valid", () => {
  const w = createDeterministicWriter(loadGlossary("config/glossary.yaml"));
  const card = w.write({ ...ctx, cluster: { ...ctx.cluster, articles: ctx.cluster.articles as never } } as never);
  assert.ok(card);
  assert.equal(card!.type, "news");
});

test("judul yang terpotong diperpanjang dari judul artikel", () => {
  const out = normaliseCard(
    {
      title: "DPR Disebut Sepakat Pakai Hak Menyatakan Pendapat soal",
      body: ["Paragraf satu yang cukup panjang untuk lolos validasi isi."],
      action: "Baca dokumen resminya.",
      explain: [
        { q: "Apa itu HMP?", a: "Hak konstitusional DPR untuk menyatakan pendapat atas kebijakan pemerintah.", source_key: "g1" },
        { q: "Siapa Puan?", a: "Ketua DPR RI periode 2024–2029 yang memimpin paripurna.", source_key: "g2" },
      ],
    },
    candidates,
    "HMP",
    [
      "DPR Disebut Sepakat Pakai Hak Menyatakan Pendapat soal Gibran",
      "Berita lain yang tidak berhubungan sama sekali",
    ],
  );
  assert.ok(out);
  assert.equal(out!.title, "DPR Disebut Sepakat Pakai Hak Menyatakan Pendapat soal Gibran");
});

test("judul tanpa perpanjangan tidak berakhir di kata sambung", () => {
  const out = normaliseCard(
    {
      title: "Polemik ijazah Gibran masuk ke ruang rapat DPR soal",
      body: ["Paragraf satu yang cukup panjang untuk lolos validasi isi."],
      action: "Baca dokumen resminya.",
      explain: [
        { q: "Apa itu HMP?", a: "Hak konstitusional DPR untuk menyatakan pendapat atas kebijakan pemerintah.", source_key: "g1" },
        { q: "Siapa Puan?", a: "Ketua DPR RI periode 2024–2029 yang memimpin paripurna.", source_key: "g2" },
      ],
    },
    candidates,
    "HMP",
    [],
  );
  assert.ok(out);
  assert.ok(!/\bsoal$/i.test(out!.title), `judul masih menggantung: ${out!.title}`);
});

test("glosarium dicocokkan lewat frasa pertanyaan, bukan hanya id entitas", async () => {
  const { explainForTopic } = await import("../src/core/writer.ts");
  const glossary = loadGlossary("config/glossary.yaml");
  const items = explainForTopic(
    { ...topic, entities: [], title: "DPR Dorong Hak Menyatakan Pendapat", angle: "" },
    glossary,
    "Polemik ijazah Gibran dibahas di parlemen; pemakzulan disebut-sebut.",
  );
  assert.ok(items);
  const qs = items!.map((i) => i.q.toLowerCase()).join(" | ");
  assert.match(qs, /hak menyatakan pendapat/, `tidak menemukan HMP: ${qs}`);
});
