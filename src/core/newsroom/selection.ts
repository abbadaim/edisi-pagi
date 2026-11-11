/**
 * Kuota tindak lanjut (NEWSROOM-IMPLEMENTATION.md P2).
 *
 * Tindak lanjut memakai slot kartu normal, tetapi tidak boleh mengisi seluruh
 * edisi. Berita baru diutamakan; bila tidak ada berita baru, tidak ada
 * tindak lanjut yang dipaksakan.
 */

export interface BudgetItem {
  topicId: string;
  followUp: boolean;
}

export interface BudgetOptions {
  maxFollow: number;
  minFresh: number;
  target: number;
}

export function budgetFollowUps<T extends BudgetItem>(
  selected: T[],
  freshPool: T[],
  opts: BudgetOptions,
): T[] {
  let fresh = selected.filter((r) => !r.followUp);
  let follows = selected.filter((r) => r.followUp).slice(0, opts.maxFollow);

  // Isi kekurangan dari kandidat baru yang kalah kuota, bukan dari cerita lama.
  if (fresh.length + follows.length < opts.target) {
    const extra = freshPool
      .filter((r) => !r.followUp)
      .filter((r) => !selected.some((s) => s.topicId === r.topicId))
      .filter((r) => !fresh.some((f) => f.topicId === r.topicId));
    fresh = [...fresh, ...extra.slice(0, opts.target - fresh.length - follows.length)];
  }

  // Bila berita baru kurang dari minimum, tindak lanjut tidak boleh melebihi
  // jumlah berita baru. Nol berita baru = nol tindak lanjut.
  const followCap = fresh.length >= opts.minFresh ? opts.maxFollow : Math.min(opts.maxFollow, fresh.length);
  follows = follows.slice(0, followCap);

  const allowed = new Set([...fresh, ...follows].map((r) => r.topicId));
  const final = selected.filter((r) => allowed.has(r.topicId));
  for (const r of [...fresh, ...follows]) {
    if (!final.some((f) => f.topicId === r.topicId)) final.push(r);
  }
  return final;
}
