/**
 * Satu kartu newsroom: riset → writer → editor → repair fakta → siap terbit.
 * Dipakai oleh `build.ts` di balik `--newsroom` (NEWSROOM-IMPLEMENTATION.md P1).
 */

import type { Db } from "../../adapters/db/sqlite.ts";
import type { LlmAdapter } from "../../adapters/llm/types.ts";
import type { AdjudicatedTopic, TopicCategory } from "../adjudicate.ts";
import type { Cluster } from "../cluster.ts";
import type { Glossary } from "../writer.ts";
import { localKicker } from "../rank.ts";
import { computeTruth } from "../truth.ts";
import { isoWib } from "../time.ts";
import type { Card } from "../types.ts";
import type { LlmTelemetry } from "../telemetry.ts";
import type { FetchCache } from "./cache.ts";
import { findPrimarySources, type PrimarySourceConfig } from "./primary.ts";
import type { Assignment, Draft, EditResult, MaterialPack } from "./contracts.ts";
import { sourcesFromPack } from "./contracts.ts";
import { buildMaterialPack, expandFromDb } from "./material.ts";
import { repairFactDraft, writeDraft } from "./write.ts";
import {
  acceptWithInventedFacts,
  editDraft,
  factFailurePolicy,
  inventedNumbers,
  revisionInstruction,
  type OpenNoteRef,
} from "./edit.ts";
import { notesFromEdit, type EditorNote } from "./notes.ts";

export interface WriteNewsroomCardInput {
  editionId: string;
  now: Date;
  topic: AdjudicatedTopic;
  topicId: string;
  cluster: Cluster;
  assignment: Assignment;
  local: boolean;
  revision: number;
  firstSeen: string;
  previousEdition: string | null;
  prior: string[];
  /** Catatan terbuka untuk topik ini (coverage/verification/risk). */
  openNotes: EditorNote[];
  /** Catatan yang ditautkan planner; bila ada, hanya ini yang boleh ditutup editor. */
  noteIds?: string[];
  asDeep: boolean;
  fromIso: string;
  toIso: string;
  maxFetch?: number;
  fetchImpl?: (url: string) => Promise<{ text: string; ok: boolean }>;
  /** Batas putaran revisi. Default 2. */
  maxRevisions?: number;
}

export interface WriteNewsroomCardResult {
  card: Card | null;
  draft: Draft | null;
  edit: EditResult | null;
  pack: MaterialPack;
  notes: EditorNote[];
  disclaimer: string | null;
  /** true hanya bila kartu digugurkan karena fakta terbukti salah. */
  blocked: boolean;
  revisions: number;
}

const KICKER: Record<TopicCategory, string> = {
  policy: "Nasional",
  safety: "Nasional",
  economy: "Ekonomi",
  health: "Kesehatan",
  culture: "Budaya",
  crime: "Kriminal",
  disaster: "Bencana",
  sport: "Olahraga",
};

function clipText(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
}

function wordCount(body: string[]): number {
  return body.join(" ").split(/\s+/).filter(Boolean).length;
}

function refs(notes: EditorNote[]): OpenNoteRef[] {
  return notes.map((n) => ({
    id: n.id,
    jenis: n.kind,
    pertanyaan: n.question,
    tindakan: n.next_action,
  }));
}

function disclaimerFrom(edit: EditResult): string | null {
  const uncertain = edit.findings.filter(
    (f) =>
      ["E-FACT", "E-SRC", "E-ATTR", "E-CAUS"].includes(f.code) &&
      /(bertentangan|belum konsisten|berbeda|tidak ditemukan|tidak ada di bahan|tidak didukung|versi|sedangkan|padahal|masih menjabat|eksplisit menyebut)/i.test(f.issue),
  );
  if (uncertain.length === 0) return null;

  const items = uncertain.slice(0, 2).map((f) =>
    f.issue
      .replace(/^Terbit dengan (disclaimer|catatan)[^:]*:\s*/i, "")
      .replace(/\b[swg]\d+\b/gi, "bahan")
      .slice(0, 110),
  );

  return clipText(
    `Artikel ini memuat klaim yang sumbernya saling bertentangan atau belum dapat dipastikan: ${items.join("; ")}. ` +
      "Artikel tetap terbit untuk konteks, bukan sebagai rujukan. " +
      "Jangan mengutip klaim tersebut sebagai fakta tanpa memeriksa sumber primer.",
    320,
  );
}

function toCard(
  draft: Draft,
  pack: MaterialPack,
  input: WriteNewsroomCardInput,
  disclaimer: string | null,
  extraUnresolved: string[],
): Card | null {
  // Hanya bahan yang benar-benar disitasi yang masuk `sources`. Bahan primer
  // yang tidak dikutip tidak boleh menaikkan status keyakinan.
  const citedIds = new Set(draft.citations.flatMap((c) => c.sources));
  const cited = pack.items.filter((i) => i.kind !== "background" && citedIds.has(i.id));
  const chosen = cited.length > 0 ? cited : pack.items.filter((i) => i.kind !== "background");
  const sources = sourcesFromPack({ ...pack, items: chosen }, input.now);
  if (sources.length === 0) return null;

  // Topik tanpa glosarium/Wikipedia tetap harus punya 2 pertanyaan konteks
  // (validator E017). Isi dari bahan artikel, bukan dari model. Topik lokal
  // sering hanya punya satu artikel; dua pertanyaan boleh memakai sumber yang
  // sama asalkan jawabannya berasal dari bahan.
  let explain = [...draft.explain];
  if (explain.length < 2) {
    const first = pack.items.find((i) => i.kind !== "background" && i.text.length >= 20);
    if (!first) return null;
    const base = first.text.trim();
    const answer = (s: string) => clipText(s.length >= 40 ? s : `${s} ${input.topic.angle}`, 420);
    const q1 = clipText(`Apa yang perlu diketahui tentang ${input.assignment.title}`, 89).replace(/\?+$/, "") + "?";
    const q2 = input.local
      ? "Mengapa peristiwa ini penting bagi Sleman atau DIY?"
      : "Apa konteks peristiwa ini?";
    const candidates = [
      { q: q1, a: answer(base), source: { outlet: first.outlet, url: first.url } },
      { q: q2, a: answer(`${input.topic.angle}. ${base}`), source: { outlet: first.outlet, url: first.url } },
    ];
    for (const c of candidates) {
      if (explain.length >= 2) break;
      if (explain.some((e) => e.q.toLowerCase() === c.q.toLowerCase())) continue;
      explain.push(c);
    }
  }
  if (explain.length < 2) return null;

  const truth = computeTruth(
    { claim: draft.claim, sources, numeric: /\d/.test(draft.title) },
    input.now,
  );

  const unresolved = [
    ...input.openNotes.filter((n) => n.kind === "coverage_gap").map((n) => n.question),
    ...extraUnresolved,
  ]
    .map((q) => clipText(q, 120))
    .filter((q) => q.length >= 8)
    .slice(0, 3);

  const base = {
    id: "c1",
    type: "news" as const,
    topic_id: input.topicId,
    angle: draft.angle,
    kicker: input.local ? localKicker(input.cluster) : KICKER[input.assignment.category],
    title: draft.title,
    status: truth.status,
    truth,
    body: draft.body,
    explain,
    action: draft.action,
    image: null,
    sources,
    place: input.local ? ("lokal" as const) : ("nasional" as const),
    revision: input.revision,
    first_seen: input.firstSeen,
    previous_edition: input.previousEdition,
    changes: [],
    ...(disclaimer ? { disclaimer } : {}),
    ...(unresolved.length ? { unresolved } : {}),
  };

  // Jangan buat deep_dive yang tidak memenuhi syarat sumber (validator E015).
  if (!input.asDeep || sources.length < 3) return base as Card;

  const words = wordCount(draft.body);
  return {
    ...base,
    type: "deep_dive",
    dek: draft.dek || draft.claim.slice(0, 150),
    optional: true,
    read_min: Math.min(15, Math.max(4, Math.ceil(words / 200))),
    stats: [
      { value: String(pack.stats.fetched), label: "halaman" },
      { value: String(sources.length), label: "media" },
    ],
  } as Card;
}

export async function writeNewsroomCard(
  input: WriteNewsroomCardInput,
  deps: {
    llm: LlmAdapter;
    model: string;
    glossary: Glossary;
    db?: Db;
    telemetry?: LlmTelemetry;
    cache?: FetchCache;
    primaryConfigs?: PrimarySourceConfig[];
  },
): Promise<WriteNewsroomCardResult> {
  const topic = input.topic;
  const assignment = input.assignment;
  const originalAnswers = [...assignment.answers];
  const primary = deps.db && deps.primaryConfigs?.length
    ? await findPrimarySources({
        db: deps.db,
        topic,
        cluster: input.cluster,
        configs: deps.primaryConfigs,
        fromIso: input.fromIso,
        toIso: input.toIso,
        cache: deps.cache,
        fetchImpl: input.fetchImpl,
        max: 2,
      })
    : [];

  const pack = await buildMaterialPack(topic, input.cluster, input.topicId, deps.glossary, {
    maxFetch: input.maxFetch ?? 4,
    fetchImpl: input.fetchImpl,
    cache: deps.cache,
    primary,
  });

  const noteRefs = input.noteIds
    ? refs(input.openNotes.filter((n) => input.noteIds!.includes(n.id)))
    : refs(input.openNotes);
  const writeCtx = {
    assignment,
    pack,
    topic,
    topicId: input.topicId,
    local: input.local,
    prior: input.prior,
  };

  deps.telemetry?.set({ role: "write", topicId: input.topicId, attempt: 1 });
  const first = await writeDraft(writeCtx, { llm: deps.llm, model: deps.model });
  let draft = first.draft;

  // Writer minta bahan tambahan: satu putaran deterministik dari database.
  if (draft && draft.needs.length > 0 && deps.db) {
    const extra = expandFromDb(deps.db, pack, draft.needs, input.fromIso, input.toIso, 3);
    if (extra.length) {
      pack.items.push(...extra);
      pack.stats.material_chars += extra.reduce((n, i) => n + i.chars, 0);
      deps.telemetry?.set({ role: "write", topicId: input.topicId, attempt: 2 });
      const second = await writeDraft(writeCtx, { llm: deps.llm, model: deps.model });
      if (second.draft) draft = second.draft;
    }
  }

  if (!draft) {
    return { card: null, draft: null, edit: null, pack, notes: [], disclaimer: null, blocked: false, revisions: 0 };
  }

  deps.telemetry?.set({ role: "edit", topicId: input.topicId, attempt: 1 });
  let review = await editDraft(draft, pack, assignment, {
    llm: deps.llm,
    model: deps.model,
    openNotes: noteRefs,
  });

  let revisions = 0;
  const maxRevisions = input.maxRevisions ?? 2;
  while (review.edit.verdict !== "approve" && revisions < maxRevisions) {
    const instruction = revisionInstruction(review.edit.findings);
    if (!instruction) break;
    deps.telemetry?.set({ role: "write", topicId: input.topicId, attempt: revisions + 2 });
    const rev = await writeDraft(writeCtx, {
      llm: deps.llm,
      model: deps.model,
      previous: draft,
      findings: instruction,
    });
    if (!rev.draft) break;
    draft = rev.draft;
    revisions++;
    deps.telemetry?.set({ role: "edit", topicId: input.topicId, attempt: revisions + 1 });
    review = await editDraft(draft, pack, assignment, {
      llm: deps.llm,
      model: deps.model,
      openNotes: noteRefs,
    });
  }

  const missingBeforeTrim = review.edit.answers_missing.slice();
  let disclaimer: string | null = null;
  const extraUnresolved: string[] = [];
  let defeated = false;

  // Fakta salah diberi kesempatan diperbaiki SEBELUM kartu digugurkan.
  const factFindings = review.edit.findings.filter(
    (f) => f.code === "E-FACT" && f.severity === "blocking",
  );
  if (factFindings.length > 0) {
    const beforeRepair = draft;
    deps.telemetry?.set({ role: "repair", topicId: input.topicId, attempt: 1 });
    const repair = await repairFactDraft(writeCtx, {
      llm: deps.llm,
      model: deps.model,
      previous: draft,
      findings: factFindings,
    });
    if (repair.draft) {
      draft = repair.draft;
      deps.telemetry?.set({ role: "edit", topicId: input.topicId, attempt: 9 });
      review = await editDraft(draft, pack, assignment, {
        llm: deps.llm,
        model: deps.model,
        openNotes: noteRefs,
      });

      const stillFact = review.edit.findings.filter(
        (f) => f.code === "E-FACT" && f.severity === "blocking",
      );
      if (stillFact.length > 0) {
        const invented = inventedNumbers(beforeRepair, draft, pack);
        if (invented.length > 0) {
          review.edit.findings = acceptWithInventedFacts(review.edit.findings, invented);
          review.edit.verdict = review.edit.findings.some((f) => f.severity === "blocking")
            ? "revise"
            : "approve";
          disclaimer =
            "Artikel ini memuat detail yang belum ada di bahan. Artikel terbit untuk konteks, bukan sebagai rujukan. " +
            "Jangan mengutip angka atau detail tersebut tanpa memeriksa sumber primer.";
          extraUnresolved.push(
            ...invented.slice(0, 2).map((n) => clipText(`Belum ada di bahan: ${n}`, 120)),
          );
        } else if (factFailurePolicy(review.edit.findings) === "disclaimer") {
          review.edit.findings = acceptWithInventedFacts(review.edit.findings, []);
          review.edit.verdict = review.edit.findings.some((f) => f.severity === "blocking")
            ? "revise"
            : "approve";
          disclaimer =
            "Artikel ini memuat klaim yang sumbernya saling bertentangan atau belum dapat dipastikan. " +
            "Artikel tetap terbit untuk konteks, bukan sebagai rujukan. " +
            "Jangan mengutip klaim yang diperdebatkan tanpa memeriksa sumber primer.";
          extraUnresolved.push(
            ...stillFact.slice(0, 2).map((f) => clipText(`Belum pasti: ${f.quote || f.issue}`, 120)),
          );
        } else {
          defeated = true;
        }
      }
    }
  }

  // Sempitkan lingkup bila masih ada pertanyaan yang tidak dijawab bahan.
  if (!defeated && review.edit.verdict !== "approve" && review.edit.answers_missing.length > 0) {
    const kept = review.edit.answers_covered
      .map((i) => assignment.answers[i])
      .filter((x): x is string => Boolean(x));
    if (kept.length >= 2) {
      const trimmed: Assignment = {
        ...assignment,
        title: draft.title,
        angle: draft.angle,
        answers: kept.slice(0, 4),
        depth:
          review.edit.depth_check === "too_thin"
            ? assignment.depth === "deep"
              ? "standard"
              : "brief"
            : assignment.depth,
      };
      deps.telemetry?.set({ role: "write", topicId: input.topicId, attempt: 99 });
      const rev = await writeDraft(
        {
          assignment: trimmed,
          pack,
          topic,
          topicId: input.topicId,
          local: input.local,
          prior: input.prior,
        },
        { llm: deps.llm, model: deps.model, previous: draft, findings: revisionInstruction(review.edit.findings) },
      );
      if (rev.draft) {
        draft = rev.draft;
        assignment.answers = trimmed.answers;
        assignment.depth = trimmed.depth;
        deps.telemetry?.set({ role: "edit", topicId: input.topicId, attempt: 99 });
        review = await editDraft(draft, pack, assignment, {
          llm: deps.llm,
          model: deps.model,
          openNotes: noteRefs,
        });
      }
    }
  }

  const editForNotes: EditResult = {
    ...review.edit,
    answers_missing: missingBeforeTrim.length ? missingBeforeTrim : review.edit.answers_missing,
  };

  const notes = defeated
    ? []
    : notesFromEdit({
        editionId: input.editionId,
        topicId: input.topicId,
        threadTitle: assignment.title,
        assignment: { ...assignment, answers: originalAnswers },
        draft,
        edit: editForNotes,
        now: input.now,
      });

  if (defeated) {
    console.log("  ! newsroom: kartu digugurkan karena fakta terbukti salah");
    return { card: null, draft, edit: review.edit, pack, notes, disclaimer, blocked: true, revisions };
  }

  if (!disclaimer) disclaimer = disclaimerFrom(review.edit);

  const card = toCard(draft, pack, input, disclaimer, extraUnresolved);
  if (!card) {
    console.log(
      `  ! newsroom: kartu tidak lolos bentuk (explain ${draft.explain.length}, sumber ${sourcesFromPack(pack, input.now).length})`,
    );
  }
  return {
    card,
    draft,
    edit: review.edit,
    pack,
    notes,
    disclaimer,
    blocked: false,
    revisions,
  };
}
