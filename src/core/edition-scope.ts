/**
 * Scope edisi yang dibangun. Edisi lokal (Sleman) dihentikan: dari 10–14
 * November hanya lima hari yang menghasilkan edisi, sisanya tidak lolos ambang
 * dua kartu. Slotnya dipindahkan ke tindak lanjut (rencana 019).
 *
 * Rollback: `LOCAL_EDITION=1`.
 */
export const LOCAL_EDITION_ENV = "LOCAL_EDITION";

export function localEditionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[LOCAL_EDITION_ENV] === "1";
}
