import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTruth } from "../src/core/truth.ts";

const src = (outlet: string, url: string) => ({ outlet, url, tier: 2 as const });

test("tiga domain satu pemilik dihitung satu suara", () => {
  const sources = [
    src("detik.com", "https://news.detik.com/a"),
    src("cnnindonesia.com", "https://www.cnnindonesia.com/b"),
    src("cnbcindonesia.com", "https://www.cnbcindonesia.com/c"),
  ];
  const owners = new Map([
    ["detik.com", "CT Corp"],
    ["cnnindonesia.com", "CT Corp"],
    ["cnbcindonesia.com", "CT Corp"],
  ]);

  const domainOnly = computeTruth({ claim: "x", sources }, new Date("2026-11-16T06:00:00Z"));
  const byOwner = computeTruth({ claim: "x", sources }, new Date("2026-11-16T06:00:00Z"), {
    ownerOf: (o) => owners.get(o) ?? null,
  });

  assert.equal(domainOnly.basis.independent_outlets, 3);
  assert.equal(byOwner.basis.independent_outlets, 1);
  assert.equal(byOwner.basis.independent_owners, 1);
  assert.ok(byOwner.confidence < domainOnly.confidence, "satu pemilik menurunkan keyakinan");
});

test("pemilik berbeda menambah suara walau domainnya sudah dihitung", () => {
  const sources = [src("detik.com", "https://news.detik.com/a"), src("tirto.id", "https://tirto.id/b")];
  const owners = new Map([
    ["detik.com", "CT Corp"],
    ["tirto.id", "Tirto"],
  ]);
  const r = computeTruth({ claim: "x", sources }, new Date("2026-11-16T06:00:00Z"), {
    ownerOf: (o) => owners.get(o) ?? null,
  });
  assert.equal(r.basis.independent_owners, 2);
});

test("outlet tanpa registry tetap dihitung per domain", () => {
  const sources = [src("detik.com", "https://news.detik.com/a"), src("tirto.id", "https://tirto.id/b")];
  const r = computeTruth({ claim: "x", sources }, new Date("2026-11-16T06:00:00Z"), {
    ownerOf: (o) => (o === "detik.com" ? "CT Corp" : null),
  });
  assert.equal(r.basis.independent_owners, 1);
  assert.equal(r.basis.independent_outlets, 2, "satu owner + satu domain");
});
