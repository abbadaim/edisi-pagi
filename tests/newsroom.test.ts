import { test } from "node:test";
import assert from "node:assert/strict";
import { extractArticleText, hostAllowed } from "../src/core/newsroom/material.ts";
import { acceptWithInventedFacts, deterministicFindings, editDraft, factFailurePolicy, inventedNumbers, revisionInstruction } from "../src/core/newsroom/edit.ts";
import { deterministicDesk, type DeskCard } from "../src/core/newsroom/desk.ts";
import { repairFactDraft, writeDraft } from "../src/core/newsroom/write.ts";
import { planEdition } from "../src/core/newsroom/plan.ts";
import type { AdjudicatedTopic } from "../src/core/adjudicate.ts";
import type { LlmAdapter } from "../src/adapters/llm/types.ts";
import type { Assignment, Draft, MaterialPack } from "../src/core/newsroom/contracts.ts";

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
  title: "KPK periksa kepala pertanahan",
  angle: "Dugaan setoran",
  category: "policy",
  significance: 4,
  heavy: false,
  depth: "standard",
  why_now: "Pemeriksaan hari ini",
  answers: ["Siapa yang diperiksa", "Berapa nilai setoran", "Apa bantahan pihak yang disebut"],
  note_ids: [],
  drop: false,
  reason: null,
};

const pack: MaterialPack = {
  topic_id: "t_poc_x",
  items: [
    { id: "s1", kind: "article", outlet: "kompas.com", url: "https://kompas.com/a", published_at: null, tier: 2, text: "KPK memeriksa sembilan kepala kantor pertanahan pada Selasa (10/11).", chars: 70, full_text: true },
    { id: "s2", kind: "article", outlet: "detik.com", url: "https://detik.com/b", published_at: null, tier: 2, text: "Dugaan setoran mencapai Rp2,3 miliar menurut penyidik.", chars: 55, full_text: true },
    { id: "g1", kind: "background", outlet: "KPK", url: "https://kpk.go.id/", published_at: null, tier: 1, text: "KPK adalah lembaga pemberantasan korupsi.", chars: 44, full_text: false },
  ],
  missing: [],
  stats: { lead_chars: 200, material_chars: 4000, fetched: 2, failed: 0, urls: [] },
};

const goodDraft: Draft = {
  title: "KPK periksa sembilan kepala kantor pertanahan",
  angle: "Dugaan setoran miliaran rupiah",
  dek: "",
  body: [
    "KPK memeriksa sembilan kepala kantor pertanahan pada Selasa (10/11). Pemeriksaan berlangsung di Jakarta dan melibatkan penyidik dari kedeputian penindakan. Menurut juru bicara lembaga, pemeriksaan ini bagian dari penyelidikan yang berjalan sejak awal tahun.",
    "Penyidik menduga ada setoran Rp2,3 miliar. Angka itu disebut dalam keterangan resmi lembaga dan belum dibantah oleh pihak yang diperiksa. Nilai tersebut merupakan akumulasi dugaan penerimaan dari beberapa kegiatan pengurusan sertifikat.",
    "Belum ada bantahan dari pihak yang diperiksa. KPK menyebut pemeriksaan akan berlanjut pekan ini dan tidak menutup kemungkinan memanggil pihak lain. Pembaca sebaiknya menunggu keterangan resmi sebelum menyimpulkan.",
  ],
  citations: [
    { paragraph: 0, sources: ["s1"] },
    { paragraph: 1, sources: ["s2"] },
    { paragraph: 2, sources: ["s1", "s2"] },
  ],
  action: "Tunggu keterangan resmi KPK sebelum menyimpulkan.",
  claim: "KPK memeriksa sembilan kepala kantor pertanahan",
  explain: [
    { q: "Apa itu KPK?", a: "Lembaga negara yang menangani pemberantasan korupsi di Indonesia.", source: { outlet: "KPK", url: "https://kpk.go.id/" } },
    { q: "Apa itu setoran?", a: "Pembayaran tidak resmi yang diduga diberikan untuk memengaruhi keputusan pejabat.", source: { outlet: "KPK", url: "https://kpk.go.id/" } },
  ],
  depth_achieved: "standard",
  depth_change: null,
  needs: [],
};

const llmReturning = (data: unknown, throwIt = false): LlmAdapter => ({
  name: "deepseek",
  async json<T>() {
    if (throwIt) throw new Error("gagal");
    return { data: data as T, usage: { tokens_in: 10, tokens_out: 5 } };
  },
  async text() {
    return { text: "", usage: { tokens_in: 0, tokens_out: 0 } };
  },
});

test("extractArticleText membuang menu dan mempertahankan prosa", () => {
  const html = `
    <html><body>
      <p>MENU detikcom Terpopuler Live TV Kirim Tulisan Kategori Berita</p>
      <p>Jakarta - KPK memeriksa sembilan kepala kantor pertanahan pada Selasa. Pemeriksaan ini berkaitan dengan dugaan setoran yang diterima pejabat.</p>
      <p>Baca juga: Berita lain yang tidak relevan</p>
      <p>Penyidik menyebut nilai dugaan setoran mencapai miliaran rupiah dan akan diumumkan pekan ini.</p>
    </body></html>`;
  const text = extractArticleText(html);
  assert.match(text, /KPK memeriksa/);
  assert.doesNotMatch(text, /MENU detikcom/);
  assert.doesNotMatch(text, /Baca juga/);
  assert.ok(!text.startsWith("Jakarta -"), "dateline harus dipotong");
});

test("hostAllowed hanya mengizinkan daftar izin dan .go.id", () => {
  assert.equal(hostAllowed("https://news.detik.com/berita/x"), true);
  assert.equal(hostAllowed("https://slemankab.go.id/berita"), true);
  assert.equal(hostAllowed("https://example.com/berita"), false);
});

test("deterministicFindings menandai paragraf tanpa sitasi", () => {
  const draft: Draft = {
    ...goodDraft,
    citations: [
      { paragraph: 0, sources: ["s1"] },
      { paragraph: 1, sources: ["s2"] },
    ],
  };
  const findings = deterministicFindings(draft, pack, assignment);
  assert.ok(findings.some((f) => f.code === "D-CITE" && f.severity === "advisory"));
});

test("deterministicFindings menolak id bahan asing", () => {
  const draft: Draft = {
    ...goodDraft,
    citations: goodDraft.citations.map((c) => ({ ...c, sources: [...c.sources, "s99"] })),
  };
  const findings = deterministicFindings(draft, pack, assignment);
  assert.ok(findings.some((f) => f.code === "D-CITE" && f.issue.includes("s99")));
});

test("deterministicFindings menuntut dua media untuk depth standard", () => {
  const draft: Draft = {
    ...goodDraft,
    citations: goodDraft.citations.map((c) => ({ ...c, sources: ["s1"] })),
  };
  const findings = deterministicFindings(draft, pack, assignment);
  assert.ok(findings.some((f) => f.code === "D-SRC"));
});

test("draft yang sehat tidak punya temuan blocking", () => {
  const findings = deterministicFindings(goodDraft, pack, assignment);
  assert.equal(findings.filter((f) => f.severity === "blocking").length, 0);
});

test("revisionInstruction mendahulukan temuan blocking", () => {
  const text = revisionInstruction([
    { code: "E-TONE", severity: "advisory", paragraph: null, quote: "", issue: "judul terlalu kuat", fix: "lunakkan" },
    { code: "E-SRC", severity: "blocking", paragraph: 1, quote: "", issue: "klaim tanpa sumber", fix: "hapus klaim" },
  ]);
  assert.ok(text.indexOf("E-SRC") < text.indexOf("E-TONE"));
});

test("E-FACT hanya memblokir bila kutipan sumber cocok", async () => {
  const base = {
    verdict: "revise",
    findings: [
      {
        code: "E-FACT",
        severity: "blocking",
        paragraph: 1,
        quote: "Menteri Keuangan mengesahkan anggaran tambahan untuk pengadaan tanah",
        issue: "Klaim bertentangan dengan sumber",
        fix: "Koreksi",
      },
    ],
    answers_covered: [0, 1, 2],
    answers_missing: [],
    depth_check: "standard",
    category_check: null,
    notes_resolved: [],
  };

  const bad = await editDraft(goodDraft, pack, assignment, { llm: llmReturning(base), model: "test" });
  assert.equal(bad.edit.verdict, "approve", "kutipan tidak ada di sumber tidak boleh memblokir");
  assert.match(bad.edit.findings.find((f) => f.code === "E-FACT")!.issue, /tidak ditemukan/);

  const good = await editDraft(goodDraft, pack, assignment, {
    llm: llmReturning({
      ...base,
      findings: [{ ...base.findings[0]!, quote: "Dugaan setoran mencapai Rp2,3 miliar menurut penyidik." }],
    }),
    model: "test",
  });
  assert.equal(good.edit.verdict, "revise");
  assert.equal(good.edit.findings.find((f) => f.code === "E-FACT")!.severity, "blocking");
});

test("E-FACT tidak memblokir bila konflik sumber sudah dinyatakan", async () => {
  const draft: Draft = {
    ...goodDraft,
    body: [
      goodDraft.body[0]!,
      "Bahan berbeda soal tanggal: satu menyebut 30 Oktober 2026, bahan lain menulis 30 November. Keduanya belum bisa dipastikan.",
      goodDraft.body[2]!,
    ],
    citations: [
      { paragraph: 0, sources: ["s1"] },
      { paragraph: 1, sources: ["s2"] },
      { paragraph: 2, sources: ["s1", "s2"] },
    ],
  };
  const { edit } = await editDraft(draft, pack, assignment, {
    llm: llmReturning({
      verdict: "revise",
      findings: [
        {
          code: "E-FACT",
          severity: "blocking",
          paragraph: 1,
          quote: "Dugaan setoran mencapai Rp2,3 miliar menurut penyidik.",
          issue: "Draft menyebut tanggal yang berbeda dari sumber",
          fix: "Pilih satu tanggal",
        },
      ],
      answers_covered: [0, 1, 2],
      answers_missing: [],
      depth_check: "standard",
      category_check: null,
      notes_resolved: [],
    }),
    model: "test",
  });
  assert.equal(edit.verdict, "approve");
  assert.match(edit.findings.find((f) => f.code === "E-FACT")!.issue, /Konflik sumber/);
});

test("factFailurePolicy membedakan konflik sumber dari fakta terbukti salah", () => {
  const conflict = factFailurePolicy([
    { code: "E-FACT", severity: "blocking", paragraph: 1, quote: "x", issue: "Sumber s1 menyebut mantan, sedangkan s3 menyebut masih menjabat", fix: "-" },
  ]);
  assert.equal(conflict, "disclaimer");

  const wrong = factFailurePolicy([
    { code: "E-FACT", severity: "blocking", paragraph: 1, quote: "x", issue: "Klaim ini salah dan tidak ada di sumber mana pun", fix: "-" },
  ]);
  assert.equal(wrong, "drop");
});

test("temuan editor panjang tidak dipotong ke 300 karakter", async () => {
  const longIssue = "Klaim ini perlu diperiksa karena sumbernya tidak menyebut angka yang sama. ".repeat(10);
  const { edit } = await editDraft(goodDraft, pack, assignment, {
    llm: llmReturning({
      verdict: "revise",
      findings: [
        { code: "E-SRC", severity: "advisory", paragraph: 1, quote: "Kutipan sumber yang panjang ".repeat(10), issue: longIssue, fix: "Perbaiki." },
      ],
      answers_covered: [0, 1, 2],
      answers_missing: [],
      depth_check: "standard",
      category_check: null,
      notes_resolved: [],
    }),
    model: "test",
  });
  const found = edit.findings.find((f) => f.code === "E-SRC");
  assert.ok(found);
  assert.ok(found!.issue.length > 500, "issue editor harus utuh");
});

test("D-TYPO dan D-TRUNC memblokir terbit", () => {
  const draft: Draft = {
    ...goodDraft,
    title: "KPK periksa sembilan kepala kantor pertanahan soal",
    body: [...goodDraft.body.slice(0, 2), "Belum ada bantahan resmi dari pihak yang diperiksa yang yang"],
  };
  const findings = deterministicFindings(draft, pack, assignment);
  assert.ok(findings.some((f) => f.code === "D-TYPO" && f.severity === "blocking"));
  assert.ok(findings.some((f) => f.code === "D-TRUNC" && f.severity === "blocking"));
});

test("notes_resolved hanya menerima kutipan yang ada di draft", async () => {
  const openNotes = [{ id: "n_test", jenis: "coverage_gap", pertanyaan: "Siapa yang diperiksa?", tindakan: "Cari" }];
  const bad = await editDraft(goodDraft, pack, assignment, {
    llm: llmReturning({
      verdict: "approve",
      findings: [],
      answers_covered: [0, 1, 2],
      answers_missing: [],
      depth_check: "standard",
      category_check: null,
      notes_resolved: [{ id: "n_test", quote: "Kalimat ini tidak pernah ada di dalam draft." }],
    }),
    model: "test",
    openNotes,
  });
  assert.equal(bad.edit.notes_resolved.length, 0);

  const good = await editDraft(goodDraft, pack, assignment, {
    llm: llmReturning({
      verdict: "approve",
      findings: [],
      answers_covered: [0, 1, 2],
      answers_missing: [],
      depth_check: "standard",
      category_check: null,
      notes_resolved: [{ id: "n_test", quote: "KPK memeriksa sembilan kepala kantor pertanahan pada Selasa (10/11)." }],
    }),
    model: "test",
    openNotes,
  });
  assert.equal(good.edit.notes_resolved.length, 1);
});

test("editDraft membuang temuan yang menyatakan tidak ada masalah", async () => {
  const { edit } = await editDraft(goodDraft, pack, assignment, {
    llm: llmReturning({
      verdict: "revise",
      findings: [
        { code: "E-ATTR", severity: "blocking", paragraph: 1, quote: "", issue: "Atribusi sudah ada, tidak ada masalah di sini", fix: "-" },
      ],
      answers_covered: [0, 1, 2],
      answers_missing: [],
      depth_check: "standard",
      category_check: null,
    }),
    model: "test",
  });
  assert.equal(edit.findings.some((f) => f.code === "E-ATTR"), false);
});

test("deterministicDesk menggugurkan kartu bermasalah, bukan seluruh edisi", () => {
  const base: DeskCard = {
    card_id: "k1",
    title: "KPK periksa sembilan kepala kantor pertanahan",
    angle: "Dugaan setoran",
    category: "policy",
    depth: "standard",
    body_chars: 900,
    cited_paragraphs: 3,
    paragraphs: 3,
    sources: 3,
    editor_verdict: "approve",
    depth_check: "standard",
    blocking: 0,
  };
  const out = deterministicDesk([base, { ...base, card_id: "k2", blocking: 2 }], { minPublish: 1 });
  assert.equal(out.publish, true);
  assert.ok(out.reasons.some((r) => r.includes("k2")));
  assert.equal(out.rework.length, 1);

  const none = deterministicDesk([{ ...base, blocking: 1 }], { minPublish: 1 });
  assert.equal(none.publish, false);
});

test("deterministicDesk menandai dua kartu dengan sudut sama", () => {
  const base: DeskCard = {
    card_id: "k1",
    title: "KPK periksa sembilan kepala kantor pertanahan",
    angle: "Dugaan setoran",
    category: "policy",
    depth: "standard",
    body_chars: 900,
    cited_paragraphs: 3,
    paragraphs: 3,
    sources: 3,
    editor_verdict: "approve",
    depth_check: "standard",
    blocking: 0,
  };
  const out = deterministicDesk([base, { ...base, card_id: "k2" }]);
  assert.equal(out.publish, true, "sudut kembar adalah advisory, bukan blokir");
  assert.ok(out.advisory.some((r) => r.includes("sudut yang sama")));
});

test("writeDraft membuang sitasi ke id yang tidak ada", async () => {
  const ctx = { assignment, pack, topic, topicId: "t_poc_x", local: false, prior: [] };
  const { draft } = await writeDraft(ctx, {
    llm: llmReturning({
      title: goodDraft.title,
      angle: goodDraft.angle,
      body: goodDraft.body,
      citations: [
        { paragraph: 0, sources: ["s1", "s99"] },
        { paragraph: 1, sources: ["s2"] },
        { paragraph: 2, sources: ["s1"] },
      ],
      action: goodDraft.action,
      claim: goodDraft.claim,
      explain: [{ q: "Apa itu KPK?", a: "Lembaga pemberantasan korupsi di Indonesia.", source_key: "g1" }],
      depth_achieved: "standard",
    }),
    model: "test",
  });
  assert.ok(draft);
  assert.deepEqual(draft!.citations[0]!.sources, ["s1"]);
});

test("writeDraft memotong judul di batas kata, bukan di tengah", async () => {
  const ctx = { assignment, pack, topic, topicId: "t_poc_x", local: false, prior: [] };
  const long = "KPK Periksa Sembilan Kepala Kantor Pertanahan soal Dugaan Setoran Miliaran Rupiah";
  const { draft } = await writeDraft(ctx, {
    llm: llmReturning({
      title: long,
      angle: goodDraft.angle,
      body: goodDraft.body,
      citations: goodDraft.citations,
      action: goodDraft.action,
      claim: goodDraft.claim,
      explain: [{ q: "Apa itu KPK?", a: "Lembaga pemberantasan korupsi di Indonesia.", source_key: "g1" }],
      depth_achieved: "standard",
    }),
    model: "test",
  });
  assert.ok(draft);
  assert.ok(draft!.title.length <= 70);
  assert.doesNotMatch(draft!.title, /\bsoal\b$/i);
});

test("writeDraft membuang sitasi untuk paragraf yang tidak ada", async () => {
  const ctx = { assignment, pack, topic, topicId: "t_poc_x", local: false, prior: [] };
  const { draft } = await writeDraft(ctx, {
    llm: llmReturning({
      title: goodDraft.title,
      angle: goodDraft.angle,
      body: goodDraft.body.slice(0, 2),
      citations: [...goodDraft.citations, { paragraph: 5, sources: ["s1"] }],
      action: goodDraft.action,
      claim: goodDraft.claim,
      explain: [{ q: "Apa itu KPK?", a: "Lembaga pemberantasan korupsi di Indonesia.", source_key: "g1" }],
      depth_achieved: "brief",
    }),
    model: "test",
  });
  assert.ok(draft);
  assert.ok(draft!.citations.every((c) => c.paragraph < draft!.body.length));
});

test("writeDraft menerima body berupa satu string", async () => {
  const ctx = { assignment, pack, topic, topicId: "t_poc_x", local: false, prior: [] };
  const { draft } = await writeDraft(ctx, {
    llm: llmReturning({
      title: goodDraft.title,
      angle: goodDraft.angle,
      body: goodDraft.body.join("\n\n"),
      citations: [{ paragraph: 0, sources: "s1" }],
      action: goodDraft.action,
      claim: goodDraft.claim,
      explain: [{ q: "Apa itu KPK?", a: "Lembaga pemberantasan korupsi di Indonesia.", source_key: "g1" }],
      depth_achieved: "standard",
    }),
    model: "test",
  });
  assert.ok(draft);
  assert.equal(draft!.body.length, 3);
  assert.deepEqual(draft!.citations[0]!.sources, ["s1"]);
});

test("writeDraft tidak membiarkan id bahan bocor ke prosa", async () => {
  const ctx = { assignment, pack, topic, topicId: "t_poc_x", local: false, prior: [] };
  const { draft } = await writeDraft(ctx, {
    llm: llmReturning({
      title: goodDraft.title,
      angle: goodDraft.angle,
      body: [
        "KPK memeriksa sembilan kepala kantor pertanahan (s1) pada Selasa (10/11).",
        "Penyidik menduga ada setoran Rp2,3 miliar menurut s2.",
        "Belum ada bantahan resmi sampai berita ini ditulis.",
      ],
      citations: [
        { paragraph: 0, sources: ["s1"] },
        { paragraph: 1, sources: ["s2"] },
        { paragraph: 2, sources: ["s1", "s2"] },
      ],
      action: goodDraft.action,
      claim: goodDraft.claim,
      explain: [{ q: "Apa itu KPK?", a: "Lembaga pemberantasan korupsi di Indonesia.", source_key: "g1" }],
      depth_achieved: "standard",
    }),
    model: "test",
  });
  assert.ok(draft);
  assert.doesNotMatch(draft!.body.join(" "), /\b[swg]\d+\b/i);
});

test("revisionInstruction tidak meneruskan id bahan ke writer", () => {
  const text = revisionInstruction([
    { code: "E-SRC", severity: "blocking", paragraph: 1, quote: "", issue: "s1 dan s3 tidak mendukung klaim", fix: "Pakai s2" },
  ]);
  assert.doesNotMatch(text, /\bs\d+\b/);
});

test("inventedNumbers mendeteksi angka baru yang tidak ada di bahan", () => {
  const next: Draft = {
    ...goodDraft,
    body: [...goodDraft.body.slice(0, 2), "Kerugian negara disebut mencapai Rp999 miliar."],
  };
  const found = inventedNumbers(goodDraft, next, pack);
  assert.deepEqual(found, ["999"]);
});

test("acceptWithInventedFacts menurunkan E-FACT dan menambah catatan", () => {
  const findings = acceptWithInventedFacts(
    [{ code: "E-FACT", severity: "blocking", paragraph: 1, quote: "x", issue: "bertentangan", fix: "koreksi" }],
    ["999"],
  );
  assert.equal(findings.find((f) => f.code === "E-FACT")!.severity, "advisory");
  assert.equal(findings.find((f) => f.code === "E-INVENT")!.severity, "advisory");
});

test("repairFactDraft mengembalikan draft perbaikan", async () => {
  const ctx = { assignment, pack, topic, topicId: "t_poc_x", local: false, prior: [] };
  const fixed = "KPK memeriksa sembilan kepala kantor pertanahan pada Selasa (10/11). Penyidik menyebut dugaan setoran tanpa menyebut angka pasti.";
  const { draft } = await repairFactDraft(ctx, {
    llm: llmReturning({
      title: goodDraft.title,
      angle: goodDraft.angle,
      body: [fixed, goodDraft.body[1], goodDraft.body[2]],
      citations: goodDraft.citations,
      action: goodDraft.action,
      claim: goodDraft.claim,
      explain: [{ q: "Apa itu KPK?", a: "Lembaga pemberantasan korupsi di Indonesia.", source_key: "g1" }],
      depth_achieved: "standard",
    }),
    model: "test",
    previous: goodDraft,
    findings: [{ code: "E-FACT", severity: "blocking", paragraph: 1, quote: "Rp2,3 miliar", issue: "angka tidak ada di sumber", fix: "hapus angka" }],
  });
  assert.ok(draft);
  assert.match(draft!.body[0]!, /tanpa menyebut angka pasti/);
});

test("writeDraft mengembalikan null bila model gagal", async () => {
  const ctx = { assignment, pack, topic, topicId: "t_poc_x", local: false, prior: [] };
  const { draft } = await writeDraft(ctx, { llm: llmReturning(null, true), model: "test" });
  assert.equal(draft, null);
});

test("planner membatasi note_ids menjadi dua", async () => {
  const candidate = {
    topic,
    cid: "c01",
    articles: 4,
    outlets: ["kompas.com", "detik.com"],
    entities: ["kpk"],
    first_seen: "2026-11-09",
    last_title: null,
    history_topic_id: null,
  };
  const { plan } = await planEdition(
    {
      editionId: "2026-11-11",
      place: "Sleman",
      slots: { nasional: 6, lokal: 4 },
      candidates: [candidate],
      openThreads: [],
      constraints: { maxHeavy: 2, maxMeta: 2 },
    },
    {
      llm: llmReturning({
        assignments: [
          {
            cid: ["c01"],
            title: "KPK periksa kepala pertanahan",
            angle: "Dugaan setoran",
            category: "policy",
            significance: 4,
            heavy: false,
            depth: "standard",
            why_now: "Hari ini",
            answers: ["Siapa yang diperiksa", "Berapa nilai setoran"],
            note_ids: ["n_1", "n_2", "n_3"],
            follow_up_of: null,
            drop: false,
            reason: null,
          },
        ],
      }),
      model: "test",
    },
  );
  assert.deepEqual(plan.assignments[0]!.note_ids, ["n_1", "n_2"]);
});

test("planEdition jatuh ke rencana deterministik bila model gagal", async () => {
  const candidate = {
    topic,
    cid: "c01",
    articles: 4,
    outlets: ["kompas.com", "detik.com"],
    entities: ["kpk"],
    first_seen: "2026-11-09",
    last_title: null,
    history_topic_id: null,
  };
  const input = {
    editionId: "2026-11-11",
    place: "Sleman",
    slots: { nasional: 6, lokal: 4 },
    candidates: [candidate],
    openThreads: [],
    constraints: { maxHeavy: 2, maxMeta: 2 },
  };
  const { plan, usedLlm } = await planEdition(input, { llm: llmReturning(null, true), model: "test" });
  assert.equal(usedLlm, false);
  assert.equal(plan.assignments.length, 1);
  assert.equal(plan.assignments[0]!.cids[0], "c01");
});
