import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SIMILARITY_THRESHOLD,
  features,
  fromBigInt,
  hamming,
  simhash,
  similarity,
  toBigInt,
} from "../src/core/simhash.ts";

const sim = (a: string, b: string) => similarity(features(a), features(b));

test("teks identik: simhash 0, similarity 1", () => {
  const t = "50 anggota DPR teken HMP soal ijazah Gibran";
  assert.equal(hamming(simhash(t), simhash(t)), 0);
  assert.equal(sim(t, t), 1);
});

test("teks berbeda: similarity rendah", () => {
  const a = "Harga beras masih mahal, Bulog buka dialog dengan pelaku usaha";
  const b = "Timnas Indonesia menang melawan Vietnam di final Piala AFF";
  assert.ok(sim(a, b) < 0.2, `sim ${sim(a, b)}`);
});

test("sindikasi terdeteksi duplikat", () => {
  const a = "50 Anggota DPR Teken Hak Menyatakan Pendapat soal Ijazah Gibran";
  const b = "50 Anggota DPR Teken Hak Menyatakan Pendapat soal Ijazah Gibran - Kompas.com";
  assert.ok(sim(a, b) >= SIMILARITY_THRESHOLD, `sim ${sim(a, b)}`);
});

test("penulisan ulang peristiwa yang sama BUKAN duplikat", () => {
  // Harus diklaster, bukan dibuang (CLUSTERING.md §4 vs §6).
  const a = "Polisi sebut pengemudi Pajero di Gejayan sebagai korban penganiayaan";
  const b = "Pemuda asal Jambi diamuk massa usai geber mobil di Jalan Affandi";
  assert.ok(sim(a, b) < SIMILARITY_THRESHOLD, `sim ${sim(a, b)}`);
});

test("urutan kata berubah tetap mirip", () => {
  const a = "DPR teken usulan hak menyatakan pendapat soal ijazah Gibran";
  const b = "Usulan hak menyatakan pendapat soal ijazah Gibran diteken DPR";
  assert.ok(sim(a, b) > 0.6, `sim ${sim(a, b)}`);
});

test("bolak-balik BigInt utuh", () => {
  const h = simhash("uji simpan simhash 64 bit");
  assert.deepEqual(fromBigInt(toBigInt(h)), h);
});
