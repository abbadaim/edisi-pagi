/** Format waktu untuk edisi: selalu +07:00 (SCHEMA.md I4). */
export function isoWib(input: Date | string | null): string | null {
  if (input === null) return null;
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return null;
  const wib = new Date(d.getTime() + 7 * 3_600_000);
  return wib.toISOString().replace(/\.\d+Z$/, "+07:00");
}

/** Tanggal baca (YYYY-MM-DD) menurut WIB. */
export function wibDate(input: Date | string): string {
  const d = typeof input === "string" ? new Date(input) : input;
  return new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}
