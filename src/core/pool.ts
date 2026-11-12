/**
 * Batas konkurensi sederhana. Urutan hasil selalu sama dengan urutan masukan,
 * sehingga pemanggil tidak perlu menyusun ulang.
 *
 * Dipakai riset bahan (`material.ts`) dan pembangunan kartu (`build.ts`,
 * `DEC-0025`).
 */
export async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length));

  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });

  await Promise.all(workers);
  return out;
}
