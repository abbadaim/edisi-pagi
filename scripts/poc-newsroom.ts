#!/usr/bin/env node
/**
 * POC newsroom lima peran (NEWSROOM.md §3–§4).
 *
 * Tidak mengubah pipeline produksi. Menulis artefak ke data/work/poc-newsroom/
 * dan membandingkan hasilnya dengan edisi yang sudah terbit pada tanggal sama.
 *
 *   node scripts/poc-newsroom.ts --date 2026-11-10 --limit 3
 *   node scripts/poc-newsroom.ts --date 2026-11-10 --limit 3 --no-fetch
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openSqlite } from "../src/adapters/db/sqlite.ts";
import { clusterArticles, loadArticles, type Cluster } from "../src/core/cluster.ts";
import { adjudicate, summarise, type AdjudicatedTopic } from "../src/core/adjudicate.ts";
import { hashSummaries, loadAdjudication, saveAdjudication } from "../src/core/adjudicate-cache.ts";
import { loadRegistry, slugify } from "../src/core/registry.ts";
import { loadGlossary } from "../src/core/writer.ts";
import { computeTruth } from "../src/core/truth.ts";
import { isoWib } from "../src/core/time.ts";
import { features, similarity } from "../src/core/simhash.ts";
import { resolveLlm } from "../src/adapters/llm/resolve.ts";
import { loadEnvFile } from "../src/config/env.ts";
import { validateEdition } from "../src/core/validate.ts";
import { buildEdition } from "../src/core/assemble.ts";
import type { Card, Edition } from "../src/core/types.ts";
import type {
  Assignment,
  DeskResult,
  Draft,
  EditResult,
  MaterialPack,
  Plan,
  UsageRow,
} from "../src/core/newsroom/contracts.ts";
import { sourcesFromPack } from "../src/core/newsroom/contracts.ts";
import { candidatesFrom, planEdition, type PlanCandidate } from "../src/core/newsroom/plan.ts";
import { buildMaterialPack, expandFromDb } from "../src/core/newsroom/material.ts";
import { repairFactDraft, writeDraft } from "../src/core/newsroom/write.ts";
import { acceptWithInventedFacts, editDraft, factFailurePolicy, inventedNumbers, revisionInstruction } from "../src/core/newsroom/edit.ts";
import { reviewEdition, type DeskCard } from "../src/core/newsroom/desk.ts";
import {
  ageNotes,
  emptyLedger,
  markAnswered,
  mergeLedger,
  noteSummary,
  notesFromEdit,
  questionSimilarity,
  threadMatch,
  openNotes,
  plannerNotes,
  type EditorNote,
  type NoteLedger,
} from "../src/core/newsroom/notes.ts";

const root = new URL("..", import.meta.url).pathname;
loadEnvFile(join(root, ".env.local"));

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) {
    const v = process.argv[i + 1];
    return v && !v.startsWith("--") ? v : "";
  }
  return fallback;
}

const WIB = 7 * 3_600_000;
const date = arg("date") || new Date(Date.now() + WIB).toISOString().slice(0, 10);
const limit = Number(arg("limit") ?? 3);
const maxFetch = Number(arg("max-fetch") ?? 4);
const useFetch = !process.argv.includes("--no-fetch");
const maxRevisions = Number(arg("revisions") ?? 1);

const outRoot = join(root, "data", "work", "poc-newsroom", date);
mkdirSync(outRoot, { recursive: true });

const dbPath = arg("db") || process.env.DATABASE_PATH || join(root, "local.db");
if (!existsSync(dbPath)) {
  console.error(`database tidak ada: ${dbPath}`);
  process.exit(2);
}

const editionPath = join(root, "data", "editions", `${date}.nasional.json`);
const current: Edition | null = existsSync(editionPath)
  ? (JSON.parse(readFileSync(editionPath, "utf8")) as Edition)
  : null;

// Jendela liputan mengikuti edisi yang sudah terbit, supaya perbandingan adil.
const now = current ? new Date(current.coverage.to) : new Date(`${date}T20:00:00+07:00`);
const from = current ? current.coverage.from : new Date(now.getTime() - 24 * 3_600_000).toISOString();
const to = current ? current.coverage.to : now.toISOString();

const ledgerPath = join(root, "data", "work", "poc-newsroom", "ledger.json");
let ledger: NoteLedger = existsSync(ledgerPath)
  ? (JSON.parse(readFileSync(ledgerPath, "utf8")) as NoteLedger)
  : emptyLedger(now);
ledger = ageNotes(ledger, now);

if (process.argv.includes("--rebuild-ledger")) {
  rebuildLedgerFromArtifacts();
  process.exit(0);
}

/**
 * Tempelkan catatan ke edisi POC yang sudah ada, tanpa memanggil model.
 * Berguna setelah ledger dirapikan atau setelah aturan pencocokan berubah.
 */
if (process.argv.includes("--attach-notes")) {
  const file = join(outRoot, "edition.poc.json");
  if (!existsSync(file)) {
    console.error(`tidak ada ${file}`);
    process.exit(2);
  }
  const edition = JSON.parse(readFileSync(file, "utf8")) as Edition;
  let attached = 0;
  for (const card of edition.cards) {
    const open = openNotes(ledger, now)
      .filter(
        (n) =>
          n.kind === "coverage_gap" &&
          (n.topic_id === card.topic_id ||
            threadMatch(n.thread_title, card.title)),
      )
      .slice(0, 3)
      .map((n) => clipText(n.question, 120));
    if (open.length) {
      card.unresolved = open;
      attached++;
    }
  }
  writeFileSync(file, JSON.stringify(edition, null, 2));
  console.log(`catatan ditempel ke ${attached}/${edition.cards.length} kartu`);
  process.exit(0);
}

/** Rapikan field publik pada edisi yang sudah ada tanpa memanggil model. */
if (process.argv.includes("--sanitize-edition")) {
  const file = join(outRoot, "edition.poc.json");
  if (!existsSync(file)) {
    console.error(`tidak ada ${file}`);
    process.exit(2);
  }
  const edition = JSON.parse(readFileSync(file, "utf8")) as Edition;
  let fixed = 0;
  for (const card of edition.cards) {
    if (card.unresolved) {
      const next = card.unresolved.map((q) => clipText(q, 120)).filter((q) => q.length >= 8).slice(0, 3);
      if (JSON.stringify(next) !== JSON.stringify(card.unresolved)) fixed++;
      card.unresolved = next;
    }
    if (card.disclaimer) card.disclaimer = clipText(card.disclaimer, 320);
  }
  writeFileSync(file, JSON.stringify(edition, null, 2));
  console.log(`edisi dirapikan: ${fixed} kartu`);
  process.exit(0);
}

function saveLedger() {
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
}

/** Potong di batas kata agar field publik tidak melewati batas skema. */
function clipText(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
}

/**
 * Bangun ulang ledger dari artefak tanpa memanggil model.
 * Dipakai setelah aturan ekstraksi berubah; hasilnya deterministik.
 */
function rebuildLedgerFromArtifacts() {
  if (process.argv.includes("--fresh-ledger")) ledger = emptyLedger(now);

  const planFile = join(outRoot, "plan.json");
  if (!existsSync(planFile)) {
    console.error(`tidak ada ${planFile}`);
    process.exit(2);
  }
  const plan = JSON.parse(readFileSync(planFile, "utf8")) as Plan;

  const drafts = readdirSync(outRoot).filter((f) => /^draft-.+-(?:desk|trim|\d+)\.json$/.test(f));
  const byTopic = new Map<string, { suffix: string; priority: number }>();
  for (const f of drafts) {
    const m = f.match(/^draft-(.+)-(desk|trim|\d+)\.json$/);
    if (!m || !m[1] || !m[2]) continue;
    const priority = m[2] === "desk" ? 1000 : m[2] === "trim" ? 999 : Number(m[2]);
    const prev = byTopic.get(m[1]);
    if (!prev || priority > prev.priority) byTopic.set(m[1], { suffix: m[2], priority });
  }

  let added = 0;
  let updated = 0;
  for (const [topicId, { suffix }] of byTopic) {
    const draftPath = join(outRoot, `draft-${topicId}-${suffix}.json`);
    const editPath = join(outRoot, `edit-${topicId}-${suffix}.json`);
    if (!existsSync(draftPath) || !existsSync(editPath)) continue;

    const draft = JSON.parse(readFileSync(draftPath, "utf8")) as Draft;
    const finalEdit = JSON.parse(readFileSync(editPath, "utf8")) as EditResult;

    // Temuan dan pertanyaan yang hilang diambil dari revisi numerik terakhir
    // (sebelum penyempitan lingkup), supaya celah yang dibuang tetap tercatat.
    let sourceEdit = finalEdit;
    const numeric = readdirSync(outRoot)
      .map((f) => f.match(new RegExp(`^edit-${topicId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)\\.json$`)))
      .filter((m): m is RegExpMatchArray => Boolean(m))
      .map((m) => Number(m[1]))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a)[0];
    if (numeric) {
      const p = join(outRoot, `edit-${topicId}-${numeric}.json`);
      if (existsSync(p)) sourceEdit = JSON.parse(readFileSync(p, "utf8")) as EditResult;
    }

    const assignment = plan.assignments
      .map((a) => ({ a, score: similarity(features(a.title), features(draft.title)) }))
      .sort((x, y) => y.score - x.score)[0];
    if (!assignment || assignment.score < 0.1) {
      console.log(`  lewati ${topicId}: tidak ada tugas yang cocok`);
      continue;
    }

    const extracted = notesFromEdit({
      editionId: date,
      topicId,
      threadTitle: assignment.a.title,
      assignment: assignment.a,
      draft,
      edit: { ...sourceEdit, notes_resolved: finalEdit.notes_resolved },
      now,
    });
    const merged = mergeLedger(ledger, extracted, now);
    ledger = merged.ledger;
    added += merged.added.length;
    updated += merged.updated.length;
    if (finalEdit.notes_resolved.length > 0) {
      ledger = markAnswered(ledger, finalEdit.notes_resolved, { edition_id: date, card_title: draft.title }, now);
    }
  }

  saveLedger();
  const counts = noteSummary(ledger, now);
  console.log(`ledger dibangun ulang: +${added} baru, ${updated} diperbarui · ${counts.open + counts.waiting} aktif`);
  for (const n of openNotes(ledger, now, { limit: 30 })) {
    console.log(`  [${n.kind}] ${n.question}`);
  }
}


const usage: UsageRow[] = [];
function record(
  role: UsageRow["role"],
  topicId: string | null,
  attempt: number,
  tin: number,
  tout: number,
  provider: string,
  model: string,
) {
  usage.push({ role, topic_id: topicId, attempt, provider, model, tokens_in: tin, tokens_out: tout });
}

function save(name: string, data: unknown) {
  writeFileSync(join(outRoot, name), JSON.stringify(data, null, 2));
}

function kicker(category: string): string {
  const map: Record<string, string> = {
    policy: "Nasional", safety: "Nasional", economy: "Ekonomi",
    health: "Kesehatan", culture: "Budaya", crime: "Kriminal",
    disaster: "Bencana", sport: "Olahraga",
  };
  return map[category] ?? "Nasional";
}

function uniqueFacts(text: string): number {
  const numbers = new Set(text.match(/\b\d[\d.,]*\b/g) ?? []);
  const names = new Set(
    (text.match(/\b[A-Z][a-zA-Z]{3,}\b/g) ?? []).filter((w) => !["Jakarta", "Indonesia"].includes(w)),
  );
  return numbers.size + names.size;
}

function toCard(
  draft: Draft,
  pack: MaterialPack,
  a: Assignment,
  topicId: string,
  firstSeen: string,
  at: Date,
  asDeep = false,
): Card {
  const sources = sourcesFromPack(pack, at);
  const truth = computeTruth(
    { claim: draft.claim, sources, numeric: /\d/.test(draft.title) },
    at,
  );
  const base = {
    id: "c1",
    type: "news" as const,
    topic_id: topicId,
    angle: draft.angle,
    kicker: kicker(a.category),
    title: draft.title,
    status: truth.status,
    truth,
    body: draft.body,
    explain: draft.explain,
    action: draft.action,
    image: null,
    sources,
    place: "nasional",
    revision: 1,
    first_seen: firstSeen,
    previous_edition: null,
    changes: [],
  };

  if (!asDeep) return base as Card;

  const words = draft.body.join(" ").split(/\s+/).filter(Boolean).length;
  return {
    ...base,
    type: "deep_dive",
    dek: draft.dek || draft.claim.slice(0, 150),
    optional: true,
    read_min: Math.min(15, Math.max(4, Math.ceil(words / 200))),
    stats: [
      { value: String(pack.stats.fetched), label: "halaman" },
      { value: String(base.sources.length), label: "media" },
    ],
  } as Card;
}

interface CardWork {
  assignment: Assignment;
  candidate: PlanCandidate;
  cluster: Cluster;
  topicId: string;
  pack: MaterialPack;
  draft: Draft | null;
  edit: EditResult | null;
  card: Card | null;
  revisions: number;
  reworked: boolean;
  /** Catatan tambahan yang tidak berasal dari ledger (mis. angka hasil perbaikan fakta). */
  extraUnresolved: string[];
  /** Peringatan kuat untuk klaim yang sumbernya bertentangan. */
  disclaimer: string | null;
}

const db = openSqlite(dbPath);
try {
  const { llm, model, provider } = resolveLlm(process.env);
  if (!llm) {
    console.error("tidak ada LLM tersedia; POC ini membutuhkan model");
    process.exit(2);
  }
  console.log(`provider ${provider} · model ${model} · editor ${model} (model sama; bandingkan setelah data shadow)`);
  console.log(`jendela ${from} → ${to}\n`);

  const rows = loadArticles(db, from, to);
  const clusters = clusterArticles(rows);
  const summaries = summarise(clusters);
  const clusterByCid = new Map<string, Cluster>();
  summaries.forEach((s, i) => clusterByCid.set(s.cid, clusters[i]!));

  const inputHash = hashSummaries(summaries);
  let adj = loadAdjudication(db, date, inputHash);
  if (!adj) {
    adj = await adjudicate(clusters, { llm, model, date, place: "Sleman" });
    if (!adj.fallback) saveAdjudication(db, date, inputHash, adj, now);
  }
  record("plan", null, 0, adj.usage.tokens_in, adj.usage.tokens_out, adj.fallback ? "fallback" : provider, adj.fallback ? "none" : model);
  console.log(`klaster ${clusters.length} · topik adjudikasi ${adj.topics.length}${adj.fallback ? " (fallback)" : ""}`);

  const history = loadRegistry(db, new Date(now.getTime() - 30 * 86_400_000).toISOString());
  let candidates = candidatesFrom(
    adj.topics.filter((t) => !t.drop),
    clusterByCid,
    history.map((h) => ({
      topic_id: h.topic_id,
      canonical_title: h.canonical_title,
      first_seen: h.first_seen,
      revision: h.revision,
    })),
  ).sort(
    (a, b) =>
      b.topic.significance - a.topic.significance ||
      b.articles - a.articles ||
      b.outlets.length - a.outlets.length,
  );

  // Batasi prompt planner, bukan kandidat final.
  candidates = candidates.slice(0, 30);
  if (candidates.length === 0) {
    console.error("tidak ada kandidat topik");
    process.exit(1);
  }

  const openThreads = candidates
    .filter((c) => c.first_seen)
    .map((c) => ({ title: c.topic.title, first_seen: c.first_seen!, last_used: null }));

  const planStart = Date.now();
  const { plan, usedLlm } = await planEdition(
    {
      editionId: date,
      place: "Sleman",
      slots: { nasional: 6, lokal: 4 },
      candidates,
      openThreads,
      openNotes: plannerNotes(ledger, now),
      constraints: { maxHeavy: 2, maxMeta: 2 },
    },
    { llm, model },
  );
  save("plan.json", plan);
  console.log(`planner ${usedLlm ? "llm" : "fallback"} · ${plan.assignments.length} tugas · ${Date.now() - planStart} ms`);
  const noteCounts = noteSummary(ledger, now);
  console.log(
    `catatan editor: ${noteCounts.open} terbuka · ${noteCounts.waiting} menunggu · ${noteCounts.answered} terjawab\n`,
  );
  if (process.argv.includes("--plan-only")) {
    writeFileSync(join(outRoot, "plan-only.json"), JSON.stringify({ plan, notes: plannerNotes(ledger, now) }, null, 2));
    for (const a of plan.assignments) {
      console.log(`  ${a.depth.padEnd(8)} ${a.title}`);
      if (a.note_ids.length) console.log(`           menutup catatan: ${a.note_ids.join(", ")}`);
    }
    db.close();
    process.exit(0);
  }

  const chosen = plan.assignments
    .filter((a) => !a.drop)
    .map((a) => {
      const c = candidates.find((x) => x.cid === a.cids[0]);
      const cluster = a.cids[0] ? clusterByCid.get(a.cids[0]) : undefined;
      return c && cluster ? { a, c, cluster } : null;
    })
    .filter((x): x is { a: Assignment; c: PlanCandidate; cluster: Cluster } => Boolean(x))
    .sort(
      (x, y) =>
        y.a.significance - x.a.significance ||
        y.c.articles - x.c.articles ||
        y.a.answers.length - x.a.answers.length,
    )
    .slice(0, limit);

  if (chosen.length === 0) {
    console.error("planner tidak menyisakan tugas yang bisa ditulis");
    process.exit(1);
  }

  const glossary = loadGlossary(join(root, "config", "glossary.yaml"));
  const works: CardWork[] = [];
  const usedTopicIds = new Set<string>();

  for (const { a, c, cluster } of chosen) {
    let topicId = c.history_topic_id ?? `t_poc_${slugify(a.title).slice(0, 40)}`;
    if (usedTopicIds.has(topicId)) topicId = `${topicId}_${usedTopicIds.size + 1}`;
    usedTopicIds.add(topicId);

    const noteRefs = openNotes(ledger, now)
      .filter(
        (n) =>
          n.topic_id === topicId ||
          threadMatch(n.thread_title, a.title),
      )
      .map((n) => ({ id: n.id, jenis: n.kind, pertanyaan: n.question, tindakan: n.next_action }));
    const at = new Date(now);
    console.log(`— ${a.title} · ${a.depth} · ${c.articles} artikel`);

    const pack = await buildMaterialPack(a2topic(a, c), cluster, topicId, glossary, {
      maxFetch,
      fetchImpl: useFetch ? undefined : async () => ({ text: "", ok: false }),
    });
    save(`material-${topicId}.json`, pack);

    const prior = current
      ? current.cards
          .filter((card) => similarity(features(a.title), features(card.title)) >= 0.3)
          .map((card) => `${card.title}: ${card.body[0]?.slice(0, 220) ?? ""}`)
      : [];

    console.log(
      `  riset: ${pack.stats.fetched} halaman penuh, ${pack.stats.failed} gagal · ${pack.stats.lead_chars} → ${pack.stats.material_chars} karakter`,
    );

    const work: CardWork = {
      assignment: a,
      candidate: c,
      cluster,
      topicId,
      pack,
      draft: null,
      edit: null,
      card: null,
      revisions: 0,
      reworked: false,
      extraUnresolved: [],
      disclaimer: null,
    };

    const first = await writeDraft(
      { assignment: a, pack, topic: a2topic(a, c), topicId, local: false, prior },
      { llm, model },
    );
    record("write", topicId, 1, first.tokens_in, first.tokens_out, provider, model);
    let draft = first.draft;

    // Writer minta bahan tambahan: satu putaran deterministik dari database.
    if (draft && draft.needs.length > 0) {
      const extra = expandFromDb(db, pack, draft.needs, from, to, 3);
      if (extra.length > 0) {
        pack.items.push(...extra);
        pack.stats.material_chars += extra.reduce((n, i) => n + i.chars, 0);
        console.log(`  bahan tambahan: ${extra.length} artikel untuk "${draft.needs[0]?.slice(0, 50)}"`);
        const second = await writeDraft(
          { assignment: a, pack, topic: a2topic(a, c), topicId, local: false, prior },
          { llm, model },
        );
        record("write", topicId, 2, second.tokens_in, second.tokens_out, provider, model);
        if (second.draft) draft = second.draft;
      }
    }

    if (!draft) {
      console.log("  ✗ writer tidak menghasilkan draft");
      works.push(work);
      continue;
    }
    work.draft = draft;
    save(`draft-${topicId}-1.json`, draft);

    let review = await editDraft(draft, pack, a, { llm, model, openNotes: noteRefs });
    record("edit", topicId, 1, review.tokens_in, review.tokens_out, provider, model);
    work.edit = review.edit;
    save(`edit-${topicId}-1.json`, review.edit);

    let round = 1;
    while (
      (review.edit.verdict === "revise" || review.edit.verdict === "reject") &&
      round <= maxRevisions
    ) {
      const instruction = revisionInstruction(review.edit.findings);
      if (!instruction) break;
      console.log(`  revisi ${round}: ${review.edit.findings.filter((f) => f.severity === "blocking").length} temuan blocking`);

      const rev = await writeDraft(
        { assignment: a, pack, topic: a2topic(a, c), topicId, local: false, prior },
        { llm, model, previous: draft, findings: instruction },
      );
      record("revise", topicId, round, rev.tokens_in, rev.tokens_out, provider, model);
      if (!rev.draft) break;
      draft = rev.draft;
      work.draft = draft;
      work.revisions = round;
      save(`draft-${topicId}-${round + 1}.json`, draft);

      review = await editDraft(draft, pack, a, { llm, model, openNotes: noteRefs });
      record("edit", topicId, round + 1, review.tokens_in, review.tokens_out, provider, model);
      work.edit = review.edit;
      save(`edit-${topicId}-${round + 1}.json`, review.edit);
      round++;
    }

    // Fakta salah diberi kesempatan diperbaiki SEBELUM kartu digugurkan.
    const factFindings = review.edit.findings.filter((f) => f.code === "E-FACT" && f.severity === "blocking");
    if (factFindings.length > 0) {
      console.log(`  perbaikan fakta: ${factFindings.length} temuan`);
      const beforeRepair = draft;
      const repair = await repairFactDraft(
        { assignment: a, pack, topic: a2topic(a, c), topicId, local: false, prior },
        { llm, model, previous: draft, findings: factFindings },
      );
      record("revise", topicId, 98, repair.tokens_in, repair.tokens_out, provider, model);

      if (repair.draft) {
        draft = repair.draft;
        work.draft = draft;
        save(`draft-${topicId}-fact.json`, draft);
        review = await editDraft(draft, pack, a, { llm, model, openNotes: noteRefs });
        record("edit", topicId, 98, review.tokens_in, review.tokens_out, provider, model);
        work.edit = review.edit;
        save(`edit-${topicId}-fact.json`, review.edit);

        const stillFact = review.edit.findings.filter((f) => f.code === "E-FACT" && f.severity === "blocking");
        if (stillFact.length > 0) {
          const invented = inventedNumbers(beforeRepair, draft, pack);
          if (invented.length > 0) {
            // Kebijakan: jangan gugurkan kartu karena writer mencoba mengarang.
            // Terbitkan dengan catatan, dan turunkan E-FACT ke advisory.
            review.edit.findings = acceptWithInventedFacts(review.edit.findings, invented);
            review.edit.verdict = review.edit.findings.some((f) => f.severity === "blocking") ? "revise" : "approve";
            work.extraUnresolved.push(...invented.slice(0, 3).map((n) => `Angka atau detail "${n}" belum ada di bahan`));
            console.log(`  fakta masih bertentangan, tetapi ada detail baru (${invented.join(", ")}) → terbit dengan catatan`);
          } else {
            const policy = factFailurePolicy(review.edit.findings);
            if (policy === "disclaimer") {
              // Sumber saling bertentangan / belum pasti, bukan fakta yang terbukti salah.
              // Terbitkan dengan disclaimer kuat; jangan sembunyikan ketidakpastian.
              review.edit.findings = acceptWithInventedFacts(review.edit.findings, []);
              review.edit.verdict = review.edit.findings.some((f) => f.severity === "blocking") ? "revise" : "approve";
              work.disclaimer =
                "Artikel ini memuat klaim yang sumbernya saling bertentangan atau belum dapat dipastikan. " +
                "Artikel tetap terbit untuk konteks, bukan sebagai rujukan. " +
                "Jangan mengutip klaim yang diperdebatkan tanpa memeriksa sumber primer.";
              work.extraUnresolved.push(
                ...stillFact.slice(0, 2).map((f) => clipText(`Belum pasti: ${f.quote || f.issue}`, 120)),
              );
              console.log("  konflik sumber tidak bisa diselesaikan → terbit dengan disclaimer");
            } else {
              console.log("  fakta terbukti salah dan tidak bisa diperbaiki → kartu digugurkan");
            }
          }
        }
      }
    }

    works.push(work);
    const missingBeforeTrim = review.edit.answers_missing.slice();

    // Batas revisi tercapai: turunkan ambisi tugas, jangan menambah putaran.
    // Pertanyaan yang tidak terjawab dari bahan dibuang, kedalaman diturunkan.
    if (review.edit.verdict !== "approve" && review.edit.answers_missing.length > 0) {
      const kept = review.edit.answers_covered
        .map((i) => a.answers[i])
        .filter((x): x is string => Boolean(x));
      if (kept.length >= 2) {
        const trimmed: Assignment = {
          ...a,
          title: draft.title,
          angle: draft.angle,
          answers: kept.slice(0, 4),
          depth:
            review.edit.depth_check === "too_thin"
              ? a.depth === "deep"
                ? "standard"
                : "brief"
              : a.depth,
        };
        console.log(
          `  sempitkan: ${a.answers.length} → ${trimmed.answers.length} pertanyaan, depth ${a.depth} → ${trimmed.depth}`,
        );
        const rev = await writeDraft(
          { assignment: trimmed, pack, topic: a2topic(trimmed, c), topicId, local: false, prior },
          { llm, model, previous: draft, findings: revisionInstruction(review.edit.findings) },
        );
        record("revise", topicId, 99, rev.tokens_in, rev.tokens_out, provider, model);
        if (rev.draft) {
          draft = rev.draft;
          work.draft = draft;
          work.assignment = trimmed;
          save(`draft-${topicId}-trim.json`, draft);
          review = await editDraft(draft, pack, trimmed, { llm, model, openNotes: noteRefs });
          record("edit", topicId, 99, review.tokens_in, review.tokens_out, provider, model);
          work.edit = review.edit;
          save(`edit-${topicId}-trim.json`, review.edit);
        }
      }
    }

    // Catat utang liputan: pertanyaan yang tidak dijawab bahan dan klaim yang
    // belum terverifikasi. Memakai tugas ASLI, bukan versi yang sudah disempitkan.
    const editForNotes: EditResult = {
      ...review.edit,
      answers_missing: missingBeforeTrim.length ? missingBeforeTrim : review.edit.answers_missing,
    };
    const extracted = notesFromEdit({
      editionId: date,
      topicId,
      threadTitle: a.title,
      assignment: a,
      draft,
      edit: editForNotes,
      now: new Date(now),
    });
    const merged = mergeLedger(ledger, extracted, new Date(now));
    ledger = merged.ledger;
    if (review.edit.notes_resolved.length > 0) {
      ledger = markAnswered(
        ledger,
        review.edit.notes_resolved,
        { edition_id: date, card_title: draft.title },
        new Date(now),
      );
    }
    saveLedger();
    if (extracted.length > 0) {
      console.log(
        `  catatan: +${merged.added.length} baru, ${merged.updated.length} diperbarui · ${extracted.length} dari kartu ini`,
      );
    }

    const blocking = review.edit.findings.filter((f) => f.severity === "blocking");
    console.log(
      `  ${review.edit.verdict} · ${blocking.length} blocking, ${review.edit.findings.length - blocking.length} advisory · ${draft.body.join(" ").length} karakter`,
    );
  }

  const written = works.filter((w) => w.draft && w.edit);

  // Satu deep_dive per edisi (SCHEMA.md §7 aturan 14). Sisanya tetap news 3 paragraf.
  const deepIdx = written.findIndex(
    (w) => w.draft!.depth_achieved === "deep" && sourcesFromPack(w.pack, new Date(now)).length >= 3,
  );
  function attachDisclaimer(w: CardWork) {
    if (!w.card || w.disclaimer || !w.edit) return;
    const uncertain = w.edit.findings.filter(
      (f) =>
        ["E-FACT", "E-SRC", "E-ATTR", "E-CAUS"].includes(f.code) &&
        /(bertentangan|belum konsisten|berbeda|tidak ditemukan|tidak ada di bahan|tidak didukung|versi|sedangkan|padahal|masih menjabat|eksplisit menyebut)/i.test(f.issue),
    );
    if (uncertain.length === 0) return;
    const items = uncertain.slice(0, 2).map((f) =>
      f.issue
        .replace(/^Terbit dengan (disclaimer|catatan)[^:]*:\s*/i, "")
        .replace(/\b[swg]\d+\b/gi, "bahan")
        .slice(0, 110),
    );
    w.disclaimer =
      `Artikel ini memuat klaim yang sumbernya saling bertentangan atau belum dapat dipastikan: ${items.join("; ")}. ` +
      "Artikel tetap terbit untuk konteks, bukan sebagai rujukan. " +
      "Jangan mengutip klaim tersebut sebagai fakta tanpa memeriksa sumber primer.";
    w.card = { ...w.card, disclaimer: w.disclaimer } as Card;
  }

  function attachUnresolved(w: CardWork) {
    if (!w.card) return;
    const open = openNotes(ledger, now)
      .filter(
        (n) =>
          n.kind === "coverage_gap" &&
          (n.topic_id === w.topicId ||
            threadMatch(n.thread_title, w.assignment.title)),
      )
      .slice(0, 3)
      .map((n) => n.question);
    const all = [...open, ...w.extraUnresolved]
      .map((q) => clipText(q, 120))
      .filter((q) => q.length >= 8)
      .slice(0, 3);
    if (w.disclaimer) w.card = { ...w.card, disclaimer: clipText(w.disclaimer, 320) } as Card;
    if (all.length) w.card = { ...w.card, unresolved: all } as Card;
  }

  written.forEach((w, i) => {
    const asDeep = i === deepIdx;
    w.card = toCard(w.draft!, w.pack, w.assignment, w.topicId, w.candidate.first_seen ?? date, new Date(now), asDeep);
    attachDisclaimer(w);
    attachUnresolved(w);
    if (asDeep) console.log(`deep_dive: ${w.assignment.title}`);
  });

  const deskCards: DeskCard[] = written.map((w, i) => {
    const d = w.draft!;
    const cited = d.body.map((_, p) => d.citations.some((c) => c.paragraph === p)).filter(Boolean).length;
    return {
      card_id: `k${i + 1}`,
      title: d.title,
      angle: d.angle,
      category: w.assignment.category,
      depth: d.depth_achieved,
      body_chars: d.body.join(" ").length,
      cited_paragraphs: cited,
      paragraphs: d.body.length,
      sources: w.card!.sources.length,
      editor_verdict: w.edit!.verdict,
      depth_check: w.edit!.depth_check,
      blocking: w.edit!.findings.filter((f) => f.severity === "blocking").length,
    };
  });

  const desk = await reviewEdition(deskCards, { llm, model });
  record("desk", null, 0, desk.tokens_in, desk.tokens_out, provider, model);
  save("desk.json", desk.desk);
  save("usage.json", usage);
  saveLedger();
  console.log(`\ndesk: ${desk.desk.publish ? "terbit" : "rework"} · ${desk.desk.reasons.length} alasan · ${desk.desk.advisory.length} advisory`);
  for (const r of desk.desk.reasons) console.log(`  · ${r}`);
  for (const r of desk.desk.advisory.slice(0, 5)) console.log(`  ~ ${r}`);

  // Satu putaran rework: kirim temuan desk + editor ke writer, lalu terima.
  if (!desk.desk.publish && desk.desk.rework.length > 0) {
    for (const r of desk.desk.rework.slice(0, 2)) {
      const idx = Number(r.card_id.replace(/\D/g, "")) - 1;
      const w = written[idx];
      if (!w || !w.draft || !w.edit) continue;
      const instruction = revisionInstruction(w.edit.findings) + `\n- [DESK] ${r.instruction}`;
      const rev = await writeDraft(
        { assignment: w.assignment, pack: w.pack, topic: a2topic(w.assignment, w.candidate), topicId: w.topicId, local: false, prior: [] },
        { llm, model, findings: instruction },
      );
      record("revise", w.topicId, 90, rev.tokens_in, rev.tokens_out, provider, model);
      if (!rev.draft) continue;
      const keepDeep = written[deepIdx] === w;
      w.draft = rev.draft;
      w.reworked = true;
      const reworkRefs = openNotes(ledger, new Date(now))
        .filter((n) => n.topic_id === w.topicId || threadMatch(n.thread_title, w.assignment.title))
        .map((n) => ({ id: n.id, jenis: n.kind, pertanyaan: n.question, tindakan: n.next_action }));
      const edit = await editDraft(rev.draft, w.pack, w.assignment, { llm, model, openNotes: reworkRefs });
      record("edit", w.topicId, 90, edit.tokens_in, edit.tokens_out, provider, model);
      w.edit = edit.edit;
      w.card = toCard(w.draft, w.pack, w.assignment, w.topicId, w.candidate.first_seen ?? date, new Date(now), keepDeep);
      save(`draft-${w.topicId}-desk.json`, rev.draft);
      save(`edit-${w.topicId}-desk.json`, edit.edit);
      attachDisclaimer(w);
      attachUnresolved(w);
      console.log(`  rework ${r.card_id}: ${edit.edit.verdict}`);
    }
  }

  written.forEach((w) => {
    attachDisclaimer(w);
    attachUnresolved(w);
  });

  // --- edisi POC ---
  // Hanya kartu tanpa temuan blocking (fakta salah / typo / terpotong) yang terbit.
  const publishable = written.filter(
    (w) => w.card && w.edit!.verdict !== "reject" && w.edit!.findings.every((f) => f.severity !== "blocking"),
  );
  const blocked = written.filter((w) => !publishable.includes(w));
  const cards = publishable.map((w) => w.card!).filter(Boolean);
  const generatedBy = {
    adjudicate: { provider: adj.fallback ? "fallback" : provider, model: adj.fallback ? "none" : model },
    write: { provider, model },
    verify: { provider, model: model },
    embed: { provider: "none", model: "none" },
  };
  const pocEdition = buildEdition({
    scope: "nasional",
    editionId: date,
    publishedAt: isoWib(now)!,
    coverage: { from, to },
    generatedAt: isoWib(new Date())!,
    place: { kabupaten: "Sleman", province: "DI Yogyakarta" },
    cards,
    truncatedReason:
      cards.length < 5
        ? `POC ${cards.length} kartu; bukan edisi penuh`
        : cards.length < 8
          ? `Hanya ${cards.length} kartu yang lolos`
          : null,
    generatedBy,
  });
  save("edition.poc.json", pocEdition);

  const check = validateEdition(pocEdition);
  const cardErrors = check.errors.filter((e) => e.path.startsWith("/cards"));
  console.log(`\nvalidasi kartu: ${cardErrors.length === 0 ? "✓ lolos" : `✗ ${cardErrors.length} masalah`}`);
  for (const e of cardErrors.slice(0, 10)) console.log(`  ${e.code} ${e.path}: ${e.message ?? ""}`);

  // --- perbandingan ---
  const oldCards = current ? current.cards.filter((c) => c.type === "news" || c.type === "deep_dive") : [];
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const fmt = (n: number, d = 0) => n.toFixed(d);

  const oldText = oldCards.map((c) => c.body.join(" "));
  const newText = written.map((w) => w.draft!.body.join(" "));

  const rowsCmp: Array<[string, string, string]> = [
    ["kartu", String(oldCards.length), String(cards.length)],
    ["kartu gugur (fakta/typo/terpotong)", "—", String(blocked.length)],
    ["rata-rata karakter body", fmt(avg(oldText.map((t) => t.length))), fmt(avg(newText.map((t) => t.length)))],
    ["rata-rata fakta unik", fmt(avg(oldText.map(uniqueFacts)), 1), fmt(avg(newText.map(uniqueFacts)), 1)],
    ["rata-rata sumber", fmt(avg(oldCards.map((c) => c.sources.length)), 1), fmt(avg(written.map((w) => w.card!.sources.length)), 1)],
    ["kartu dengan tier 1", String(oldCards.filter((c) => c.sources.some((s) => s.tier === 1)).length), String(written.filter((w) => w.card!.sources.some((s) => s.tier === 1)).length)],
    ["rata-rata pertanyaan konteks", fmt(avg(oldCards.map((c) => c.explain?.length ?? 0)), 1), fmt(avg(written.map((w) => w.draft!.explain.length)), 1)],
    ["paragraf bersitasi", "0 (tidak ada field)", `${written.filter((w) => w.draft!.body.every((_, p) => w.draft!.citations.some((c) => c.paragraph === p))).length}/${written.length} kartu`],
    ["rata-rata bahan (karakter)", fmt(avg(written.map((w) => w.pack.stats.lead_chars))), fmt(avg(written.map((w) => w.pack.stats.material_chars)))],
  ];

  const report = [
    `# POC newsroom — ${date}`,
    "",
    `Model: \`${provider}/${model}\` · editor: \`${model}\``,
    `Jendela: ${from} → ${to}`,
    "",
    "## Perbandingan dengan edisi terbit",
    "",
    `| Metrik | Edisi terbit | POC 5 peran |`,
    `|---|---:|---:|`,
    ...rowsCmp.map(([a, b, c]) => `| ${a} | ${b} | ${c} |`),
    "",
    "> Baris \"bahan\" membandingkan lead yang tersedia untuk writer lama (edisi terbit) dengan teks penuh yang tersedia setelah riset (POC).",
    "",
    "## Kartu POC",
    "",
  ];

  const ready = written.filter(
    (w) =>
      w.edit!.verdict === "approve" &&
      w.edit!.findings.every((f) => f.severity !== "blocking"),
  );

  report.push(
    "## Gerbang terbit",
    "",
    `- vonis desk: **${desk.desk.publish ? "terbit" : "tidak terbit"}**${desk.desk.reasons.length ? ` — ${desk.desk.reasons.join("; ")}` : ""}`,
    `- kartu siap terbit (approve tanpa blocking): **${ready.length}/${written.length}**`,
    `- kartu gugur: **${blocked.length}** (${blocked.map((w) => w.assignment.title).join("; ") || "tidak ada"})`,
    `- kartu dengan kotak "Yang belum terjawab": **${cards.filter((c) => c.unresolved?.length).length}/${cards.length}**`,
    `- kartu dengan disclaimer kuat: **${cards.filter((c) => c.disclaimer).length}/${cards.length}**`,
    "",
    ...(desk.desk.advisory.length
      ? ["**Advisory set-level (tidak memblokir):**", "", ...desk.desk.advisory.map((a) => `- ${a}`), ""]
      : []),
  );

  const activeNotes = openNotes(ledger, now, { limit: 20 });
  const counts = noteSummary(ledger, now);
  report.push(
    "## Catatan editor untuk edisi berikutnya",
    "",
    `Terbuka **${counts.open}**, menunggu **${counts.waiting}**, terjawab **${counts.answered}**. ` +
      "Catatan ini tidak masuk `edition.json`; ia menjadi bahan planner pada hari berikutnya.",
    "",
  );
  if (activeNotes.length === 0) {
    report.push("Tidak ada catatan terbuka.", "");
  } else {
    report.push("| Jenis | Topik | Pertanyaan / klaim | Umur | Coba | Tindakan |", "|---|---|---|---:|---:|---|");
    for (const n of activeNotes) {
      const age = Math.max(0, Math.round((now.getTime() - Date.parse(n.first_seen)) / 86_400_000));
      report.push(
        `| ${n.kind} | ${n.thread_title} | ${n.question.replace(/\|/g, "/")} | ${age} hari | ${n.attempts} | ${n.next_action.replace(/\|/g, "/")} |`,
      );
    }
    report.push("");
  }

  for (const w of written) {
    const d = w.draft!;
    const e = w.edit!;
    report.push(
      `### ${d.title}`,
      "",
      `- sudut: ${d.angle}`,
      `- depth: ${d.depth_achieved} · ${d.body.join(" ").length} karakter · ${w.card!.sources.length} sumber`,
      `- sitasi: ${d.body.map((_, p) => (d.citations.some((c) => c.paragraph === p) ? "✓" : "✗")).join(" ")}`,
      `- editor: **${e.verdict}** · ${e.findings.filter((f) => f.severity === "blocking").length} blocking · jawaban tertutup ${e.answers_covered.length}/${w.assignment.answers.length}`,
      "",
      ...d.body.map((p) => `${p}\n`),
      e.findings.length
        ? `**Temuan editor**\n\n${e.findings.map((f) => `- \`${f.code}\` (${f.severity}) ${f.paragraph !== null ? `¶${f.paragraph}` : ""}: ${f.issue}${f.fix ? ` → ${f.fix}` : ""}`).join("\n")}`
        : "**Temuan editor:** tidak ada",
      "",
    );
  }

  report.push(
    "## Catatan",
    "",
    `- token: ${usage.reduce((n, u) => n + u.tokens_in, 0)} masuk / ${usage.reduce((n, u) => n + u.tokens_out, 0)} keluar dalam ${usage.length} panggilan`,
    `- kartu gugur: ${works.filter((w) => !w.card).length}`,
    `- rework desk: ${works.filter((w) => w.reworked).length}`,
    "",
  );

  writeFileSync(join(outRoot, "report.md"), report.join("\n"));

  console.log("\nmetrik");
  for (const [a, b, c] of rowsCmp) console.log(`  ${a.padEnd(30)} ${b.padStart(14)} → ${c}`);
  console.log(`\ntoken ${usage.reduce((n, u) => n + u.tokens_in, 0)} masuk / ${usage.reduce((n, u) => n + u.tokens_out, 0)} keluar · ${usage.length} panggilan`);
  console.log(`catatan editor: ${counts.open} terbuka · ${counts.waiting} menunggu · ${counts.answered} terjawab`);
  console.log(`artefak: ${outRoot}`);
  console.log(`ledger: ${ledgerPath}`);
} finally {
  db.close();
}

/** AdjudicatedTopic sintetis dari assignment, agar modul lama bisa dipakai. */
function a2topic(a: Assignment, c: PlanCandidate): AdjudicatedTopic {
  return {
    ...c.topic,
    cids: a.cids,
    title: a.title,
    angle: a.angle,
    category: a.category,
    significance: a.significance,
    heavy: a.heavy,
  };
}
