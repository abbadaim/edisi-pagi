/**
 * Dedupe sindikasi (CLUSTERING.md §4).
 *
 * Dua alat, dua tugas:
 *  - `simhash()` — sidik 64-bit untuk penyimpanan/bucketing, murah dibandingkan.
 *  - `similarity()` — Jaccard berbobot atas token+bigram, dipakai MEMUTUSKAN.
 *
 * SimHash saja terlalu sensitif untuk judul pendek: dua judul sindikasi bisa
 * berbeda 19 bit. Jaccard pada token yang sama stabil di kisaran 0,85–0,95.
 */

const MASK64 = (1n << 64n) - 1n;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

export interface SimHash {
  hi: number;
  lo: number;
}

export function fnv1a64(input: string): bigint {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK64;
  }
  return h;
}

const STOPWORDS = new Set([
  "dan", "yang", "untuk", "dengan", "dari", "pada", "akan", "tidak", "dalam",
  "juga", "kata", "ujar", "sebut", "adalah", "ada", "bisa", "sudah",
  "telah", "karena", "setelah", "saat", "hari", "tahun", "orang", "lebih",
  "agar", "jadi", "kita", "kami", "mereka", "ini", "itu", "para", "oleh",
  "serta", "atau", "tapi", "tetapi", "masih", "belum", "harus", "saya", "dia",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Fitur: unigram berbobot 1, bigram berbobot 1. */
export function features(text: string): Map<string, number> {
  const tokens = tokenize(text);
  const f = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    const uni = tokens[i]!;
    f.set(uni, (f.get(uni) ?? 0) + 1);
    const next = tokens[i + 1];
    if (next) {
      const bi = `${uni}_${next}`;
      f.set(bi, (f.get(bi) ?? 0) + 1);
    }
  }
  return f;
}

/** Jaccard berbobot. 1 = identik, 0 = tidak ada irisan. */
export function similarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  let union = 0;

  for (const [k, v] of a) {
    const w = b.get(k);
    if (w === undefined) {
      union += v;
    } else {
      inter += Math.min(v, w);
      union += Math.max(v, w);
    }
  }
  for (const [k, v] of b) {
    if (!a.has(k)) union += v;
  }

  return union === 0 ? 0 : inter / union;
}

export function simhash(text: string): SimHash {
  const weights = new Float64Array(64);
  for (const [feature, w] of features(text)) {
    const h = fnv1a64(feature);
    for (let bit = 0; bit < 64; bit++) {
      const on = (h >> BigInt(bit)) & 1n;
      weights[bit]! += on === 1n ? w : -w;
    }
  }

  let hi = 0;
  let lo = 0;
  for (let bit = 0; bit < 32; bit++) {
    if (weights[bit]! > 0) lo |= 1 << bit;
    if (weights[bit + 32]! > 0) hi |= 1 << bit;
  }
  return { hi: hi >>> 0, lo: lo >>> 0 };
}

function popcount32(x: number): number {
  x = x - ((x >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  x = (x + (x >> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >> 24;
}

export function hamming(a: SimHash, b: SimHash): number {
  return popcount32((a.hi ^ b.hi) >>> 0) + popcount32((a.lo ^ b.lo) >>> 0);
}

export function toBigInt(h: SimHash): bigint {
  return (BigInt(h.hi) << 32n) | BigInt(h.lo);
}

export function fromBigInt(v: bigint): SimHash {
  return { hi: Number((v >> 32n) & 0xffffffffn), lo: Number(v & 0xffffffffn) };
}

/**
 * SQLite INTEGER adalah signed 64-bit; SimHash memakai rentang unsigned.
 * Simpan sebagai signed, baca kembali dengan `fromSignedInt64`.
 */
export function toSignedInt64(h: SimHash): bigint {
  const u = toBigInt(h);
  return u >= 1n << 63n ? u - (1n << 64n) : u;
}

export function fromSignedInt64(v: bigint): SimHash {
  return fromBigInt(v < 0n ? v + (1n << 64n) : v);
}

/**
 * Ambang duplikat. 0,72 memisahkan sindikasi (0,85–0,95) dari
 * penulisan ulang peristiwa yang sama (0,2–0,45) — yang kedua harus
 * diklaster, bukan dibuang.
 */
export const SIMILARITY_THRESHOLD = 0.72;

