/**
 * Dedupe kartu tingkat akhir (NEWSROOM-IMPLEMENTATION.md P1).
 * Adjudikasi bisa memecah satu peristiwa menjadi beberapa topik; setelah
 * ditulis, judul yang hampir sama harus tidak muncul dua kali dalam edisi.
 */

import type { Card } from "../types.ts";
import { features, similarity } from "../simhash.ts";

function score(card: Card): number {
  // Utamakan sumber lebih banyak, lalu isi lebih panjang.
  return card.sources.length * 10_000 + card.body.join(" ").length + (card.image ? 500 : 0);
}

const META_TYPES = new Set(["change", "misread", "gap", "debate"]);

export function dedupeCards(cards: Card[], threshold = 0.6): Card[] {
  const out: Card[] = [];
  for (const card of cards) {
    const idx = out.findIndex((x) => {
      // Kartu meta sengaja membahas kartu berita yang sama; judulnya mirip
      // karena itu, bukan karena duplikat.
      if (META_TYPES.has(card.type) || META_TYPES.has(x.type)) return false;
      if (x.type === "hoax_roundup" || card.type === "hoax_roundup") {
        return x.type === card.type && similarity(features(x.title), features(card.title)) >= threshold;
      }
      return similarity(features(x.title), features(card.title)) >= threshold;
    });
    if (idx < 0) {
      out.push(card);
      continue;
    }
    const prev = out[idx]!;
    if (score(card) > score(prev)) out[idx] = card;
  }
  return out;
}
