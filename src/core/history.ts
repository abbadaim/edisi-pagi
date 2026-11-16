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

const STOP = new Set(
  "yang dan atau di ke dari untuk pada dengan ini itu tak tidak akan sudah belum saat kata oleh dalam juga lebih bisa jadi bagi para secara agar karena namun tetapi setelah sebelum hari".split(" "),
);

function tokens(title: string): Set<string> {
  return new Set(
    (title || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3 && !STOP.has(w)),
  );
}

function similarity(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  return shared / (x.size + y.size - shared);
}

/**
 * Sambungkan riwayat ke judul hari ini. Topik bisa bergabung karena satu kata
 * kunci (mis. “ASEAN”), sehingga entri lama bisa jadi cerita yang berbeda.
 * Entri hanya dipertahankan bila mirip dengan entri sesudahnya; rantai berhenti
 * di titik pertama yang tidak mirip.
 */
export function linkHistory(entries: HistoryEntry[], currentTitle: string, threshold = 0.25): HistoryEntry[] {
  if (entries.length === 0) return entries;
  const kept: HistoryEntry[] = [];
  let anchor = currentTitle;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (similarity(entry.title, anchor) < threshold) break;
    kept.unshift(entry);
    anchor = entry.title;
  }
  return kept;
}

/** Judul terakhir sebelum edisi ini — dasar baris “pembaruan terakhir”. */
export function previousTitle(history: HistoryEntry[], editionId: string): string | null {
  const before = history.filter((h) => h.date < editionId);
  return before.at(-1)?.title ?? null;
}
