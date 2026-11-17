import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStatus, reasonText } from "../src/core/status.ts";

const report = {
  ok: false,
  date: "2026-11-17",
  scope: "nasional",
  cards: 0,
  providers: { adjudicate: "none", write: "none", verify: "none" },
  reasons: ["no-edition" as const],
  summary: "2026-11-17 nasional: edisi tidak terbentuk",
};

test("status: memuat alasan, provider, dan manifest", () => {
  const s = buildStatus({
    report,
    checkedAt: new Date("2026-11-17T03:00:00Z"),
    latest: "2026-11-16",
    latestByScope: { nasional: "2026-11-16", lokal: null, mingguan: "2026-11-16" },
    runUrl: "https://example.test/run/1",
  });
  assert.equal(s.ok, false);
  assert.deepEqual(s.reasons, ["no-edition"]);
  assert.equal(s.latest, "2026-11-16");
  assert.equal(s.latest_by_scope.mingguan, "2026-11-16");
  assert.equal(s.run_url, "https://example.test/run/1");
});

test("status: alasan diterjemahkan untuk layar Atur", () => {
  assert.match(reasonText("no-edition"), /edisi tidak terbentuk/);
  assert.match(reasonText("deterministic-writer"), /deterministik/);
  assert.equal(reasonText("sesuatu-baru"), "sesuatu-baru");
});
