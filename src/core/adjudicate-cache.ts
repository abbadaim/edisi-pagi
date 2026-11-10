import { createHash } from "node:crypto";
import type { Db } from "../adapters/db/sqlite.ts";
import type { AdjudicationResult, ClusterSummary } from "./adjudicate.ts";

/**
 * Sidik masukan adjudikasi. Memakai ringkasan yang benar-benar dikirim ke model,
 * bukan artikel mentah: kalau ringkasannya sama, keputusannya harus sama.
 */
export function hashSummaries(summaries: ClusterSummary[]): string {
  const canonical = summaries.map((s) => ({
    cid: s.cid,
    n: s.n_articles,
    outlets: [...s.outlets].sort(),
    entities: [...s.entities].sort(),
    titles: s.titles,
    ambiguous: s.ambiguous,
  }));
  return createHash("sha1").update(JSON.stringify(canonical)).digest("hex").slice(0, 16);
}

export function loadAdjudication(
  db: Db,
  editionId: string,
  inputHash: string,
): AdjudicationResult | null {
  const row = db.get<{ output_json: string }>(
    "SELECT output_json FROM adjudications WHERE edition_id = ? AND input_hash = ?",
    [editionId, inputHash],
  );
  if (!row) return null;
  try {
    return JSON.parse(row.output_json) as AdjudicationResult;
  } catch {
    return null;
  }
}

export function saveAdjudication(
  db: Db,
  editionId: string,
  inputHash: string,
  result: AdjudicationResult,
  now = new Date(),
): void {
  db.run(
    `INSERT INTO adjudications (edition_id, input_hash, output_json, created_at)
     VALUES (?,?,?,?)
     ON CONFLICT(edition_id, input_hash) DO UPDATE SET output_json = excluded.output_json`,
    [editionId, inputHash, JSON.stringify(result), now.toISOString()],
  );
}
