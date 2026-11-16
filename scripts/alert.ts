/**
 * Kirim peringatan build lewat surel (SMTP) atau webhook.
 *
 *   node scripts/alert.ts --dry-run            # cetak saja, tidak mengirim
 *   node scripts/alert.ts --input health.json
 *
 * Kredensial dibaca dari env; kalau tidak lengkap, hanya menulis peringatan.
 * Kegagalan mengirim **tidak** menggagalkan workflow — penerbitan lebih penting
 * daripada notifikasinya.
 */

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { composeAlert } from "../src/core/health.ts";
import type { HealthReport } from "../src/core/health.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  return process.argv[i + 1] ?? fallback;
}

const dryRun = process.argv.includes("--dry-run");
const inputPath = arg("input");

let raw = process.env.HEALTH_JSON ?? "";
if (!raw && inputPath && existsSync(inputPath)) raw = readFileSync(inputPath, "utf8");
if (!raw) {
  console.log("health: tidak ada data kesehatan — peringatan dilewati");
  process.exit(0);
}

let report: HealthReport;
try {
  report = JSON.parse(raw) as HealthReport;
} catch {
  console.log("health: data kesehatan bukan JSON — peringatan dilewati");
  process.exit(0);
}

const meta = {
  repo: process.env.GITHUB_REPOSITORY,
  runUrl:
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined,
  jobStatus: process.env.JOB_STATUS,
};

const jobFailed = process.env.JOB_STATUS === "failure";
if (report.ok && !jobFailed) {
  console.log(`sehat — tidak ada peringatan: ${report.summary}`);
  process.exit(0);
}

const { subject, body } = composeAlert(report, meta);
const message = ["From: " + (process.env.ALERT_FROM ?? ""), "To: " + (process.env.ALERT_TO ?? ""), `Subject: ${subject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", body].join("\r\n");

if (dryRun) {
  console.log(`--- ${subject}\n\n${message}`);
  process.exit(0);
}

const smtpUrl = process.env.ALERT_SMTP_URL;
const user = process.env.ALERT_SMTP_USER;
const pass = process.env.ALERT_SMTP_PASS;
const to = process.env.ALERT_TO;
const from = process.env.ALERT_FROM;

if (!smtpUrl || !user || !pass || !to || !from) {
  console.log("peringatan tidak dikirim: secret surel belum lengkap (ALERT_SMTP_URL/USER/PASS/TO/FROM)");
  console.log(`ringkas: ${report.summary}`);
  process.exit(0);
}

const r = spawnSync(
  "curl",
  [
    "--silent",
    "--show-error",
    "--ssl-reqd",
    "--url",
    smtpUrl,
    "--user",
    `${user}:${pass}`,
    "--mail-from",
    from,
    "--mail-rcpt",
    to,
    "--upload-file",
    "-",
  ],
  { input: message, encoding: "utf8", timeout: 30_000 },
);

if (r.status === 0) {
  console.log(`peringatan terkirim ke ${to}`);
} else {
  console.log(`gagal mengirim peringatan (curl ${r.status ?? "?"}): ${(r.stderr ?? "").slice(0, 200)}`);
}
process.exit(0);
