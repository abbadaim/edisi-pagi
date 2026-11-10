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
  const { llm, model, provider } = resolveLlm(process.env);

  if (!llm) console.log("tidak ada LLM tersedia — memakai writer deterministik\n");

  const clustersSummary = summarise(clusters);
  const inputHash = hashSummaries(clustersSummary);
  const refresh = process.argv.includes("--refresh");

  let adjudication = refresh ? null : loadAdjudication(db, editionId, inputHash);
  const fromCache = Boolean(adjudication);

  if (!adjudication && llm) {
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

  const entries: Entry[] = [];
  for (const { topic, cluster } of mergedTopics) {
    const res = await resolveTopic(db, topic, registry, { counter, now, editionId });
    entries.push({ topic, cluster, topicId: res.topic_id, revision: res.revision });
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
    verify: { provider: "rules", model: "evidence-class" },
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
    e: { topic: AdjudicatedTopic; cluster: Cluster; topicId: string; revision: number },
    local: boolean,
  ): Promise<Card | null> {
    if (llm) {
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
  function planCards(scope: "nasional" | "lokal", exclude: Set<string> = new Set()) {
    const scoped = entries.filter((e) => (scope === "lokal" ? isLocalStory(e.cluster) : true));
    const { kept } = hardFilter(scoped, scope, now);
    // Edisi Sleman sengaja menjaga variasi: satu topik per kategori, karena
    // korpus lokal sering didominasi satu tema (mis. hewan liar sepekan ini).
    let { selected } = select(kept, { scope, now, maxArticlesPerCategory: scope === "lokal" ? 1 : 2 });

    // Hari tenang: kalau anggaran suasana hati menyisakan satu kartu lokal,
    // longgarkan batasnya. Edisi Sleman yang tipis lebih berguna daripada tab kosong.
    if (scope === "lokal" && selected.length < 2 && kept.length >= 2) {
      selected = select(kept, { scope, now, maxHeavy: 3, maxArticlesPerCategory: 3 }).selected;
    }

    return selected.filter((r) => !exclude.has(r.topicId));
  }

  async function renderCards(
    planned: ReturnType<typeof planCards>,
    scope: "nasional" | "lokal",
    limit: number,
  ): Promise<Card[]> {
    const cards: Card[] = [];
    for (const r of planned) {
      if (cards.length >= limit) break;
      const entry = entries.find((e) => e.topicId === r.topicId);
      const card = await makeCard(
        {
          topic: r.topic,
          cluster: r.cluster,
          topicId: r.topicId,
          revision: entry?.revision ?? 1,
        },
        scope === "lokal" || r.local,
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

    return {
      id: "c99",
      type: "hoax_roundup",
      topic_id: `t_hoaks_${editionId.replace(/-/g, "_")}`,
      angle: `${items.length} pemeriksaan fakta hari ini`,
      kicker: "Kabar beredar",
      title: "Yang beredar, dan yang sudah dibantah",
      status: "dibantah",
      truth: null,
      body: [`${items.length} klaim diperiksa hari ini. Semuanya dari TurnBackHoax.`],
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

  function goodNewsCard(usedTopics: Set<string>): Card | null {
    const scoped = entries.filter((e) => !isLocalCluster(e.cluster));
    const { kept } = hardFilter(scoped, "nasional", now);
    const { selected } = select(kept, { scope: "nasional", now });
    for (const r of selected) {
      if (usedTopics.has(r.topicId)) continue;
      if (r.topic.heavy) continue;
      // Laba bank bukan "hal baik". Hanya budaya dan kesehatan.
      if (!["culture", "health"].includes(r.topic.category)) continue;
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
  const deep = await dailyDeepDive(usedTopics);
  if (deep) news.splice(5);
  usedTopics = new Set(news.map((c) => c.topic_id));

  // Arsip hoaks tidak bisa direkonstruksi untuk hari lampau; hanya untuk hari ini.
  const thinMode = process.argv.includes("--thin") || process.env.ALLOW_THIN === "1";
  const isToday = editionId === new Date(Date.now() + WIB).toISOString().slice(0, 10);
  const hoax = isToday ? await hoaxCard() : null;
  const good = goodNewsCard(usedTopics);

  const withDeep = deep
    ? [...news.slice(0, 2), deep, ...news.slice(2)]
    : news;
  const cards = [...withDeep, ...(hoax ? [hoax] : []), ...(good ? [good] : [])].slice(0, 8);

  const edition = buildEdition({
    scope: "nasional",
    editionId,
    publishedAt,
    coverage: { from: coverageFrom, to: coverageTo },
    generatedAt: publishedAt,
    place: { kabupaten: "Sleman", province: "DI Yogyakarta" },
    cards,
    truncatedReason:
      cards.length < 8
        ? `Hanya ${cards.length} kartu yang lolos; sisanya tidak punya konteks atau sumber`
        : null,
    generatedBy: generatedBy(),
  });

  const file = join(outDir, `${editionId}.nasional.json`);
  const check = validateEdition(edition);
  console.log(
    `nasional · ${clusters.length + soloLocal.length} klaster · ${entries.length} topik · ${cards.length} kartu`,
  );
  const publishable = check.ok || (thinMode && cards.length > 0 && allowsThin(check.errors));
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
  if (localCards.length >= 2) {
    const localEdition: Edition = buildEdition({
      scope: "lokal",
      editionId,
      publishedAt,
      coverage: { from: coverageFrom, to: coverageTo },
      generatedAt: publishedAt,
      place: { kabupaten: "Sleman", province: "DI Yogyakarta" },
      cards: localCards,
      truncatedReason:
        localCards.length < 5 ? `Hanya ${localCards.length} topik lokal yang lolos` : null,
      generatedBy: generatedBy(),
    });
    const localFile = join(outDir, `${editionId}.lokal.json`);
    writeFileSync(localFile, JSON.stringify(localEdition, null, 2));
    const lc = validateEdition(localEdition);
    console.log(`lokal    · ${localCards.length} kartu · ${lc.ok ? "✓ valid" : "✗ tidak valid"}`);
    if (!lc.ok) console.log(formatErrors(lc.errors));
    console.log(`  ${localFile}`);
  } else {
    // Jangan tinggalkan edisi lokal lama: aplikasi membacanya sebagai edisi hari ini.
    const stale = join(outDir, `${editionId}.lokal.json`);
    if (existsSync(stale)) rmSync(stale);
    console.log(`lokal    · tidak terbit (${localPlan.length} topik lolos, minimum 2)`);
  }

  console.log(
    `\nadjudikasi: ${fromCache ? "cache" : adjudication.fallback ? "fallback" : "llm"} · input ${inputHash} · token ${adjudication.usage.tokens_in}/${adjudication.usage.tokens_out}`,
  );
} finally {
  db.close();
}
