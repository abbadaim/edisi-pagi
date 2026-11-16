import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFrames, headlineFromUrl, hasFrames } from "../src/core/frames.ts";

const src = (outlet: string, url: string, at: string | null = null) => ({ outlet, url, published_at: at });

test("judul diambil dari tabel articles, bukan dari slug", () => {
  const titles = new Map([["https://tirto.id/a", "Judul asli Tirto"]]);
  const out = buildFrames([src("tirto.id", "https://tirto.id/a")], titles);
  assert.equal(out[0]!.title, "Judul asli Tirto");
});

test("URL tanpa baris di tabel jatuh ke slug, bukan dikarang", () => {
  const out = buildFrames([src("cnnindonesia.com", "https://www.cnnindonesia.com/nasional/prabowo-terima-surat-gibran")], new Map());
  assert.equal(out[0]!.title, "Prabowo terima surat gibran");
});

test("satu baris per media, urut terbaru, dipotong limit", () => {
  const s = [
    src("a.com", "https://a.com/1", "2026-11-15T10:00:00+07:00"),
    src("b.com", "https://b.com/1", "2026-11-16T10:00:00+07:00"),
    src("a.com", "https://a.com/2", "2026-11-16T11:00:00+07:00"),
  ];
  const out = buildFrames(s, new Map(), 1);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.outlet, "b.com", "yang terbaru dulu");
});

test("strip butuh minimal dua media", () => {
  assert.equal(hasFrames(buildFrames([src("a.com", "https://a.com/x")], new Map())), false);
  assert.equal(
    hasFrames(buildFrames([src("a.com", "https://a.com/x"), src("b.com", "https://b.com/y")], new Map())),
    true,
  );
});

test("slug: buang ekor id dan rapikan huruf", () => {
  assert.equal(headlineFromUrl("https://tirto.id/gibran-mundur-proses-teratur-idJB"), "Gibran mundur proses teratur");
});
