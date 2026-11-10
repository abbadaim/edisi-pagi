import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTruth } from "../src/core/truth.ts";

const now = new Date("2026-11-10T08:00:00Z");
const s = (tier: 1 | 2 | 3, url: string) => ({ outlet: new URL(url).hostname, url, tier });

test("sumber primer -> terkonfirmasi dan hampir pasti", () => {
  const t = computeTruth({ claim: "x", sources: [s(1, "https://bnpb.go.id/a"), s(2, "https://detik.com/b")] }, now);
  assert.equal(t.status, "terkonfirmasi");
  assert.equal(t.band, "hampir_pasti");
  assert.ok(t.confidence >= 0.9);
});

test("dua media tier 2 -> sebagian, kemungkinan besar", () => {
  const t = computeTruth(
    { claim: "x", sources: [s(2, "https://detik.com/a"), s(2, "https://cnnindonesia.com/b")] },
    now,
  );
  assert.equal(t.status, "sebagian");
  assert.equal(t.band, "kemungkinan_besar");
});

test("satu media tier 2 -> belum pasti", () => {
  const t = computeTruth({ claim: "x", sources: [s(2, "https://detik.com/a")] }, now);
  assert.equal(t.status, "sebagian");
  assert.equal(t.band, "belum_pasti");
});

test("sumber tidak kredibel -> diragukan", () => {
  const t = computeTruth({ claim: "x", sources: [s(3, "https://blog.example.com/a")] }, now);
  assert.equal(t.status, "belum");
  assert.ok(["diragukan", "kemungkinan_tidak"].includes(t.band));
});

test("bantahan -> dibantah dan keyakinan rendah", () => {
  const t = computeTruth(
    { claim: "x", sources: [s(1, "https://bnpb.go.id/a")], contradicting: 1 },
    now,
  );
  assert.equal(t.status, "dibantah");
  assert.equal(t.confidence, 0.05);
});

test("domain satu grup media dihitung satu", () => {
  const t = computeTruth(
    {
      claim: "x",
      sources: [
        s(2, "https://kompas.com/a"),
        s(2, "https://nasional.kompas.com/b"),
        s(2, "https://megapolitan.kompas.com/c"),
      ],
    },
    now,
  );
  assert.equal(t.basis.independent_outlets, 1);
  assert.ok(t.confidence < 0.8, `confidence ${t.confidence}`);
});

test("klaim angka menurunkan keyakinan", () => {
  const src = [s(2, "https://detik.com/a"), s(2, "https://cnnindonesia.com/b")];
  const plain = computeTruth({ claim: "x", sources: src }, now);
  const numeric = computeTruth({ claim: "x", sources: src, numeric: true }, now);
  assert.ok(numeric.confidence < plain.confidence);
});

test("keyakinan selalu dalam rentang", () => {
  const cases = [
    computeTruth({ claim: "x", sources: [] }, now),
    computeTruth({ claim: "x", sources: [s(1, "https://a.go.id/x")], officialDenialPending: true }, now),
  ];
  for (const c of cases) {
    assert.ok(c.confidence >= 0.05 && c.confidence <= 0.97, String(c.confidence));
  }
});
