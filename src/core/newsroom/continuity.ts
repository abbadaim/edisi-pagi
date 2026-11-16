/**
 * Kesinambungan antar edisi: penanda “lanjutan” dan perubahan status.
 *
 * `previous_edition` dan `revision` sudah ada di kartu, tetapi aplikasi tidak
 * pernah menampilkannya. Modul ini mengisi `changes[]` untuk perubahan status
 * saja: judul sengaja tidak dicatat karena writer menulis ulang judul setiap
 * hari, dan itu akan menghasilkan changelog palsu.
 */

import type { Card, Change } from "../types.ts";

export interface PreviousCard {
  card: Pick<Card, "topic_id" | "status" | "title">;
  at: string;
}

/**
 * Tambahkan satu `Change` untuk kartu yang statusnya berbeda dari edisi
 * sebelumnya. Basis memakai sumber pertama kartu saat ini; tanpa sumber, tidak
 * ada perubahan yang dicatat (schema menolak `changes` tanpa basis).
 */
export function withStatusChanges(cards: Card[], previous: PreviousCard[], at: string): Card[] {
  if (previous.length === 0) return cards;

  const before = new Map<string, { status: string; title: string }>();
  for (const p of previous) {
    const existing = before.get(p.card.topic_id);
    if (!existing || p.at > existing.title) {
      before.set(p.card.topic_id, { status: p.card.status, title: p.at });
    }
  }

  return cards.map((card) => {
    const prev = before.get(card.topic_id);
    if (!prev || prev.status === card.status) return card;
    const source = card.sources[0];
    if (!source) return card;

    const change: Change = {
      field: "status",
      from: prev.status,
      to: card.status,
      at: at as Change["at"],
      basis: { outlet: source.outlet, url: source.url },
    };
    return { ...card, changes: [...(card.changes ?? []), change] };
  });
}

/** Jumlah pembaruan = jumlah edisi berbeda dalam riwayat. */
export function updateCount(history: { date: string }[]): number {
  return new Set(history.map((h) => h.date)).size;
}
