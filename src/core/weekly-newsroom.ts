/**
 * Penyesuaian newsroom untuk edisi mingguan.
 *
 * Edisi mingguan memakai penulis newsroom yang sama dengan harian, tetapi
 * kartunya harus berbentuk rekap: `Rekap N hari`, statistik artikel/media/hari,
 * dan aksi yang menjelaskan bahwa ini bukan berita baru.
 */

import type { AdjudicatedTopic } from "./adjudicate.ts";
import type { Cluster } from "./cluster.ts";
import type { Assignment } from "./newsroom/contracts.ts";
import type { Card } from "./types.ts";

export const WEEKLY_ANSWERS = [
  "Apa yang berubah selama sepekan?",
  "Mengapa perubahan itu penting?",
  "Siapa yang paling terdampak?",
  "Apa yang belum jelas atau belum terjawab?",
  "Apa langkah berikutnya yang perlu dipantau?",
];

/** Assignment mingguan: selalu `deep`, tanpa catatan editor. */
export function weeklyAssignment(topic: AdjudicatedTopic): Assignment {
  return {
    cids: topic.cids,
    title: topic.title,
    angle: topic.angle,
    category: topic.category,
    significance: topic.significance,
    heavy: topic.heavy,
    depth: "deep",
    why_now: "Rekap tujuh hari",
    answers: [...WEEKLY_ANSWERS],
    note_ids: [],
    drop: false,
    reason: null,
  };
}

export function spanDays(cluster: Cluster): number {
  const dates = cluster.articles
    .map((a) => (a.publishedAt ? Date.parse(a.publishedAt) : NaN))
    .filter((n) => Number.isFinite(n));
  if (dates.length < 2) return 1;
  return Math.max(1, Math.round((Math.max(...dates) - Math.min(...dates)) / 86_400_000));
}

/**
 * Ubah kartu newsroom menjadi kartu rekap mingguan. Mengembalikan null bila
 * kartunya bukan deep_dive — mingguan hanya menerbitkan deep_dive.
 */
export function weeklyise(card: Card, cluster: Cluster): Card | null {
  if (card.type !== "deep_dive") return null;

  const days = spanDays(cluster);
  const words = card.body.join(" ").split(/\s+/).filter(Boolean).length;

  return {
    ...card,
    type: "deep_dive",
    angle: `Rekap ${days} hari`,
    kicker: "Rekap pekan",
    action: "Ini rekap, bukan berita baru. Buka edisi harian untuk detailnya.",
    optional: true,
    read_min: Math.min(15, Math.max(4, Math.ceil(words / 200))),
    stats: [
      { value: String(cluster.articles.length), label: "artikel" },
      { value: String(cluster.outlets.length), label: "media" },
      { value: `${days} hari`, label: "berjalan" },
    ],
  } as Card;
}
