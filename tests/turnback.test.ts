import { test } from "node:test";
import assert from "node:assert/strict";
import { extractVerdict } from "../src/adapters/turnback.ts";

test("mengambil temuan setelah 'Faktanya'", () => {
  const text =
    "Beredar video yang diklaim rekaman penyadapan. Faktanya, audio tersebut merupakan potongan wawancara tvOne pada 2014. Jadi, unggahan itu menyesatkan.";
  const out = extractVerdict(text);
  assert.ok(out);
  assert.match(out!, /^Audio tersebut/);
  assert.ok(!out!.includes("Beredar video"));
});

test("jatuh ke kalimat 'Jadi' bila Faktanya tidak ada", () => {
  const out = extractVerdict("Klaim beredar luas. Jadi, unggahan tersebut merupakan konten menyesatkan.");
  assert.ok(out);
  assert.match(out!, /^Unggahan tersebut/);
});

test("mengembalikan null bila tidak ada temuan", () => {
  assert.equal(extractVerdict("Tidak ada kesimpulan di sini."), null);
});
