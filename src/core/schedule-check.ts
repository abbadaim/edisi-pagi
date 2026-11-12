/**
 * `DEC-0028`: jadwal GitHub bisa membuang trigger tanpa mengubah status
 * workflow. Verifikasi manual (`docs/plans/009-schedule-verification.md`)
 * bergantung pada ada orang yang ingat; ini versi yang berjalan sendiri.
 *
 * Logika keputusan dibuat murni supaya bisa diuji tanpa jaringan, tanpa `gh`,
 * dan tanpa jam sungguhan.
 */
export interface ManifestLike {
  latest?: string | null;
  latest_by_scope?: Record<string, string | null> | null;
}

export interface ScheduleVerdict {
  ok: boolean;
  /** Tanggal WIB yang seharusnya terbit hari ini. */
  expected: string;
  /** Edisi nasional terbaru menurut manifest. */
  latest: string | null;
  reason: string;
}

export function scheduleVerdict(manifest: ManifestLike, todayWib: string): ScheduleVerdict {
  const latest = manifest.latest_by_scope?.nasional ?? manifest.latest ?? null;

  if (!latest) {
    return { ok: false, expected: todayWib, latest: null, reason: "manifest tidak memuat edisi nasional" };
  }
  if (latest === todayWib) {
    return { ok: true, expected: todayWib, latest, reason: "edisi hari ini sudah terbit" };
  }
  // Edisi hari ini tidak ada. Edisi yang lebih baru dari perkiraan juga bukan
  // masalah: itu berarti jam mesin berbeda, bukan jadwal yang hilang.
  if (latest > todayWib) {
    return { ok: true, expected: todayWib, latest, reason: "manifest lebih baru dari tanggal hari ini" };
  }
  return { ok: false, expected: todayWib, latest, reason: "edisi hari ini belum terbit" };
}
