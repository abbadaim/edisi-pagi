/**
 * Kartu meta yang memakai bahan yang sudah ada di newsroom:
 *
 *  - `change`  — status/angka topik berubah dibanding edisi sebelumnya.
 *  - `misread` — judul artikel sumber tidak memuat kualifikasi yang ada di isinya.
 *
 * Keduanya deterministik: tidak ada fakta baru, hanya kutipan dari edisi lama
 * dan teks artikel yang tersimpan. `gap` dan `debate` belum dibuat karena
 * butuh data amplifikasi (Reddit/komentar/Trends) yang belum ada.
 */

import type { Db } from "../../adapters/db/sqlite.ts";
import type { Card, Change, ChangeBasis, Source, Status } from "../types.ts";
import { truncateWords } from "../normalize.ts";
import { createDbFetchCache } from "./cache.ts";

export interface DatedCard {
  card: Card;
  /** published_at edisi tempat kartu ini terbit. */
  at: string;
}

export interface MetaInput {
  db: Db;
  editionId: string;
  publishedAt: string;
  cards: Card[];
  previous: DatedCard[];
}

export interface MetaOutput {
  cards: Card[];
  /** Perubahan per topic_id, untuk ditempel ke kartu berita yang sama. */
  changes: Map<string, Change[]>;
}

const STATUS_ID: Record<Status, string> = {
  terkonfirmasi: "Terkonfirmasi",
  sebagian: "Terkonfirmasi sebagian",
  belum: "Belum terkonfirmasi",
  dibantah: "Dibantah",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** published_at sudah +07:00; ambil tanggalnya tanpa bergantung zona runner. */
function shortDate(iso: string): string {
  const day = Number(iso.slice(8, 10));
  const month = Number(iso.slice(5, 7));
  if (!day || !month) return iso.slice(0, 10);
  return `${day} ${MONTHS[month - 1]}`;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 38);
}

function bestSource(card: Card): ChangeBasis {
  const s = [...card.sources].sort((a, b) => a.tier - b.tier)[0];
  return { outlet: s?.outlet ?? "Sumber", url: s?.url ?? "https://example.invalid/" };
}

function quoteOf(card: Card): string {
  return (card.truth?.claim ?? card.title).trim().slice(0, 160);
}

function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).slice(0, 4);
}

/**
 * Bandingkan satu topik dengan versi sebelumnya. Hanya status dan angka yang
 * dipakai: dua sinyal ini objektif. Perubahan judul saja terlalu berisik
 * karena writer menulis ulang judul setiap hari.
 */
export function diffCards(
  prev: Card,
  curr: Card,
  prevAt: string,
  currAt: string,
): Change | null {
  if (!prev.truth || !curr.truth) return null;
  if (Date.parse(prevAt) >= Date.parse(currAt)) return null;

  if (prev.truth.status !== curr.truth.status) {
    return {
      field: "status",
      from: prev.truth.status,
      to: curr.truth.status,
      at: currAt,
      basis: bestSource(curr),
    };
  }

  const before = numbersIn(prev.truth.claim);
  const after = numbersIn(curr.truth.claim);
  if (before.length > 0 && after.length > 0 && before.join(",") !== after.join(",")) {
    return {
      field: "number",
      from: before.join(", "),
      to: after.join(", "),
      at: currAt,
      basis: bestSource(curr),
    };
  }

  return null;
}

export function buildChangeCard(
  prev: Card,
  curr: Card,
  change: Change,
  prevAt: string,
  currAt: string,
): Card | null {
  const beforeLabel = change.field === "status" ? STATUS_ID[prev.truth!.status] : String(change.from ?? "—");
  const afterLabel = change.field === "status" ? STATUS_ID[curr.truth!.status] : String(change.to);

  const whatChanged =
    change.field === "status"
      ? `Status berubah dari “${beforeLabel}” menjadi “${afterLabel}”.`
      : `Angka berubah dari ${String(change.from)} menjadi ${String(change.to)}.`;

  const whatUnknown =
    curr.unresolved?.[0] ??
    "Belum ada keterangan resmi yang menjelaskan apa yang memicu perubahan ini.";

  const beforeSrc = bestSource(prev);
  const afterSrc = bestSource(curr);

  const sources: Source[] = [prev, curr]
    .map((c) => ({ card: c, basis: bestSource(c) }))
    .filter((x, i, arr) => arr.findIndex((y) => y.basis.url === x.basis.url) === i)
    .map(({ card, basis }) => {
      const s = card.sources.find((x) => x.url === basis.url);
      return {
        outlet: basis.outlet,
        url: basis.url,
        published_at: s?.published_at ?? null,
        tier: s?.tier ?? 2,
        accessed_at: s?.accessed_at ?? currAt,
      };
    });

  const prefix = change.field === "status" ? "Status berubah" : "Angka berubah";
  const title = `${prefix}: ${truncateWords(curr.title, 70 - prefix.length - 2)}`;

  const body = [
    `${shortDate(currAt)}: status topik ini tercatat “${afterLabel}”, berubah dari “${beforeLabel}” pada ${shortDate(prevAt)}. Perubahan terlihat dari klaim yang dipakai kedua edisi.`,
    `Edisi sebelumnya (${beforeSrc.outlet}) menulis: “${quoteOf(prev)}”. Versi terbaru (${afterSrc.outlet}) menulis: “${quoteOf(curr)}”.`,
    `Yang belum jelas: ${whatUnknown} Perubahan status bukan berarti seluruh pertanyaan terjawab, jadi periksa sumber primer sebelum menyimpulkan.`,
  ];

  return {
    id: "c1",
    type: "change",
    topic_id: `t_change_${slug(curr.topic_id.replace(/^t_/, ""))}`,
    angle: `${beforeLabel} → ${afterLabel}`.slice(0, 90),
    kicker: "Yang berubah",
    title,
    status: "sebagian",
    truth: null,
    body,
    unresolved: [whatUnknown],
    action: "Bandingkan versi lama dan baru sebelum menyimpulkan.",
    image: null,
    sources,
    revision: curr.revision,
    first_seen: curr.first_seen,
    previous_edition: prevAt.slice(0, 10),
    changes: [change],
    before: {
      at: prevAt,
      label: beforeLabel,
      quote: quoteOf(prev),
      source: beforeSrc,
    },
    after: {
      at: currAt,
      label: afterLabel,
      quote: quoteOf(curr),
      source: afterSrc,
    },
    what_changed: whatChanged,
    what_unknown: whatUnknown,
  } as Card;
}

const QUALIFIERS: Array<{ re: RegExp; word: string; meaning: string }> = [
  { re: /\busulan\b/i, word: "usulan", meaning: "masih berupa usulan, bukan keputusan" },
  { re: /\bwacana\b/i, word: "wacana", meaning: "baru dibicarakan, belum diputuskan" },
  { re: /\bdraf\b/i, word: "draf", meaning: "masih rancangan, belum berlaku" },
  { re: /\b(tidak mengikat|belum mengikat)\b/i, word: "tidak mengikat", meaning: "belum mengikat secara hukum" },
  { re: /\bmasih dikaji\b/i, word: "masih dikaji", meaning: "belum ada kesimpulan" },
  { re: /\btahap penyelidikan\b/i, word: "tahap penyelidikan", meaning: "belum masuk penyidikan atau pengadilan" },
  { re: /\btidak serta-merta\b/i, word: "tidak serta-merta", meaning: "tidak otomatis berlaku" },
];

/** Cari kalimat isi yang memuat kualifikasi yang tidak ada di judul. */
/** Buang kutip dan spasi di tepi kalimat agar tidak menjadi “...".", */
function cleanSentence(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/^[\s"'“”‘’]+/, "")
    .replace(/[\s"'“”‘’]+$/, "")
    .replace(/([.!?])["'“”‘’]+$/, "$1")
    .trim();
}

export function findQualifierGap(
  title: string,
  text: string,
): { missing: string[]; sentence: string; meaning: string } | null {
  if (text.trim().length < 500) return null;
  if (QUALIFIERS.some((q) => q.re.test(title))) return null;

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(cleanSentence)
    .filter((s) => s.length >= 40 && s.length <= 260);

  for (const q of QUALIFIERS) {
    const sentence = sentences.find((s) => q.re.test(s));
    if (!sentence) continue;
    // Hanya kualifikasi di kalimat yang dikutip.
    const found = [...new Set(
      QUALIFIERS.filter((x) => x.re.test(sentence)).map((x) => x.word),
    )].slice(0, 3);
    return {
      missing: found,
      sentence: sentence.slice(0, 240),
      meaning: q.meaning,
    };
  }
  return null;
}

export function buildMisreadCard(
  card: Card,
  article: { title: string; url: string; outlet: string; published_at: string | null; tier: 1 | 2 | 3 },
  gap: { missing: string[]; sentence: string; meaning: string },
): Card {
  const claim = article.title.trim().slice(0, 160);
  const qualifier = gap.missing[0] ?? "kualifikasi";
  const title = `Yang hilang dari judul: “${qualifier}”`.slice(0, 70);

  const body = [
    `Judul yang beredar: “${claim}”. Judul itu tidak memuat kata “${qualifier}” yang muncul di isi artikel.`,
    `Isi artikelnya menyebut: “${gap.sentence}”. Artinya, ${gap.meaning}.`,
    "Pembaca yang hanya melihat judul bisa menganggap persoalannya lebih final daripada kenyataan. Periksa isi dan sumber primer sebelum menyimpulkan.",
  ];

  return {
    id: "c1",
    type: "misread",
    topic_id: `t_misread_${slug(card.topic_id.replace(/^t_/, ""))}`,
    angle: `“${qualifier}” tidak ada di judul`.slice(0, 90),
    kicker: "Salah dipahami",
    title,
    status: "sebagian",
    truth: null,
    body,
    action: "Baca isi dan cek sumber primer sebelum menyimpulkan.",
    image: null,
    sources: [
      {
        outlet: article.outlet,
        url: article.url,
        published_at: article.published_at,
        tier: article.tier,
        accessed_at: card.sources[0]?.accessed_at ?? `${card.first_seen}T05:00:00+07:00`,
      },
    ],
    revision: 1,
    first_seen: card.first_seen,
    previous_edition: null,
    changes: [],
    claim,
    reality: gap.sentence,
    // `missing` berisi fakta yang hilang, bukan nama kualifikasi (SCHEMA §3.7).
    missing: [gap.meaning],
    trigger: "headline_body_gap",
  } as Card;
}

async function articleFor(
  db: Db,
  src: Source,
): Promise<{ title: string; url: string; outlet: string; published_at: string | null; tier: 1 | 2 | 3; text: string } | null> {
  const row = db.get<{
    title_display: string;
    lead: string | null;
    outlet: string;
    published_at: string | null;
  }>("SELECT title_display, lead, outlet, published_at FROM articles WHERE url = ?", [src.url]);
  if (!row) return null;

  // Hanya teks halaman penuh yang layak untuk deteksi judul–isi.
  const cached = await createDbFetchCache(db).get(src.url);
  if (!cached || cached.trim().length < 500) return null;

  return {
    title: row.title_display,
    url: src.url,
    // Pakai sumber dari kartu: timestamp-nya sudah dinormalisasi ke +07:00.
    // `articles.published_at` mentah berbentuk Z dan ditolak skema.
    outlet: src.outlet,
    published_at: src.published_at,
    tier: src.tier,
    text: cached,
  };
}

export async function buildMetaCards(input: MetaInput): Promise<MetaOutput> {
  const { db, cards, previous, publishedAt } = input;

  const previousByTopic = new Map<string, DatedCard>();
  for (const entry of [...previous].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
    const id = entry.card.topic_id;
    if (!id || previousByTopic.has(id)) continue;
    previousByTopic.set(id, entry);
  }

  // ---- change: satu kartu, perubahan status/angka paling kuat ----
  let bestChange: { prev: DatedCard; curr: Card; change: Change; weight: number } | null = null;
  for (const curr of cards) {
    if (curr.type !== "news" && curr.type !== "deep_dive" && curr.type !== "good_news") continue;
    const prev = previousByTopic.get(curr.topic_id);
    if (!prev) continue;
    const change = diffCards(prev.card, curr, prev.at, publishedAt);
    if (!change) continue;
    const weight =
      (change.field === "status" ? 10 : 4) +
      (curr.truth?.confidence ?? 0) * 2 +
      curr.sources.length * 0.1;
    if (!bestChange || weight > bestChange.weight) bestChange = { prev, curr, change, weight };
  }

  const meta: Card[] = [];
  const changes = new Map<string, Change[]>();

  if (bestChange) {
    const { prev, curr, change } = bestChange;
    const changeCard = buildChangeCard(prev.card, curr, change, prev.at, publishedAt);
    if (changeCard) {
      meta.push(changeCard);
      changes.set(curr.topic_id, [change]);
    }
  }

  // ---- misread: satu kartu, artikel dengan judul–isi paling jelas ----
  const ordered = [...cards]
    .filter((c) => c.type === "news")
    .sort((a, b) => b.sources.length - a.sources.length);

  for (const card of ordered) {
    if (meta.some((c) => c.type === "misread")) break;
    for (const src of card.sources.slice(0, 3)) {
      const article = await articleFor(db, src);
      if (!article) continue;
      const gap = findQualifierGap(article.title, article.text);
      if (!gap) continue;
      meta.push(
        buildMisreadCard(
          card,
          {
            title: article.title,
            url: article.url,
            outlet: article.outlet,
            published_at: article.published_at,
            tier: article.tier,
          },
          gap,
        ),
      );
      break;
    }
  }

  const used = new Set(cards.map((c) => c.topic_id));
  return { cards: meta.filter((c) => !used.has(c.topic_id)), changes };
}

export function applyChanges(cards: Card[], changes: Map<string, Change[]>): Card[] {
  if (changes.size === 0) return cards;
  return cards.map((c) => {
    const diff = changes.get(c.topic_id);
    return diff ? { ...c, changes: [...(c.changes ?? []), ...diff] } : c;
  });
}
