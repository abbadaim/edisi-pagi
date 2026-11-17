/**
 * Pengambilan bahan untuk Tanya AI (rencana 022, fase 2).
 *
 * Dua jalur, dan keduanya harus jujur soal batasnya:
 *
 *   kartu  pembaca mulai dari berita yang sudah terbit → `topic_id` yang stabil
 *          dari registry. Cocok hampir selalu tepat.
 *   bebas  pertanyaan diketik apa adanya → cocokkan token judul/lead. Lebih
 *          longgar, dan karena itu wajib bisa mengatakan "tidak ada bahan".
 *
 * Modul ini murni: tidak menyentuh basis data, tidak mengambil jaringan.
 * `scripts/ask.ts` yang memberi baris; di sini hanya keputusan.
 */

export interface AskArticle {
  url: string;
  outlet: string;
  title: string;
  published_at: string | null;
  topic_id: string | null;
  lead: string | null;
  /** Teks penuh dari `article_text`; null bila belum pernah diambil. */
  text: string | null;
}

export interface AskMaterial {
  /** `s1`.. sama dengan konvensi bahan writer. */
  id: string;
  url: string;
  outlet: string;
  title: string;
  published_at: string | null;
  text: string;
  chars: number;
  /** `teks` = teks penuh halaman; `lead` = ringkasan feed saja. */
  tier: "teks" | "lead";
}

export interface RetrieveOptions {
  /** `kartu` = topic_id dari kartu; `bebas` = teks pertanyaan. */
  mode: "kartu" | "bebas";
  topicId?: string | null;
  /** Batas bahan yang dikirim ke model. */
  maxItems?: number;
  /** Jumlah token minimal yang harus muncul. Bawaan 2. */
  minHits?: number;
  /** Teks di bawah ini dianggap bukan bahan yang bisa dikutip. */
  minChars?: number;
  /** Hanya artikel dalam rentang ini. */
  withinDays?: number;
  now?: Date;
}

export interface RetrieveResult {
  materials: AskMaterial[];
  /** Topik yang ikut cocok — dipakai untuk menandai pantau. */
  topics: string[];
  /** Alasan kosong, dalam bahasa manusia. Null bila ada bahan. */
  reason: string | null;
}

const STOP = new Set([
  "yang", "untuk", "dari", "dengan", "pada", "dalam", "soal", "akan", "ini",
  "itu", "para", "usai", "atau", "juga", "disebut", "menjadi", "adalah",
  "apakah", "bagaimana", "kenapa", "mengapa", "kapan", "siapa", "berapa",
  "bagaimanakah", "seperti", "masih", "sudah", "belum", "tidak", "bisa",
  "apa", "kah", "dan", "ada", "oleh", "kepada", "tentang", "terhadap",
  "kabupaten", "kota", "provinsi", "indonesia",
]);

export function questionTokens(text: string): string[] {
  const raw = text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  return [...new Set(raw.filter((w) => !STOP.has(w)))];
}

function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Jumlah token pertanyaan yang muncul di judul+lead. Hitungan, bukan rasio. */
function hitsFor(tokens: string[], article: AskArticle): number {
  const hay = norm(`${article.title} ${article.lead ?? ""}`);
  let hit = 0;
  for (const t of tokens) if (hay.includes(t)) hit += 1;
  return hit;
}

function ageDays(article: AskArticle, now: Date): number {
  if (!article.published_at) return 365;
  const t = Date.parse(article.published_at);
  if (!Number.isFinite(t)) return 365;
  return (now.getTime() - t) / 86_400_000;
}

/**
 * Teks yang boleh dikutip. Teks penuh dipakai bila ada; kalau tidak, lead feed
 * — dan itu ditandai `lead` supaya jawaban tidak mengaku lebih dari yang ada.
 * Kutipan tetap divalidasi terhadap teks yang benar-benar dikirim ke model, jadi
 * lead tidak bisa dipakai untuk mengarang kalimat dari badan artikel.
 */
function bodyOf(a: AskArticle): { text: string; tier: "teks" | "lead" } {
  const full = (a.text ?? "").trim();
  if (full.length >= 200) return { text: full, tier: "teks" };
  return { text: (a.lead ?? full).trim(), tier: "lead" };
}

/**
 * Pilih bahan. Bila tidak ada yang layak, kembalikan `reason` yang bisa
 * ditampilkan apa adanya — itu jawaban yang sah, bukan kegagalan.
 */
export function selectMaterial(articles: AskArticle[], question: string, opts: RetrieveOptions): RetrieveResult {
  const now = opts.now ?? new Date();
  const maxItems = opts.maxItems ?? 4;
  const minChars = opts.minChars ?? 120;
  const withinDays = opts.withinDays ?? 120;
  const tokens = questionTokens(question);

  // `articles.topic_id` tidak pernah diisi pipeline (0 dari 2.026 baris pada
  // 2026-11-17) dan `topic_entities` kosong untuk 116 dari 119 topik. Yang
  // benar-benar menghubungkan topik ke artikel adalah `topic_aliases` — judul
  // artikel pendiri. Jadi pencocokan selalu lewat judul, dan `mode` hanya
  // memberi tahu pemanggil apa yang dipakai sebagai kueri.
  const pool = articles.filter((a) => ageDays(a, now) <= withinDays && bodyOf(a).text.length >= minChars);

  if (tokens.length === 0) {
    return { materials: [], topics: [], reason: "Pertanyaan terlalu pendek untuk dicocokkan dengan arsip." };
  }
  const minHits = opts.minHits ?? Math.min(2, tokens.length);
  const scored = pool
    .map((a) => ({ a, hit: hitsFor(tokens, a) }))
    .filter((x) => x.hit >= minHits)
    .sort((x, y) => y.hit - x.hit || (y.a.published_at ?? "").localeCompare(x.a.published_at ?? ""));
  const ranked = scored.map((x) => x.a);
  if (ranked.length === 0) {
    return {
      materials: [],
      topics: [],
      reason:
        opts.mode === "kartu"
          ? "Belum ada artikel di arsip yang cocok dengan topik ini."
          : "Tidak ada artikel di arsip yang cocok dengan pertanyaan ini.",
    };
  }
  const poolRanked = ranked;

  // Satu outlet satu suara, seperti `DEC-0030`: tiga artikel dari satu pemilik
  // tidak boleh terlihat seperti tiga sumber.
  const seenOutlets = new Set<string>();
  const materials: AskMaterial[] = [];
  for (const a of poolRanked) {
    if (seenOutlets.has(a.outlet)) continue;
    seenOutlets.add(a.outlet);
    const body = bodyOf(a);
    materials.push({
      id: `s${materials.length + 1}`,
      url: a.url,
      outlet: a.outlet,
      title: a.title,
      published_at: a.published_at,
      text: body.text,
      chars: body.text.length,
      tier: body.tier,
    });
    if (materials.length >= maxItems) break;
  }

  const topics = [
    ...new Set(materials.map((m) => poolRanked.find((a) => a.url === m.url)?.topic_id).filter(Boolean)),
  ] as string[];

  if (materials.length === 0) {
    return { materials: [], topics, reason: "Bahan yang tersedia terlalu tipis untuk dikutip." };
  }
  return { materials, topics, reason: null };
}

/** Teks bahan yang dikirim ke model, dengan id supaya sitasi bisa ditunjuk. */
export function renderMaterial(materials: AskMaterial[]): string {
  return materials
    .map(
      (m) =>
        `[${m.id}] ${m.outlet} · ${m.published_at ?? "tanpa tanggal"} · ${m.tier === "lead" ? "ringkasan feed" : "teks penuh"} · ${m.title}\n${m.text.slice(0, 6000)}`,
    )
    .join("\n\n---\n\n");
}
