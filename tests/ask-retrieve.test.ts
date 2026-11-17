/**
 * Fase 2 rencana 022: pengambilan bahan dan verifikasi sitasi.
 *
 * Yang dikunci: pencocokan bebas harus bisa bilang "tidak ada bahan", dan
 * kutipan yang tidak ada di bahan tidak boleh lolos jadi sumber. Dua-duanya
 * adalah tempat jawaban bisa terlihat meyakinkan tanpa dasar.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { questionTokens, selectMaterial, type AskArticle } from "../src/core/ask/retrieve.ts";
import { quoteInText, stripUnverifiedQuotes, verifyCitations } from "../src/core/ask/cite.ts";
import { lintAnswer, trimToWords, writeAnswer } from "../src/core/ask/answer.ts";
import { parseAskConfig } from "../src/core/ask/config.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

const NOW = new Date("2026-11-17T06:00:00+07:00");

const teks = (isi: string) => `${isi} ${"Kalimat pengisi untuk mencapai panjang bahan yang bisa dikutip. ".repeat(8)}`;

function artikel(over: Partial<AskArticle>): AskArticle {
  return {
    url: "https://contoh.test/a",
    outlet: "contoh.test",
    title: "Judul contoh",
    published_at: "2026-11-15T00:00:00Z",
    topic_id: "t1",
    lead: "Lead contoh",
    text: teks("Isi artikel contoh."),
    ...over,
  };
}

test("token pertanyaan membuang kata tanya dan kata umum", () => {
  const t = questionTokens("Kenapa PBI BPJS warga Sleman dinonaktifkan?");
  assert.ok(t.includes("bpjs"));
  assert.ok(t.includes("sleman"));
  assert.ok(!t.includes("kenapa"));
  assert.ok(!t.includes("apa"));
});

test("mode kartu memakai artikel yang sudah dikerucutkan pemanggil", () => {
  // `articles.topic_id` tidak pernah diisi pipeline; jalur kartu memakai relasi
  // entitas di scripts/ask.ts. Di sini: jangan memeringkat ulang, jangan buang.
  const articles = [
    artikel({ topic_id: null, url: "https://a/1", outlet: "a", title: "Judul apa pun" }),
    artikel({ topic_id: null, url: "https://b/1", outlet: "b", title: "Judul lain" }),
  ];
  const r = selectMaterial(articles, "judul", { mode: "kartu", topicId: "t1", now: NOW });
  assert.equal(r.materials.length, 2);
  assert.equal(r.reason, null);
});

test("lead boleh jadi bahan, tetapi ditandai lead", () => {
  const articles = [artikel({ text: null, lead: "Lead panjang yang cukup untuk dikutip ".repeat(4) })];
  const r = selectMaterial(articles, "judul", { mode: "kartu", topicId: "t1", now: NOW });
  assert.equal(r.materials.length, 1);
  assert.equal(r.materials[0]?.tier, "lead");
});

test("bahan yang terlalu tipis ditolak, bukan dipaksakan", () => {
  const articles = [artikel({ text: null, lead: "Pendek." })];
  const r = selectMaterial(articles, "judul", { mode: "kartu", topicId: "t1", now: NOW });
  assert.equal(r.materials.length, 0);
  assert.ok(r.reason);
});

test("mode bebas bilang tidak ada bahan saat tidak ada yang cocok", () => {
  const articles = [artikel({ title: "Harga cabai naik", lead: "Harga cabai di pasar naik." })];
  const r = selectMaterial(articles, "Bagaimana progres tol Jogja Solo?", { mode: "bebas", now: NOW });
  assert.equal(r.materials.length, 0);
  assert.ok(r.reason);
});

test("mode bebas mencocokkan dan mengurutkan yang paling relevan", () => {
  const articles = [
    artikel({ url: "https://a/1", outlet: "a", title: "BPJS PBI Sleman dinonaktifkan", topic_id: "t1" }),
    artikel({ url: "https://b/1", outlet: "b", title: "PBI BPJS warga Sleman disiapkan reaktivasi", topic_id: "t1" }),
    artikel({ url: "https://c/1", outlet: "c", title: "Cuaca Sleman cerah", topic_id: "t9" }),
  ];
  const r = selectMaterial(articles, "Kenapa PBI BPJS warga Sleman dinonaktifkan?", { mode: "bebas", now: NOW });
  assert.ok(r.materials.length >= 2);
  assert.ok(r.materials.every((m) => m.url !== "https://c/1"));
});

test("satu outlet satu suara, tidak jadi tiga sumber", () => {
  const articles = [
    artikel({ url: "https://a/1", outlet: "a", title: "BPJS PBI Sleman dinonaktifkan" }),
    artikel({ url: "https://a/2", outlet: "a", title: "BPJS PBI Sleman dinonaktifkan lagi" }),
  ];
  const r = selectMaterial(articles, "BPJS PBI Sleman", { mode: "bebas", now: NOW });
  assert.equal(r.materials.length, 1);
});

test("kutipan harus ada di teks, bukan hanya mirip", () => {
  const text = "Penerima Bantuan Iuran yang dibiayai APBN dinonaktifkan mulai 1 November 2026.";
  assert.equal(quoteInText("dibiayai APBN dinonaktifkan mulai 1 November 2026", text), true);
  assert.equal(quoteInText("dinonaktifkan mulai 3 Desember 2026", text), false);
  assert.equal(quoteInText("APBN", text), false, "kutipan terlalu pendek tidak membuktikan apa pun");
});

test("sitasi dengan id bahan yang tidak ada dibuang", () => {
  const materials = [
    {
      id: "s1",
      url: "https://a/1",
      outlet: "a",
      title: "t",
      published_at: null,
      text: "Penerima Bantuan Iuran yang dibiayai APBN dinonaktifkan mulai 1 November 2026.",
      chars: 90,
      tier: "teks" as const,
    },
  ];
  const r = verifyCitations(materials, [
    { id: "s1", kutipan: "dibiayai APBN dinonaktifkan mulai 1 November 2026" },
    { id: "s9", kutipan: "kalimat yang tidak pernah ada di bahan mana pun" },
  ]);
  assert.equal(r.sources.length, 1);
  assert.equal(r.sources[0]?.url, "https://a/1");
  assert.equal(r.unsupported.length, 1);
});

test("potong kata berhenti di batas kalimat, tanpa elipsis", () => {
  const out = trimToWords("Satu dua tiga. Empat lima enam. Tujuh delapan sembilan.", 6);
  assert.equal(out, "Satu dua tiga. Empat lima enam.");
  assert.ok(!out.includes("…"));
});

test("cacat teks menahan jawaban, bukan diterbitkan", () => {
  const bersih = lintAnswer("Penerima Bantuan Iuran dinonaktifkan mulai 1 November 2026 di Kabupaten Sleman.");
  assert.deepEqual(bersih, []);

  assert.ok(lintAnswer("Jawaban ini berakhir menggantung…").length > 0, "elipsis di akhir");
  assert.ok(lintAnswer('Kutipan "tidak seimbang di sini tapi cukup panjang kalimatnya').length > 0);
  assert.ok(lintAnswer("kata kata ganda ada di sini dan cukup panjang kalimatnya").length > 0);
  assert.ok(lintAnswer("terlalu pendek").length > 0);
});

/** Adapter palsu: mengembalikan keluaran berurutan, tanpa jaringan. */
function llmPalsu(outputs: string[]) {
  let i = 0;
  return {
    name: "opencode" as const,
    calls: 0,
    json: async () => ({ data: {} as never, usage: { tokens_in: 0, tokens_out: 0 } }),
    text: async () => {
      const out = outputs[Math.min(i, outputs.length - 1)] ?? "";
      i += 1;
      return { text: out, usage: { tokens_in: 10, tokens_out: 5 } };
    },
  };
}

const bahan = [
  {
    id: "s1",
    url: "https://a/1",
    outlet: "a",
    title: "t",
    published_at: "2026-11-11T00:00:00Z",
    text: "Puluhan anggota DPR mengusulkan hak menyatakan pendapat terkait polemik ijazah Gibran.",
    chars: 88,
    tier: "teks" as const,
  },
];

test("sitasi kosong diulang sekali, lalu lolos bila bentuknya benar", async () => {
  const llm = llmPalsu([
    JSON.stringify({ jawaban: "Ada usulan di DPR.", sitasi: [] }),
    JSON.stringify({
      jawaban: "Puluhan anggota DPR mengusulkan hak menyatakan pendapat.",
      sitasi: [{ id: "s1", kutipan: "Puluhan anggota DPR mengusulkan hak menyatakan pendapat" }],
    }),
  ]);
  const r = await writeAnswer(llm, "uji", "apa itu HMP?", bahan, parseAskConfig(readFileSync(join(root, "config", "tanya.json"), "utf8")));
  assert.equal(r.state, "answered");
  assert.equal(r.sources.length, 1);
  assert.equal(r.usage?.tokens_in, 20, "dua panggilan dijumlahkan");
});

test("model menulis url alih-alih id tetap diterima", async () => {
  const llm = llmPalsu([
    JSON.stringify({
      jawaban: "Puluhan anggota DPR mengusulkan hak menyatakan pendapat.",
      sitasi: [{ url: "s1", kutipan: "Puluhan anggota DPR mengusulkan hak menyatakan pendapat" }],
    }),
  ]);
  const r = await writeAnswer(llm, "uji", "apa itu HMP?", bahan, parseAskConfig(readFileSync(join(root, "config", "tanya.json"), "utf8")));
  assert.equal(r.state, "answered");
  assert.equal(r.sources[0]?.url, "https://a/1");
});

test("dua kali tanpa sitasi sah tetap ditahan, bukan dikarang", async () => {
  const kosong = JSON.stringify({ jawaban: "Tidak ada bahan yang cukup untuk menjawab ini.", sitasi: [] });
  const llm = llmPalsu([kosong, kosong]);
  const r = await writeAnswer(llm, "uji", "apa itu HMP?", bahan, parseAskConfig(readFileSync(join(root, "config", "tanya.json"), "utf8")));
  assert.equal(r.state, "refused");
  assert.match(String(r.reason), /sitasi/i);
});

test("kalimat yang mengutip teks di luar bahan dibuang, bukan diterbitkan", () => {
  const materials = [
    {
      id: "s1",
      url: "https://a/1",
      outlet: "a",
      title: "t",
      published_at: null,
      text: "Puluhan anggota DPR mengusulkan hak menyatakan pendapat terkait polemik ijazah Gibran.",
      chars: 88,
      tier: "teks" as const,
    },
  ];
  const jawaban =
    'detik.com menulis "Puluhan anggota DPR mengusulkan hak menyatakan pendapat terkait polemik ijazah Gibran". ' +
    'Sumber lain menyebut "kalimat ini tidak pernah ada di bahan mana pun sama sekali".';
  const r = stripUnverifiedQuotes(jawaban, materials);
  assert.match(r.text, /detik\.com/);
  assert.doesNotMatch(r.text, /tidak pernah ada/);
  assert.equal(r.dropped.length, 1);
});
