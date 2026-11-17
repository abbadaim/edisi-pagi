/**
 * `public/status.json` — laporan singkat kenapa edisi hari ini ada atau tidak.
 *
 * Ditulis langkah kesehatan di CI, bukan oleh model, dan dibaca tab Atur
 * sebelum tombol "Minta edisi" dipakai. Tujuannya menjawab satu pertanyaan:
 * "kalau tidak terbit, siapa yang salah dan sejak kapan".
 */

import type { HealthReport } from "./health.ts";

export interface StatusFile {
  /** Tanggal WIB yang diperiksa. */
  date: string;
  /** Kapan pemeriksaan dijalankan (ISO). */
  checked_at: string;
  ok: boolean;
  cards: number;
  providers: { adjudicate: string; write: string; verify: string };
  reasons: string[];
  summary: string;
  /** Manifest yang dibaca saat pemeriksaan; null bila tidak terbaca. */
  latest: string | null;
  latest_by_scope: Record<string, string | null>;
  run_url: string | null;
}

export interface StatusInput {
  report: HealthReport;
  checkedAt: Date;
  latest: string | null;
  latestByScope: Record<string, string | null>;
  runUrl?: string | null;
}

export function buildStatus(input: StatusInput): StatusFile {
  return {
    date: input.report.date,
    checked_at: input.checkedAt.toISOString(),
    ok: input.report.ok,
    cards: input.report.cards,
    providers: input.report.providers,
    reasons: input.report.reasons,
    summary: input.report.summary,
    latest: input.latest,
    latest_by_scope: input.latestByScope,
    run_url: input.runUrl ?? null,
  };
}

/** Alasan yang bisa dibaca manusia di layar Atur. */
export function reasonText(reason: string): string {
  switch (reason) {
    case "no-edition":
      return "edisi tidak terbentuk — build gagal atau belum jalan";
    case "deterministic-writer":
      return "penulis deterministik (OpenCode tidak dipakai)";
    case "deterministic-adjudicate":
      return "adjudikasi deterministik";
    case "few-cards":
      return "kartu terlalu sedikit";
    case "not-published":
      return "manifest belum menunjuk edisi ini";
    case "edition-not-yesterday":
      return "tanggal edisi tidak cocok dengan tanggal build";
    default:
      return reason;
  }
}
