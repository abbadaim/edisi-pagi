import { test } from "node:test";
import assert from "node:assert/strict";
import { selectLatest, type ManifestEditionRef } from "../src/core/manifest.ts";

// DEC-0019: tab harian dan mingguan dihitung per irama terbit.

const e = (edition_id: string, scope: string): ManifestEditionRef => ({ edition_id, scope });

test("hari biasa: harian hari ini, mingguan terakhir tetap tampil", () => {
  const out = selectLatest([
    e("2026-11-11", "nasional"),
    e("2026-11-11", "lokal"),
    e("2026-11-10", "mingguan"),
  ]);
  assert.equal(out.latest, "2026-11-11");
  assert.deepEqual(out.latestByScope, {
    nasional: "2026-11-11",
    lokal: "2026-11-11",
    mingguan: "2026-11-10",
  });
});

test("mingguan bertanggal lebih baru tidak menghilangkan tab harian", () => {
  const out = selectLatest([
    e("2026-11-11", "nasional"),
    e("2026-11-11", "lokal"),
    e("2026-11-12", "mingguan"),
  ]);
  assert.equal(out.latest, "2026-11-11", "latest untuk push tetap edisi harian");
  assert.deepEqual(out.latestByScope, {
    nasional: "2026-11-11",
    lokal: "2026-11-11",
    mingguan: "2026-11-12",
  });
});

test("lokal kemarin tidak tampil sebagai lokal hari ini", () => {
  const out = selectLatest([
    e("2026-11-11", "nasional"),
    e("2026-11-10", "lokal"),
    e("2026-11-10", "mingguan"),
  ]);
  assert.equal(out.latestByScope.nasional, "2026-11-11");
  assert.equal(out.latestByScope.lokal, null);
  assert.equal(out.latestByScope.mingguan, "2026-11-10");
});

test("mingguan lebih tua dari 7 hari disembunyikan", () => {
  const out = selectLatest([
    e("2026-11-11", "nasional"),
    e("2026-10-20", "mingguan"),
  ]);
  assert.equal(out.latestByScope.mingguan, null);
});

test("tanpa mingguan, tab mingguan null", () => {
  const out = selectLatest([e("2026-11-11", "nasional")]);
  assert.equal(out.latestByScope.mingguan, null);
});

test("Minggu: harian dan mingguan bertanggal sama", () => {
  const out = selectLatest([
    e("2026-11-15", "nasional"),
    e("2026-11-15", "lokal"),
    e("2026-11-15", "mingguan"),
  ]);
  assert.deepEqual(out.latestByScope, {
    nasional: "2026-11-15",
    lokal: "2026-11-15",
    mingguan: "2026-11-15",
  });
});
