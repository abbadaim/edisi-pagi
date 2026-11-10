import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approxNumber,
  applyAliases,
  buildAliases,
  cleanText,
  decodeEntities,
  displayTitle,
  makeLead,
  normalizeTitle,
} from "../src/core/normalize.ts";

const aliases = buildAliases({
  jokowi: ["Joko Widodo", "Pakde Jokowi"],
  hmp: ["Hak Menyatakan Pendapat"],
  sphp: ["Stabilisasi Pasokan dan Harga Pangan"],
});

test("decodeEntities menangani numerik dan named", () => {
  assert.equal(decodeEntities("Gibran&#8217;s &amp; &quot;HMP&quot;"), `Gibran’s & "HMP"`);
  assert.equal(decodeEntities("a&nbsp;b"), "a b");
});

test("stripTags + cleanText membuang markup", () => {
  assert.equal(cleanText("<p>Halo <b>dunia</b>&nbsp;.</p>"), "Halo dunia.");
});

test("displayTitle membuang boilerplate dan sufiks media", () => {
  assert.equal(displayTitle("Baca juga: Harga Beras Naik"), "Harga Beras Naik");
  assert.equal(displayTitle("MUI Haramkan Vape - CNN Indonesia"), "MUI Haramkan Vape");
  assert.equal(displayTitle("Video: Demo di DPRD"), "Demo di DPRD");
});

test("normalizeTitle membuang tanda baca", () => {
  assert.equal(normalizeTitle("HMP soal Ijazah Gibran!"), "hmp soal ijazah gibran");
});

test("applyAliases menyatukan nama permukaan", () => {
  const out = applyAliases(normalizeTitle("Pakde Jokowi Bicara di DPR"), aliases);
  assert.match(out, /\bjokowi\b/);
  assert.doesNotMatch(out, /pakde/);
});

test("applyAliases menangani frasa multi-kata", () => {
  const out = applyAliases(normalizeTitle("DPR Gulirkan Hak Menyatakan Pendapat"), aliases);
  assert.match(out, /\bhmp\b/);
});

test("applyAliases tidak merusak kata yang mirip", () => {
  const out = applyAliases("jokowisaurus dan pakde jokowi", aliases);
  assert.match(out, /jokowisaurus/);
});

test("makeLead memotong di batas kata", () => {
  const lead = makeLead("kata ".repeat(100), 40);
  assert.ok(lead.length <= 40);
  assert.ok(!lead.endsWith("kat"));
});

test("approxNumber membedakan perkiraan dan pasti", () => {
  assert.deepEqual(approxNumber("puluhan orang"), { value: 30, approx: true });
  assert.deepEqual(approxNumber("50-an orang"), { value: 50, approx: true });
  assert.deepEqual(approxNumber("50 orang"), { value: 50, approx: false });
  assert.equal(approxNumber("tanpa angka"), null);
});
