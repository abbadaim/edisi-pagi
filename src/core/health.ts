/**
 * Deteksi build yang "sukses" tetapi turun mutu.
 *
 * Kasus yang pernah terjadi: pipeline selesai, deploy jalan, tetapi penulis
 * deterministik yang dipakai sehingga edisi hanya berisi satu kartu hoaks
 * (2026-11-15 dan 2026-11-16). Tidak ada workflow yang gagal, jadi tidak ada
 * notifikasi apa pun. Fungsi di sini menilai hasil build dari `edition.json`
 * dan `manifest.json`, bukan dari status job.
 */

export interface EditionLike {
  edition_id: string;
  scope: string;
  cards: Array<{ type: string }>;
  generated_by?: Record<string, { provider?: string; model?: string }>;
}

export interface ManifestLike {
  latest?: string | null;
  latest_by_scope?: Record<string, string | null>;
}

export type HealthReason =
  | "no-edition"
  | "deterministic-writer"
  | "deterministic-adjudicate"
  | "few-cards"
  | "not-published"
  | "edition-not-yesterday";

export interface HealthReport {
  ok: boolean;
  date: string;
  scope: string;
  cards: number;
  providers: { adjudicate: string; write: string; verify: string };
  reasons: HealthReason[];
  summary: string;
}

export interface AssessInput {
  date: string;
  scope: string;
  edition: EditionLike | null;
  manifest?: ManifestLike | null;
  /** Minimum kartu yang dianggap edisi utuh. Default 4. */
  minCards?: number;
}

const REASON_TEXT: Record<HealthReason, string> = {
  "no-edition": "edisi tidak terbentuk",
  "deterministic-writer": "penulis deterministik (OpenCode tidak dipakai)",
  "deterministic-adjudicate": "adjudikasi deterministik",
  "few-cards": "kartu terlalu sedikit",
  "not-published": "manifest tidak menunjuk edisi ini",
  "edition-not-yesterday": "edisi bukan untuk tanggal ini",
};

export function assessEdition(input: AssessInput): HealthReport {
  // Rekap mingguan selalu memakai adjudikasi fallback dan minimal 3 thread
  // (`scripts/weekly.ts`), jadi ambangnya berbeda dari edisi harian.
  const weekly = input.scope === "mingguan";
  const minCards = input.minCards ?? (weekly ? 3 : 4);
  const edition = input.edition;
  const reasons: HealthReason[] = [];

  if (!edition) {
    reasons.push("no-edition");
    const summary = `${input.date} ${input.scope}: ${REASON_TEXT["no-edition"]}`;
    return {
      ok: false,
      date: input.date,
      scope: input.scope,
      cards: 0,
      providers: { adjudicate: "none", write: "none", verify: "none" },
      reasons,
      summary,
    };
  }

  const providers = {
    adjudicate: edition.generated_by?.adjudicate?.provider ?? "tidak diketahui",
    write: edition.generated_by?.write?.provider ?? "tidak diketahui",
    verify: edition.generated_by?.verify?.provider ?? "tidak diketahui",
  };

  if (edition.edition_id !== input.date) reasons.push("edition-not-yesterday");
  if (providers.write !== "opencode") reasons.push("deterministic-writer");
  if (!weekly && providers.adjudicate !== "opencode") reasons.push("deterministic-adjudicate");
  if (edition.cards.length < minCards) reasons.push("few-cards");

  if (input.manifest) {
    const byScope = input.manifest.latest_by_scope ?? {};
    if (input.manifest.latest !== input.date || byScope[input.scope] !== input.date) {
      reasons.push("not-published");
    }
  }

  const summary =
    `${input.date} ${input.scope} · ${edition.cards.length} kartu · ` +
    `tulis: ${providers.write} · adjudikasi: ${providers.adjudicate}` +
    (reasons.length ? ` · ALASAN: ${reasons.join(", ")}` : " · sehat");

  return {
    ok: reasons.length === 0,
    date: input.date,
    scope: input.scope,
    cards: edition.cards.length,
    providers,
    reasons,
    summary,
  };
}

/**
 * Alasan yang membuat run harus berstatus merah, bukan hanya surel
 * (DEC-0038). Edisi yang tidak terbentuk tidak boleh terlihat "sukses":
 * pada 2026-11-17 run hijau padahal tidak ada yang terbit.
 */
export const FATAL_REASONS: HealthReason[] = ["no-edition"];

export function fatalReasons(report: HealthReport): HealthReason[] {
  return report.reasons.filter((r) => FATAL_REASONS.includes(r));
}

export interface AlertMeta {
  repo?: string;
  runUrl?: string;
  jobStatus?: string;
  /** Uji kirim: subjek ditandai jelas supaya tidak dikira kegagalan nyata. */
  test?: boolean;
}

/** Surel polos. Tanpa HTML supaya tidak ada yang terpotong di klien mana pun. */
export function composeAlert(report: HealthReport, meta: AlertMeta = {}): { subject: string; body: string } {
  const bad = !report.ok;
  const subject = meta.test
    ? "[Edisi Pagi] uji kirim peringatan"
    : bad
      ? `[Edisi Pagi] build turun mutu: ${report.date} ${report.scope}`
      : `[Edisi Pagi] build sehat: ${report.date} ${report.scope}`;

  const lines = [
    meta.test ? "Ini uji kirim. Tidak ada build yang gagal." : "",
    meta.test ? "" : "",
    report.summary,
    "",
    `Kartu        : ${report.cards}`,
    `Tulis        : ${report.providers.write}`,
    `Adjudikasi   : ${report.providers.adjudicate}`,
    `Verifikasi   : ${report.providers.verify}`,
    `Status job   : ${meta.jobStatus ?? "tidak diketahui"}`,
  ];

  if (bad) {
    lines.push("", "Yang perlu diperiksa:");
    for (const r of report.reasons) lines.push(`- ${REASON_TEXT[r]} (${r})`);
    lines.push(
      "",
      "Kalau penyebabnya OpenCode: cek versi CLI, auth import, dan katalog model",
      "(DEC-0018). Jangan menerbitkan ulang tanggal yang sudah terbit.",
    );
  }

  if (meta.runUrl) lines.push("", `Run: ${meta.runUrl}`);
  if (meta.repo) lines.push(`Repo: ${meta.repo}`);

  return { subject, body: `${lines.join("\n")}\n` };
}
