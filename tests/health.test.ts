import { test } from "node:test";
import assert from "node:assert/strict";
import { assessEdition, composeAlert } from "../src/core/health.ts";

function edition(overrides: Record<string, unknown> = {}) {
  return {
    edition_id: "2026-11-16",
    scope: "nasional",
    cards: [{ type: "news" }, { type: "news" }, { type: "news" }, { type: "news" }],
    generated_by: {
      adjudicate: { provider: "opencode" },
      write: { provider: "opencode" },
      verify: { provider: "opencode" },
    },
    ...overrides,
  };
}

const manifest = { latest: "2026-11-16", latest_by_scope: { nasional: "2026-11-16" } };

test("edisi OpenCode dengan kartu cukup dianggap sehat", () => {
  const r = assessEdition({ date: "2026-11-16", scope: "nasional", edition: edition(), manifest });
  assert.equal(r.ok, true);
  assert.deepEqual(r.reasons, []);
});

test("penulis deterministik ditandai walau build sukses", () => {
  const e = edition({
    cards: [{ type: "hoax_roundup" }],
    generated_by: {
      adjudicate: { provider: "fallback" },
      write: { provider: "deterministic" },
      verify: { provider: "rules" },
    },
  });
  const r = assessEdition({ date: "2026-11-16", scope: "nasional", edition: e, manifest });
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons.sort(), ["deterministic-adjudicate", "deterministic-writer", "few-cards"]);
});

test("edisi tidak terbentuk jadi alasan tersendiri", () => {
  const r = assessEdition({ date: "2026-11-17", scope: "nasional", edition: null, manifest });
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ["no-edition"]);
  assert.match(r.summary, /tidak terbentuk/);
});

test("manifest yang tidak menunjuk edisi ini terdeteksi", () => {
  const r = assessEdition({
    date: "2026-11-16",
    scope: "nasional",
    edition: edition(),
    manifest: { latest: "2026-11-15", latest_by_scope: { nasional: "2026-11-15" } },
  });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.includes("not-published"));
});

test("tanggal edisi yang berbeda dari tanggal build terdeteksi", () => {
  const r = assessEdition({
    date: "2026-11-16",
    scope: "nasional",
    edition: edition({ edition_id: "2026-11-14" }),
    manifest,
  });
  assert.ok(r.reasons.includes("edition-not-yesterday"));
});

test("surel peringatan memuat alasan dan larangan bangun ulang", () => {
  const r = assessEdition({
    date: "2026-11-16",
    scope: "nasional",
    edition: edition({
      cards: [{ type: "hoax_roundup" }],
      generated_by: { adjudicate: { provider: "fallback" }, write: { provider: "deterministic" } },
    }),
    manifest,
  });
  const mail = composeAlert(r, { runUrl: "https://example.test/run/1", jobStatus: "success" });
  assert.match(mail.subject, /turun mutu/);
  assert.match(mail.body, /penulis deterministik/);
  assert.match(mail.body, /Jangan menerbitkan ulang tanggal yang sudah terbit/);
  assert.match(mail.body, /example\.test/);
});
