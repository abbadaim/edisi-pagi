/**
 * `pool` — batas konkurensi yang mempertahankan urutan hasil (`DEC-0025`).
 *
 * Urutan penting: kartu diberi id berdasarkan posisi hasil, jadi pool yang
 * mengembalikan hasil tidak berurutan akan mengacak id kartu.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/core/pool.ts";

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("hasil tetap dalam urutan masukan walau selesai tidak berurutan", async () => {
  const items = [30, 5, 15, 1];
  const out = await pool(items, 4, async (ms, i) => {
    await delay(ms);
    return `item-${i}`;
  });
  assert.deepEqual(out, ["item-0", "item-1", "item-2", "item-3"]);
});

test("batas konkurensi tidak dilampaui", async () => {
  let active = 0;
  let peak = 0;
  await pool(Array.from({ length: 12 }), 3, async () => {
    active++;
    peak = Math.max(peak, active);
    await delay(5);
    active--;
  });
  assert.ok(peak <= 3, `puncak ${peak} melebihi batas 3`);
  assert.ok(peak >= 2, "pekerjaan tidak berjalan paralel sama sekali");
});

test("limit lebih besar dari jumlah item aman", async () => {
  const out = await pool([1, 2], 10, async (n) => n * 2);
  assert.deepEqual(out, [2, 4]);
});

test("daftar kosong menghasilkan daftar kosong", async () => {
  assert.deepEqual(await pool([], 3, async () => "x"), []);
});

test("error diteruskan ke pemanggil", async () => {
  await assert.rejects(
    () =>
      pool([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("gagal di 2");
        return n;
      }),
    /gagal di 2/,
  );
});
