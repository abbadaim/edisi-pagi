/**
 * Cek kesehatan hasil build. Dipakai langkah CI setelah build/publish.
 *
 * Selalu keluar dengan kode 0: kegagalan build sudah ditangani langkah lain.
 * Yang dicari di sini adalah build yang "sukses" tetapi turun mutu, supaya
 * langkah berikutnya bisa mengirim peringatan.
 *
 *   node scripts/health.ts --date 2026-11-16 --scope nasional
 *   node scripts/health.ts --editions data/editions --manifest public/manifest.json
 */

import { readFileSync, existsSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assessEdition, fatalReasons } from "../src/core/health.ts";
import { buildStatus } from "../src/core/status.ts";
import type { EditionLike, ManifestLike } from "../src/core/health.ts";
import { isoWib } from "../src/core/time.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  return process.argv[i + 1] ?? fallback;
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

const editionsDir = arg("editions", "data/editions")!;
const manifestPath = arg("manifest", "public/manifest.json")!;
const date = arg("date", isoWib(new Date())!.slice(0, 10))!;
const scope = arg("scope", "nasional")!;
const strict = process.argv.includes("--strict");
const minCardsArg = arg("min-cards");
const minCards = minCardsArg ? Number(minCardsArg) : undefined;

const edition = readJson<Record<string, unknown>>(join(editionsDir, `${date}.${scope}.json`));
const manifest = readJson<ManifestLike>(manifestPath);

const report = assessEdition({
  date,
  scope,
  edition: edition ? (edition as unknown as EditionLike) : null,
  manifest,
  minCards,
});

console.log(report.summary);
console.log(JSON.stringify(report));

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  const mark = report.ok ? "✅" : "⚠️";
  appendFileSync(
    summaryPath,
    `## ${mark} Kesehatan build ${report.date} (${report.scope})\n\n` +
      `| | |\n|---|---|\n` +
      `| Kartu | ${report.cards} |\n` +
      `| Tulis | ${report.providers.write} |\n` +
      `| Adjudikasi | ${report.providers.adjudicate} |\n` +
      `| Alasan | ${report.reasons.length ? report.reasons.join(", ") : "—"} |\n\n`,
  );
}

const jsonOut = arg("out");
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report));

// Laporan untuk tab Atur: ditulis walau build gagal, supaya pembaca tahu
// kenapa edisi hari ini tidak ada sebelum menekan "Minta edisi".
const statusOut = arg("status-out");
if (statusOut) {
  const runUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null;
  writeFileSync(
    statusOut,
    JSON.stringify(
      buildStatus({
        report,
        checkedAt: new Date(),
        latest: manifest?.latest ?? null,
        latestByScope: manifest?.latest_by_scope ?? {},
        runUrl,
      }),
      null,
      2,
    ),
  );
}

const outPath = process.env.GITHUB_OUTPUT;
if (outPath) {
  appendFileSync(
    outPath,
    `degraded=${report.ok ? "false" : "true"}\n` +
      `summary=${report.summary.replace(/\n/g, " ")}\n` +
      `reasons=${report.reasons.join(",")}\n`,
  );
}

// Degradasi yang masih bisa terbit (penulis deterministik, kartu sedikit) tetap
// hijau: peringatan dikirim, publish tetap jalan. `--strict` hanya memerahkan
// hal yang berarti tidak ada edisi sama sekali.
const fatal = fatalReasons(report);
if (strict && fatal.length > 0) {
  console.log(`✗ fatal: ${fatal.join(", ")} — tidak ada edisi untuk diterbitkan`);
  process.exit(1);
}

process.exit(0);
