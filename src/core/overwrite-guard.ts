/**
 * Edisi terbit bersifat immutable. Skrip build harian belum punya penjaga ini
 * (dijaga oleh disiplin tanggal), tetapi rekap mingguan sering dipicu ulang
 * manual untuk tanggal yang sama, jadi penjaganya harus eksplisit.
 */
export function canWriteEdition(opts: { exists: boolean; force?: boolean }): boolean {
  if (!opts.exists) return true;
  return opts.force === true;
}

export function guardMessage(file: string): string {
  return `sudah ada: ${file} — dilewati (pakai --force untuk menimpa)`;
}
