/**
 * Riwayat satu topik lintas edisi, untuk linimasa tindak lanjut (rencana 019).
 *
 * Sumbernya tabel `revisions`, yang sudah mencatat judul/angle/kind setiap kali
 * sebuah topik muncul di edisi. Yang disimpan di kartu hanya ringkasnya: tanggal
 * dan judul. Badan per hari tidak disimpan, jadi linimasa tidak boleh berpura-pura
 * memilikinya.
 */

export interface HistoryEntry {
  date: string;
  title: string;
}

export interface RevisionRow {
  edition_id: string;
  title: string;
  revision?: number;
}

/**
 * Satu baris per edisi (revisi tertinggi menang), urut lama → baru, dipotong
 * dari belakang supaya kejadian terbaru selalu ikut.
 */
export function buildHistory(rows: RevisionRow[], limit = 6): HistoryEntry[] {
  const byDate = new Map<string, { title: string; revision: number }>();
  for (const row of rows) {
    const date = (row.edition_id ?? "").slice(0, 10);
    const title = (row.title ?? "").trim();
    if (!date || !title) continue;
    const revision = row.revision ?? 0;
    const prev = byDate.get(date);
    if (!prev || revision >= prev.revision) byDate.set(date, { title, revision });
  }

  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-limit)
    .map(([date, v]) => ({ date, title: v.title }));
}

/** Judul terakhir sebelum edisi ini — dasar baris “pembaruan terakhir”. */
export function previousTitle(history: HistoryEntry[], editionId: string): string | null {
  const before = history.filter((h) => h.date < editionId);
  return before.at(-1)?.title ?? null;
}
