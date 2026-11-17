/**
 * Penjaga idempoten untuk jadwal berlapis (rencana 021).
 *
 * Cron GitHub bisa membuang trigger (DEC-0028). Solusinya beberapa jendela
 * cron; supaya jendela kedua tidak menimpa edisi yang sudah terbit, setiap run
 * memeriksa dulu apakah `<tanggal>.nasional.json` sudah ada di repo.
 *
 *   node scripts/edition-guard.ts            # tanggal WIB hari ini
 *   node scripts/edition-guard.ts --date 2026-11-17
 */

import { existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { canWriteEdition } from "../src/core/overwrite-guard.ts";
import { wibDate } from "../src/core/time.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  return process.argv[i + 1] ?? fallback;
}

const root = new URL("..", import.meta.url).pathname;
const date = arg("date") ?? wibDate(new Date());
const file = join(root, "data", "editions", `${date}.nasional.json`);
const exists = existsSync(file);
const force = process.argv.includes("--force");
const proceed = canWriteEdition({ exists, force });

console.log(
  proceed
    ? `guard: ${date} belum ada — lanjut`
    : `guard: ${date} sudah terbit (${file}) — dilewati (pakai --force untuk membangun ulang)`,
);

const out = process.env.GITHUB_OUTPUT;
if (out) appendFileSync(out, `skip=${proceed ? "false" : "true"}\ndate=${date}\n`);
process.exit(0);
