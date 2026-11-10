import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAliases } from "../src/core/normalize.ts";
import { entityId, extractEntities, isDistinctive } from "../src/core/entities.ts";

const aliases = buildAliases({
  jokowi: ["Joko Widodo", "Pakde Jokowi"],
  gibran: ["Gibran Rakabuming Raka"],
  hmp: ["Hak Menyatakan Pendapat"],
  mui: ["Majelis Ulama Indonesia"],
  ojk: ["Otoritas Jasa Keuangan"],
});

const ids = (title: string, lead = "") => extractEntities(title, lead, aliases).map((e) => e.id);

test("entityId menormalkan nama", () => {
  assert.equal(entityId("Gibran Rakabuming Raka"), "gibran_rakabuming_raka");
  assert.equal(entityId("  DPR  "), "dpr");
});

test("gazetteer menangkap alias panjang", () => {
  const e = ids("Pakde Jokowi Bicara soal Ijazah");
  assert.ok(e.includes("jokowi"), e.join(","));
});

test("gazetteer menangkap frasa", () => {
  const e = ids("DPR Gulirkan Hak Menyatakan Pendapat");
  assert.ok(e.includes("hmp"), e.join(","));
});

test("akronim tertangkap tanpa gazetteer", () => {
  const e = ids("BMKG Keluarkan Peringatan Cuaca Ekstrem di DIY");
  assert.ok(e.includes("bmkg"), e.join(","));
});

test("akronim umum dibuang", () => {
  const e = ids("VIDEO: Demo di Depan Gedung");
  assert.ok(!e.includes("video"), e.join(","));
});

test("nama orang berhuruf besar tertangkap", () => {
  const e = ids("Mardani Ali Sera Bicara Soal HMP");
  assert.ok(e.some((x) => x.includes("mardani")), e.join(","));
});

test("nama hari tidak jadi entitas", () => {
  const e = ids("Selasa, 10 November 2026 - Demo di Jakarta");
  assert.ok(!e.includes("selasa"), e.join(","));
});

test("entitas duplikat tidak muncul dua kali", () => {
  const e = ids("Joko Widodo dan Pakde Jokowi", "Presiden Jokowi hadir");
  assert.equal(e.filter((x) => x === "jokowi").length, 1);
});

test("isDistinctive memakai ambang IDF", () => {
  assert.equal(isDistinctive(2.0), true);
  assert.equal(isDistinctive(1.0), false);
});
