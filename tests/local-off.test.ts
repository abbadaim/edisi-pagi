import { test } from "node:test";
import assert from "node:assert/strict";
import { localEditionEnabled } from "../src/core/edition-scope.ts";
import { SCOPE_BUDGET, budgetFollowUps } from "../src/core/newsroom/selection.ts";
import { selectLatest } from "../src/core/manifest.ts";
import { canWriteEdition } from "../src/core/overwrite-guard.ts";

test("edisi lokal mati secara default (rencana 019)", () => {
  assert.equal(localEditionEnabled({}), false);
  assert.equal(localEditionEnabled({ LOCAL_EDITION: "0" }), false);
});

test("LOCAL_EDITION=1 mengembalikan perilaku lama", () => {
  assert.equal(localEditionEnabled({ LOCAL_EDITION: "1" }), true);
});

test("manifest tanpa edisi lokal memberi lokal: null, bukan tanggal lama", () => {
  const sel = selectLatest([
    { edition_id: "2026-11-14", scope: "lokal" },
    { edition_id: "2026-11-15", scope: "nasional" },
    { edition_id: "2026-11-16", scope: "nasional" },
  ]);
  assert.equal(sel.latest, "2026-11-16");
  assert.equal(sel.latestByScope.nasional, "2026-11-16");
  assert.equal(sel.latestByScope.lokal, null);
});

test("kuota tindak lanjut nasional naik ke 3 tanpa melewati berita baru", () => {
  assert.equal(SCOPE_BUDGET.nasional.maxFollow, 3);
  const fresh = [1, 2, 3, 4].map((n) => ({ topicId: `n${n}`, followUp: false }));
  const follows = [1, 2, 3, 4].map((n) => ({ topicId: `f${n}`, followUp: true }));
  const out = budgetFollowUps([...follows, ...fresh], [], SCOPE_BUDGET.nasional);
  assert.equal(out.filter((x) => x.followUp).length, 3);
  assert.equal(out.filter((x) => !x.followUp).length, 4);
});

test("nol berita baru tetap berarti nol tindak lanjut walau kuota naik", () => {
  const follows = [1, 2, 3].map((n) => ({ topicId: `f${n}`, followUp: true }));
  const out = budgetFollowUps(follows, [], SCOPE_BUDGET.nasional);
  assert.equal(out.filter((x) => x.followUp).length, 0);
});

test("rekap mingguan yang sudah terbit tidak ditimpa tanpa --force", () => {
  assert.equal(canWriteEdition({ exists: false }), true);
  assert.equal(canWriteEdition({ exists: true }), false);
  assert.equal(canWriteEdition({ exists: true, force: true }), true);
});
