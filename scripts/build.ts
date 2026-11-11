#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openSqlite } from "../src/adapters/db/sqlite.ts";
import { clusterArticles, loadArticles, type Cluster } from "../src/core/cluster.ts";
import { adjudicate, fallbackTopics, summarise, type AdjudicatedTopic } from "../src/core/adjudicate.ts";
import { loadRegistry, resolveTopic } from "../src/core/registry.ts";
import { hardFilter, isDiyUrl, isLocalCluster, isLocalJunk, isLocalStory, select } from "../src/core/rank.ts";
import { buildEdition, parseHoaxTitles, type HoaxRow } from "../src/core/assemble.ts";
import {
  createDeterministicWriter,
  loadGlossary,
  sourcesFromCluster,
} from "../src/core/writer.ts";
import { validateEdition, formatErrors, allowsThin } from "../src/core/validate.ts";
import { resolveLlm } from "../src/adapters/llm/resolve.ts";
import type { Card, Edition, Scope } from "../src/core/types.ts";
import { isoWib } from "../src/core/time.ts";
import { features, similarity } from "../src/core/simhash.ts";
import { imageFor } from "../src/adapters/image.ts";
import { fetchVerdict } from "../src/adapters/turnback.ts";
import { writeCardWithLlm, backgroundCandidates } from "../src/core/writer-llm.ts";
import { buildDeepDive, buildDeepDiveWithLlm } from "../src/core/deepdive.ts";
import { hashSummaries, loadAdjudication, saveAdjudication } from "../src/core/adjudicate-cache.ts";
import { mergeDuplicateTopics, type TopicEntry } from "../src/core/merge.ts";
import { loadEnvFile } from "../src/config/env.ts";
import { candidatesFrom, depthFor, planEdition, type PlanCandidate } from "../src/core/newsroom/plan.ts";
import { writeNewsroomCard } from "../src/core/newsroom/card.ts";
import { loadLedger, persistLedger } from "../src/core/newsroom/store.ts";
import { ageNotes, emptyLedger, markAnswered, mergeLedger, openNotes, plannerNotes } from "../src/core/newsroom/notes.ts";
import { reviewEdition, type DeskCard } from "../src/core/newsroom/desk.ts";
import type { Assignment } from "../src/core/newsroom/contracts.ts";
import { dedupeCards } from "../src/core/newsroom/dedupe.ts";
import { budgetFollowUps } from "../src/core/newsroom/selection.ts";
import { LlmTelemetry } from "../src/core/telemetry.ts";
import { createDbFetchCache } from "../src/core/newsroom/cache.ts";
import { loadPrimarySources } from "../src/core/newsroom/primary.ts";
import { writeHoaxRoundup } from "../src/core/newsroom/hoax.ts";

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

/** `--date 2026-11-07` membangun edisi untuk hari baca itu (backfill). */
// Default produksi: newsroom. Rollback: --no-newsroom atau NEWSROOM_WRITE=0.
const newsroom =
  !process.argv.includes("--no-newsroom") &&
  process.env.NEWSROOM_WRITE !== "0" &&
  process.env.NEWSROOM_WRITE !== "off";
/** Batasi jumlah kartu saat uji integrasi; 0 = tanpa batas. */
const newsroomLimit = Number(arg("newsroom-limit") ?? 0);
const dateArg = arg("date");
const readingDay = dateArg || new Date(Date.now() + WIB).toISOString().slice(0, 10);

// Edisi terbit 05.00 WIB; liputan 24 jam sebelumnya.
const now = dateArg ? new Date(`${dateArg}T05:00:00+07:00`) : new Date();
const editionId = readingDay;
const publishedAt = isoWib(now)!;
const coverageFrom = isoWib(new Date(now.getTime() - 24 * 3_600_000))!;
const coverageTo = publishedAt;

/** Batas query disimpan sebagai UTC (Z) agar bisa dibandingkan dengan published_at feed. */
const queryFrom = new Date(now.getTime() - 24 * 3_600_000).toISOString();
const queryTo = now.toISOString();

const dbPath = arg("db") || process.env.DATABASE_PATH || join(root, "local.db");
if (!existsSync(dbPath)) {
  console.error(`database tidak ada: ${dbPath}\njalankan: npm run migrate && npm run ingest`);
  process.exit(2);
}

const outDir = join(root, "data", "editions");
const assetsDir = join(root, "data", "assets");
mkdirSync(outDir, { recursive: true });
mkdirSync(assetsDir, { recursive: true });

const db = openSqlite(dbPath);
try {
  const rows = loadArticles(db, queryFrom, queryTo);
  const clusters = clusterArticles(rows);

  // Peristiwa kecamatan sering diliput satu media saja. Artikel lokal yang
  // tidak masuk klaster utama tetap dipertimbangkan untuk edisi Sleman,
  // dengan saringan isi: harus benar-benar menyebut Sleman/DIY.
  const clustered = new Set(clusters.flatMap((c) => c.articles.map((a) => a.id)));
  const localLeft = rows.filter((r) => !clustered.has(r.id) && isDiyUrl(r.url));
  const soloLocal = localLeft.length
    ? clusterArticles(localLeft, {
        includeSingletons: true,
        minArticles: 1,
        minOutlets: 1,
        maxGapHours: 48,
      }).filter((c) => isLocalStory(c) && !isLocalJunk(c))
    : [];

  // Urutan: opencode -> deepseek -> deterministik. LLM_PROVIDER memaksa satu.
  const resolvedLlm = resolveLlm(process.env);
  const telemetry = new LlmTelemetry(db, editionId);
  const fetchCache = createDbFetchCache(db);
  const primaryConfigs = loadPrimarySources(join(root, "config", "primary-sources.yaml"));
  const llm = resolvedLlm.llm ? telemetry.wrap(resolvedLlm.llm) : null;
  const { model, provider } = resolvedLlm;

  if (!llm) console.log("tidak ada LLM tersedia — memakai writer deterministik\n");

  const clustersSummary = summarise(clusters);
  const inputHash = hashSummaries(clustersSummary);
  const refresh = process.argv.includes("--refresh");

  let adjudication = refresh ? null : loadAdjudication(db, editionId, inputHash);
  const fromCache = Boolean(adjudication);

  if (!adjudication && llm) {
    telemetry.set({ role: "adjudicate" });
    adjudication = await adjudicate(clusters, { llm, model, date: editionId, place: "Sleman" });
    if (!adjudication.fallback) saveAdjudication(db, editionId, inputHash, adjudication, now);
  }

  if (!adjudication) {
    adjudication = {
      topics: fallbackTopics(clustersSummary),
      fallback: true,
      usage: { tokens_in: 0, tokens_out: 0 },
      dropped: [] as string[],
    };
  }

  const byCid = new Map<string, (typeof clusters)[number]>();
  summarise(clusters).forEach((s, i) => byCid.set(s.cid, clusters[i]!));

  const registry = loadRegistry(db, new Date(now.getTime() - 14 * 86_400_000).toISOString());
  const counter = { n: 0 };

  interface Entry {
    topic: AdjudicatedTopic;
    cluster: (typeof clusters)[number];
    topicId: string;
    revision: number;
    assignment: Assignment;
  }

  // Topik dari adjudikasi + brief lokal yang tidak ikut adjudikasi.
  const rawEntries: TopicEntry[] = [];
  for (const topic of adjudication.topics) {
    if (topic.drop) continue;
    const cluster = byCid.get(topic.cids[0]!);
    if (!cluster) continue;
    rawEntries.push({ topic, cluster });
  }
  for (const cluster of soloLocal) {
    const topic = fallbackTopics(summarise([cluster]))[0];
    if (!topic) continue;
    rawEntries.push({ topic: { ...topic, local: true, significance: Math.max(2, topic.significance) }, cluster });
  }

  // Adjudikasi kadang memecah satu peristiwa menjadi dua topik.
  const { entries: mergedTopics, merges } = mergeDuplicateTopics(rawEntries);
  for (const m of merges) {
    console.log(
      `  gabung (${m.reason} ${m.score.toFixed(2)}): "${m.dropped.slice(0, 42)}" → "${m.kept.slice(0, 42)}"`,
    );
  }

  // Planner newsroom (satu panggilan) menentukan depth/answers/tindak lanjut.
  // Pemilihan kartu tetap dilakukan aturan di `planCards`.
  let ledger = emptyLedger(now);
  let notesReady = false;
  if (newsroom && llm) {
    try {
      ledger = ageNotes(loadLedger(db, now), now);
      notesReady = true;
    } catch {
      console.log("  ! tabel editor_notes belum ada — jalankan `npm run migrate`; catatan tidak disimpan");
    }
  }

  const history = registry.map((r) => ({
    topic_id: r.topic_id,
    canonical_title: r.canonical_title,
    first_seen: r.first_seen,
    revision: r.revision,
  }));
  const planCandidates = candidatesFrom(
    adjudication.topics.filter((t) => !t.drop),
    byCid,
    history,
  ).slice(0, 30);

  let planned: Assignment[] = [];
  if (newsroom && llm && planCandidates.length > 0) {
    telemetry.set({ role: "plan" });
    const { plan, usedLlm } = await planEdition(
      {
        editionId,
        place: "Sleman",
        slots: { nasional: 6, lokal: 4 },
        candidates: planCandidates,
        openThreads: [],
        openNotes: plannerNotes(ledger, now),
        constraints: { maxHeavy: 2, maxMeta: 2 },
      },
      { llm, model },
    );
    planned = plan.assignments;
    console.log(`  planner newsroom: ${plan.assignments.length} tugas${usedLlm ? "" : " (fallback)"}`);
  }

  function fallbackAssignment(topic: AdjudicatedTopic, cluster: (typeof clusters)[number]): Assignment {
    const candidate: PlanCandidate = {
      topic,
      cid: topic.cids[0] ?? "c00",
      articles: cluster.articles.length,
      outlets: cluster.outlets,
      entities: cluster.entities,
      first_seen: null,
      last_title: null,
      history_topic_id: null,
    };
    return {
      cids: topic.cids,
      title: topic.title,
      angle: topic.angle,
      category: topic.category,
      significance: topic.significance,
      heavy: topic.heavy,
      depth: depthFor(candidate),
      why_now: "",
      answers: [
        "Apa yang terjadi dan siapa yang terlibat?",
        "Angka, tanggal, atau nama spesifik apa yang tersedia?",
        "Apa yang belum jelas dan langkah berikutnya?",
      ],
      note_ids: [],
      drop: false,
      reason: "fallback: tanpa planner",
    };
  }

  function assignmentFor(topic: AdjudicatedTopic, cluster: (typeof clusters)[number]): Assignment {
    const base = planned.find((a) => !a.drop && a.cids.some((cid) => topic.cids.includes(cid)));
    if (!base) return fallbackAssignment(topic, cluster);

    // Hanya catatan `open` yang boleh ditautkan; pertanyaannya masuk ke answers
    // agar writer benar-benar menjawab. Batas 2/edisi diterapkan saat render,
    // bukan saat semua entry dibuat (entry yang tidak terpilih tidak boleh
    // menghabiskan kuota).
    const linked = base.note_ids
      .map((id) => ledger.notes.find((n) => n.id === id && n.status === "open"))
      .filter((n): n is NonNullable<typeof n> => Boolean(n))
      .slice(0, 2);

    const answers = [...new Set([...base.answers, ...linked.map((n) => n.question)])].slice(0, 6);
    return { ...base, note_ids: linked.map((n) => n.id), answers };
  }

  const entries: Entry[] = [];
  for (const { topic, cluster } of mergedTopics) {
    const res = await resolveTopic(db, topic, registry, { counter, now, editionId });
    entries.push({
      topic,
      cluster,
      topicId: res.topic_id,
      revision: res.revision,
      assignment: assignmentFor(topic, cluster),
    });
  }

  const glossary = loadGlossary(join(root, "config", "glossary.yaml"));
  const writer = createDeterministicWriter(glossary);

  // Ditulis setelah kartu dibuat: provider "llm" yang gagal diam-diam lalu
  // jatuh ke writer deterministik tidak boleh tercatat sebagai LLM.
  let llmWritten = 0;
  let deterministicWritten = 0;

  const generatedBy = () => ({
    adjudicate: { provider: adjudication.fallback ? "fallback" : provider, model: adjudication.fallback ? "none" : model },
    write: {
      provider: llmWritten > 0 ? (deterministicWritten > 0 ? `${provider}+deterministic` : provider) : "deterministic",
      model: llmWritten > 0 ? model : "glossary",
    },
    verify:
      newsroom && llm
        ? { provider, model }
        : { provider: "rules", model: "evidence-class" },
    embed: { provider: "none", model: "none" },
  });

  function firstSeenOf(topicId: string): string {
    const r = db.get<{ first_seen: string }>("SELECT first_seen FROM topics WHERE topic_id = ?", [topicId]);
    return (r?.first_seen ?? editionId).slice(0, 10);
  }

  function prevEdition(revision: number): string | null {
    if (revision <= 1) return null;
    const d = new Date(`${editionId}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  async function makeCard(
    e: {
      topic: AdjudicatedTopic;
      cluster: Cluster;
      topicId: string;
      revision: number;
      assignment: Assignment;
    },
    local: boolean,
    asDeep = false,
  ): Promise<Card | null> {
    if (newsroom && llm) {
      const res = await writeNewsroomCard(
        {
          editionId,
          now,
          topic: e.topic,
          topicId: e.topicId,
          cluster: e.cluster,
          assignment: e.assignment,
          local,
          revision: e.revision,
          firstSeen: firstSeenOf(e.topicId),
          previousEdition: prevEdition(e.revision),
          prior: [],
          openNotes: openNotes(ledger, now).filter((n) => n.topic_id === e.topicId),
          noteIds: e.assignment.note_ids,
          asDeep,
          fromIso: queryFrom,
          toIso: queryTo,
        },
        { llm, model, glossary, db, telemetry, cache: fetchCache, primaryConfigs },
      );

      if (res.notes.length > 0) {
        ledger = mergeLedger(ledger, res.notes, now).ledger;
      }
      if (res.edit?.notes_resolved.length) {
        ledger = markAnswered(
          ledger,
          res.edit.notes_resolved,
          { edition_id: editionId, card_title: res.card?.title ?? e.topic.title },
          now,
        );
      }
      if (notesReady) persistLedger(db, ledger, now);

      if (res.card) {
        llmWritten++;
        return orderSources(res.card, e.cluster);
      }
      // Fakta terbukti salah → jangan tulis ulang. Kegagalan bentuk (mis.
      // konteks kurang) → biarkan jalur lama mencoba.
      if (res.blocked) {
        console.log(`  ✗ newsroom: kartu digugurkan (${e.topic.title.slice(0, 48)})`);
        return null;
      }
      console.log(`  ! newsroom tidak menghasilkan kartu sah — fallback writer lama`);
    }

    if (llm) {
      telemetry.set({ role: "fallback", topicId: e.topicId });
      const card = await writeCardWithLlm(
        {
          editionId,
          now,
          topic: e.topic,
          topicId: e.topicId,
          cluster: e.cluster,
          sources: sourcesFromCluster(e.cluster, now),
          local,
          revision: e.revision,
          firstSeen: firstSeenOf(e.topicId),
          previousEdition: prevEdition(e.revision),
        },
        { llm, model, glossary },
      );
      if (card) {
        llmWritten++;
        return orderSources(card, e.cluster);
      }
    }
    deterministicWritten++;
    const fallback = writer.write({
      editionId,
      publishedAt,
      now,
      topic: e.topic,
      topicId: e.topicId,
      cluster: e.cluster,
      revision: e.revision,
      firstSeen: firstSeenOf(e.topicId),
      previousEdition: prevEdition(e.revision),
      local,
    });
    return fallback ? orderSources(fallback, e.cluster) : null;
  }

  /** Sumber paling relevan dulu, supaya gambar og:image juga cocok dengan judul. */
  function orderSources<T extends Card>(card: T, cluster: Cluster): T {
    const titleFeats = features(card.title);
    const score = new Map(
      cluster.articles.map((a) => [a.url, similarity(titleFeats, features(a.title))]),
    );
    card.sources = [...card.sources].sort(
      (a, b) => (score.get(b.url) ?? 0) - (score.get(a.url) ?? 0),
    );
    return card;
  }

  /** Pilih kandidat per edisi. `exclude` dipakai agar berita lokal tidak dobel di edisi nasional. */
  /** Tindak lanjut = tugas planner yang menautkan catatan editor. */
  function isFollowTopic(topic: AdjudicatedTopic): boolean {
    const entry = entries.find((e) => e.topic.cids.some((cid) => topic.cids.includes(cid)));
    return (entry?.assignment.note_ids.length ?? 0) > 0;
  }

  function planCards(scope: "nasional" | "lokal", exclude: Set<string> = new Set()) {
    const scoped = entries.filter((e) => (scope === "lokal" ? isLocalStory(e.cluster) : true));
    const { kept, stats } = hardFilter(scoped, scope, now);
    if (scope === "lokal") {
      console.log(
        `  lokal: ${scoped.length} kandidat lokal · ${kept.length} lolos filter` +
          ` (basi ${stats.stale}, orphan ${stats.orphan}, bukan-lokal ${stats.localOnly})`,
      );
    }
    const opts = { scope, now, maxArticlesPerCategory: scope === "lokal" ? 1 : 2 };
    // Edisi Sleman sengaja menjaga variasi: satu topik per kategori, karena
    // korpus lokal sering didominasi satu tema (mis. hewan liar sepekan ini).
    let { selected } = select(kept, opts);

    // Hari tenang: kalau anggaran suasana hati menyisakan satu kartu lokal,
    // longgarkan batasnya. Edisi Sleman yang tipis lebih berguna daripada tab kosong.
    if (scope === "lokal" && selected.length < 2 && kept.length >= 2) {
      selected = select(kept, { scope, now, maxHeavy: 3, maxArticlesPerCategory: 3 }).selected;
    }

    const available = selected.filter((r) => !exclude.has(r.topicId));
    const availableItems = available.map((r) => ({ ...r, followUp: isFollowTopic(r.topic) }));

    // Isi kekurangan berita baru dari pool yang kalah kuota.
    const freshPool = select(
      kept.filter((k) => !isFollowTopic(k.topic)),
      opts,
    ).selected
      .filter((r) => !exclude.has(r.topicId))
      .map((r) => ({ ...r, followUp: false }));

    const budgeted = budgetFollowUps(availableItems, freshPool, {
      maxFollow: scope === "lokal" ? 1 : 2,
      minFresh: scope === "lokal" ? 1 : 3,
      target: scope === "lokal" ? 4 : 6,
    });

    const follows = budgeted.filter((r) => r.followUp).length;
    const fresh = budgeted.length - follows;
    if (follows > 0) console.log(`  ${scope}: ${fresh} berita baru + ${follows} tindak lanjut`);

    return budgeted.map(({ followUp: _followUp, ...r }) => r);
  }

  async function renderCards(
    planned: ReturnType<typeof planCards>,
    scope: "nasional" | "lokal",
    limit: number,
  ): Promise<Card[]> {
    const cards: Card[] = [];
    let deepUsed = false;
    const usedNoteIds = new Set<string>();
    const cap = newsroomLimit > 0 ? Math.min(limit, newsroomLimit) : limit;
    for (const r of planned) {
      if (cards.length >= cap) break;
      const entry = entries.find((e) => e.topicId === r.topicId);
      const asDeep = newsroom && scope === "nasional" && !deepUsed && entry?.assignment.depth === "deep";
      if (asDeep) deepUsed = true;

      const baseAssignment = entry?.assignment ?? fallbackAssignment(r.topic, r.cluster);
      // Satu catatan hanya boleh ditutup oleh satu kartu. Batas kartu
      // tindak lanjut sudah diterapkan di planCards.
      const allowedNotes = baseAssignment.note_ids.filter((id) => !usedNoteIds.has(id));
      for (const id of allowedNotes) usedNoteIds.add(id);
      const card = await makeCard(
        {
          topic: r.topic,
          cluster: r.cluster,
          topicId: r.topicId,
          revision: entry?.revision ?? 1,
          assignment: { ...baseAssignment, note_ids: allowedNotes },
        },
        scope === "lokal" || r.local,
        asDeep,
      );
      if (card) cards.push(card);
    }
    return cards;
  }

  async function hoaxCard(): Promise<Card | null> {
    const rowsH = db.all<{ url: string; title_display: string; lead: string | null }>(
      `SELECT url, title_display, lead FROM articles
        WHERE outlet = 'turnbackhoax.id' AND is_duplicate_of IS NULL
        ORDER BY published_at DESC NULLS LAST LIMIT 12`,
    );
    const items = parseHoaxTitles(
      rowsH.map((r): HoaxRow => ({ url: r.url, title: r.title_display, lead: r.lead ?? "" })),
    );
    if (items.length === 0) return null;

    // Ganti alasan dengan temuan sebenarnya dari halaman TurnBackHoax.
    for (const item of items) {
      const verdict = await fetchVerdict(item.url);
      if (verdict) item.reason = verdict.slice(0, 240);
    }

    if (llm) {
      telemetry.set({ role: "hoax" });
      const written = await writeHoaxRoundup(
        { editionId, now, items, sourceUrl: "https://turnbackhoax.id/" },
        { llm, model },
      );
      if (written) return written;
      console.log("  ! penulis hoaks gagal — memakai kartu deterministik");
    }

    return {
      id: "c99",
      type: "hoax_roundup",
      topic_id: `t_hoaks_${editionId.replace(/-/g, "_")}`,
      angle: `${items.length} pemeriksaan fakta hari ini`,
      kicker: "Kabar beredar",
      title: "Yang beredar, dan yang sudah dibantah",
      status: "dibantah",
      truth: null,
      body: [
        `${items.length} klaim diperiksa hari ini. Semuanya dari TurnBackHoax.`,
        "Rincian klaim, putusan, dan alasannya ada di daftar di bawah.",
      ],
      action: "Balas dengan tautan pemeriksaannya; jangan debat isinya.",
      image: null,
      sources: [
        {
          outlet: "TurnBackHoax",
          url: "https://turnbackhoax.id/",
          published_at: null,
          tier: 2,
          accessed_at: isoWib(now)!,
        },
      ],
      revision: 1,
      first_seen: editionId,
      previous_edition: null,
      changes: [],
      items,
      pattern: null,
    } as Card;
  }

  async function goodNewsCard(usedTopics: Set<string>): Promise<Card | null> {
    const scoped = entries.filter((e) => !isLocalCluster(e.cluster));
    const { kept } = hardFilter(scoped, "nasional", now);
    const { selected } = select(kept, { scope: "nasional", now });
    for (const r of selected) {
      if (usedTopics.has(r.topicId)) continue;
      if (r.topic.heavy) continue;
      // Laba bank bukan "hal baik". Hanya budaya dan kesehatan.
      if (!["culture", "health"].includes(r.topic.category)) continue;

      if (newsroom && llm) {
        const entry = entries.find((e) => e.topicId === r.topicId);
        const base = entry?.assignment ?? fallbackAssignment(r.topic, r.cluster);
        const card = await makeCard(
          {
            topic: r.topic,
            cluster: r.cluster,
            topicId: r.topicId,
            revision: entry?.revision ?? 1,
            assignment: { ...base, depth: "standard", note_ids: [] },
          },
          false,
          false,
        );
        if (!card || card.type !== "news") continue;
        return { ...card, type: "good_news", kicker: "Satu hal baik" } as Card;
      }

      const card = writer.write({
        editionId,
        publishedAt,
        now,
        topic: r.topic,
        topicId: r.topicId,
        cluster: r.cluster,
        revision: 1,
        firstSeen: firstSeenOf(r.topicId),
        previousEdition: null,
        local: false,
      });
      if (!card) continue;
      if (card.type !== "news") continue;
      return { ...card, type: "good_news", kicker: "Satu hal baik" } as Card;
    }
    return null;
  }

  /** Deep dive harian: thread 7 hari terakhir, bukan siklus 24 jam. */
  async function dailyDeepDive(used: Set<string>): Promise<Card | null> {
    const week = loadArticles(db, new Date(now.getTime() - 7 * 86_400_000).toISOString(), now.toISOString());
    const threads = clusterArticles(week, { maxGapHours: 168 });

    const candidates = threads
      .filter((c) => c.articles.length >= 5 && c.outlets.length >= 3 && !isLocalCluster(c))
      .sort(
        (x, y) =>
          y.articles.length * Math.min(y.outlets.length, 5) -
          x.articles.length * Math.min(x.outlets.length, 5),
      );

    for (const cluster of candidates.slice(0, 5)) {
      const topic = fallbackTopics(summarise([cluster]))[0];
      if (!topic) continue;

      const resolved = await resolveTopic(db, topic, registry, { counter, now, editionId });
      if (used.has(resolved.topic_id)) continue;

      const usedBefore = previousDeepDives();
      if (usedBefore.has(resolved.topic_id)) continue;

      const ctx = {
        now,
        cluster,
        topic,
        topicId: resolved.topic_id,
        glossary,
        local: false,
      };

      if (llm) {
        const bg = await backgroundCandidates(topic, glossary);
        const card = await buildDeepDiveWithLlm(ctx, { llm, model, candidates: bg });
        if (card) return card;
      }
      const card = buildDeepDive(ctx);
      if (card) return card;
    }
    return null;
  }

  /** Hindari thread yang sama jadi deep dive dua kali dalam 14 hari. */
  function previousDeepDives(): Set<string> {
    const ids = new Set<string>();
    try {
      for (const file of readdirSync(outDir)) {
        if (!file.endsWith(".json")) continue;
        const ed = JSON.parse(readFileSync(join(outDir, file), "utf8"));
        if (ed.edition_id === editionId) continue;
        for (const c of ed.cards ?? []) if (c.type === "deep_dive") ids.add(c.topic_id);
      }
    } catch { /* folder kosong */ }
    return ids;
  }

  // Edisi Sleman direncanakan lebih dulu: kalau cukup, topiknya tidak
  // diulang di edisi nasional hari yang sama.
  const localPlan = planCards("lokal");
  const localCards = localPlan.length >= 2 ? await renderCards(localPlan, "lokal", 4) : [];
  const reservedLocal = new Set(localCards.map((c) => c.topic_id));

  let newsRaw = await renderCards(planCards("nasional", reservedLocal), "nasional", 6);
  const news: Card[] = [];
  for (const card of newsRaw) {
    if (card.image || card.type !== "news") {
      news.push(card);
      continue;
    }
    // Coba sumber berurutan: sebagian media memblokir pengambilan gambar.
    let img = null;
    let credit = null;
    for (const src of card.sources.slice(0, 4)) {
      const got = await imageFor(src.url, assetsDir);
      if (got) {
        img = got;
        credit = src.outlet;
        break;
      }
    }
    news.push(
      img
        ? { ...card, image: { url: img.url, credit: credit!, alt: card.title } }
        : card,
    );
  }
  let usedTopics = new Set(news.map((c) => c.topic_id));

  // Deep dive mengambil satu slot berita bila ada thread 7 hari yang layak.
  // Mode newsroom sudah menandai satu assignment deep sebagai deep_dive.
  const deep = newsroom ? null : await dailyDeepDive(usedTopics);
  if (deep) news.splice(5);
  usedTopics = new Set(news.map((c) => c.topic_id));

  // Arsip hoaks tidak bisa direkonstruksi untuk hari lampau; hanya untuk hari ini.
  const thinMode = process.argv.includes("--thin") || process.env.ALLOW_THIN === "1";
  const isToday = editionId === new Date(Date.now() + WIB).toISOString().slice(0, 10);
  const hoax = isToday ? await hoaxCard() : null;
  const good = await goodNewsCard(usedTopics);

  const withDeep = deep
    ? [...news.slice(0, 2), deep, ...news.slice(2)]
    : news;
  const cards = [...withDeep, ...(hoax ? [hoax] : []), ...(good ? [good] : [])].slice(0, 8);
  const uniqueCards = dedupeCards(cards, 0.6);

  if (newsroom) {
    console.log("  kartu:", uniqueCards.map((c) => `${c.type}:${c.sources.length}`).join(" "));
  }

  // Desk review bersifat shadow: vonisnya dicatat, tidak menahan terbit.
  if (newsroom && llm && process.env.NEWSROOM_DESK !== "off") {
    const deskCards: DeskCard[] = cards
      .filter((c) => c.type !== "hoax_roundup")
      .map((c, i) => ({
        card_id: `k${i + 1}`,
        title: c.title,
        angle: c.angle,
        category: c.kicker,
        depth: c.type === "deep_dive" ? "deep" : "standard",
        body_chars: c.body.join(" ").length,
        cited_paragraphs: c.body.length,
        paragraphs: c.body.length,
        sources: c.sources.length,
        editor_verdict: "approve" as const,
        depth_check: c.type === "deep_dive" ? ("deep" as const) : ("standard" as const),
        blocking: 0,
      }));
    telemetry.set({ role: "desk" });
    const desk = await reviewEdition(deskCards, { llm, model });
    console.log(
      `  desk shadow: ${desk.desk.publish ? "layak" : "tidak layak"} · ${desk.desk.advisory.length} advisory`,
    );
    for (const a of desk.desk.advisory.slice(0, 4)) console.log(`    ~ ${a}`);
  }
  const edition = buildEdition({
    scope: "nasional",
    editionId,
    publishedAt,
    coverage: { from: coverageFrom, to: coverageTo },
    generatedAt: publishedAt,
    place: { kabupaten: "Sleman", province: "DI Yogyakarta" },
    cards: uniqueCards,
    truncatedReason:
      uniqueCards.length < 8
        ? `Hanya ${uniqueCards.length} kartu yang lolos; sisanya tidak punya konteks atau sumber`
        : null,
    generatedBy: generatedBy(),
  });

  const file = join(outDir, `${editionId}.nasional.json`);
  const check = validateEdition(edition);
  console.log(
    `nasional · ${clusters.length + soloLocal.length} klaster · ${entries.length} topik · ${uniqueCards.length} kartu`,
  );
  const publishable = check.ok || (thinMode && uniqueCards.length > 0 && allowsThin(check.errors));
  if (publishable) {
    writeFileSync(file, JSON.stringify(edition, null, 2));
    console.log(`  ${check.ok ? "✓ valid" : "△ tipis (uji)"} · ${file}`);
  } else {
    // Edisi tidak valid tidak pernah ditulis: aplikasi tidak boleh membacanya.
    if (existsSync(file)) rmSync(file);
    console.log(`  ✗ tidak valid · tidak diterbitkan`);
    console.log(formatErrors(check.errors));
  }

  // --- lokal ---
  const uniqueLocal = dedupeCards(localCards, 0.5);
  if (uniqueLocal.length >= 2) {
    const localEdition: Edition = buildEdition({
      scope: "lokal",
      editionId,
      publishedAt,
      coverage: { from: coverageFrom, to: coverageTo },
      generatedAt: publishedAt,
      place: { kabupaten: "Sleman", province: "DI Yogyakarta" },
      cards: uniqueLocal,
      truncatedReason:
        uniqueLocal.length < 5 ? `Hanya ${uniqueLocal.length} topik lokal yang lolos` : null,
      generatedBy: generatedBy(),
    });
    const localFile = join(outDir, `${editionId}.lokal.json`);
    writeFileSync(localFile, JSON.stringify(localEdition, null, 2));
    const lc = validateEdition(localEdition);
    console.log(`lokal    · ${uniqueLocal.length} kartu · ${lc.ok ? "✓ valid" : "✗ tidak valid"}`);
    if (!lc.ok) console.log(formatErrors(lc.errors));
    console.log(`  ${localFile}`);
  } else {
    // Jangan tinggalkan edisi lokal lama: aplikasi membacanya sebagai edisi hari ini.
    const stale = join(outDir, `${editionId}.lokal.json`);
    if (existsSync(stale)) rmSync(stale);
    console.log(
      `lokal    · tidak terbit (${localPlan.length} topik, ${uniqueLocal.length} kartu unik; minimum 2)`,
    );
  }

  console.log(
    `\nadjudikasi: ${fromCache ? "cache" : adjudication.fallback ? "fallback" : "llm"} · input ${inputHash} · token ${adjudication.usage.tokens_in}/${adjudication.usage.tokens_out}`,
  );

  const llmStats = telemetry.summary();
  console.log(
    `llm: ${llmStats.calls} panggilan · ${llmStats.tokensIn}/${llmStats.tokensOut} token · $${llmStats.costUsd.toFixed(4)} · max ${llmStats.maxLatencyMs} ms`,
  );
  try {
    db.run(
      `INSERT INTO run_log
         (run_id, date, llm_calls, llm_fallback, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        `${editionId}-build-${Date.now()}`,
        editionId,
        llmStats.calls,
        0,
        llmStats.costUsd || null,
        isoWib(new Date())!,
      ],
    );
  } catch {
    /* run_log lama mungkin tidak punya kolom; telemetri per panggilan tetap tersimpan */
  }
} finally {
  db.close();
}
