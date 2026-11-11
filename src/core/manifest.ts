/**
 * Pemilihan edisi "terbaru" untuk manifest (DEC-0019).
 *
 * Satu tanggal global tidak cukup karena irama terbit berbeda:
 * - harian (nasional/lokal) berganti setiap hari;
 * - mingguan bertahan sepanjang pekan.
 *
 * Menghitung semuanya dari satu `latest` membuat edisi mingguan yang lebih baru
 * menghilangkan tab harian, atau sebaliknya tab mingguan hilang sepanjang pekan.
 */

export interface ManifestEditionRef {
  edition_id: string;
  scope: string;
}

export interface LatestSelection {
  latest: string | null;
  latestByScope: {
    nasional: string | null;
    lokal: string | null;
    mingguan: string | null;
  };
}

const DAY_MS = 86_400_000;

function newest(dates: string[]): string | null {
  return dates.filter(Boolean).sort().at(-1) ?? null;
}

export function selectLatest(
  entries: ManifestEditionRef[],
  opts: { weeklyWindowDays?: number } = {},
): LatestSelection {
  const weeklyWindowDays = opts.weeklyWindowDays ?? 7;

  const dailyDates = entries
    .filter((e) => e.scope !== "mingguan")
    .map((e) => e.edition_id);
  const allDates = entries.map((e) => e.edition_id);

  // `latest` adalah edisi harian terbaru; ini juga yang dipakai push.
  const latest = newest(dailyDates) ?? newest(allDates);
  const weekly = newest(entries.filter((e) => e.scope === "mingguan").map((e) => e.edition_id));

  const hasOnLatest = (scope: string) =>
    latest !== null && entries.some((e) => e.scope === scope && e.edition_id === latest);

  const weeklyFresh =
    weekly !== null &&
    latest !== null &&
    Math.abs(Date.parse(weekly) - Date.parse(latest)) <= weeklyWindowDays * DAY_MS;

  return {
    latest,
    latestByScope: {
      // Edisi lokal kemarin tidak boleh tampil sebagai edisi hari ini.
      nasional: hasOnLatest("nasional") ? latest : null,
      lokal: hasOnLatest("lokal") ? latest : null,
      // Rekap mingguan tetap tampil sepanjang pekan; lebih tua dari jendela
      // dianggap basi dan disembunyikan.
      mingguan: weeklyFresh ? weekly : null,
    },
  };
}
