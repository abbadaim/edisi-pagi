import { test } from "node:test";
import assert from "node:assert/strict";
import { writeHoaxRoundup } from "../src/core/newsroom/hoax.ts";
import type { HoaxItem } from "../src/core/types.ts";
import type { LlmAdapter } from "../src/adapters/llm/types.ts";

const items: HoaxItem[] = [
  {
    claim: "Rekaman suara Prabowo hasil penyadapan",
    verdict: "salah",
    reason: "Potongan wawancara tvOne 15 Sep 2014, menit 05.14–06.55",
    outlet: "turnbackhoax.id",
    url: "https://turnbackhoax.id/1",
  },
  {
    claim: "Gibran sudah dimakzulkan",
    verdict: "salah",
    reason: "Belum ada putusan MPR; dokumen yang beredar palsu",
    outlet: "turnbackhoax.id",
    url: "https://turnbackhoax.id/2",
  },
];

const llmReturning = (data: unknown, fail = false): LlmAdapter => ({
  name: "deepseek",
  async json<T>() {
    if (fail) throw new Error("gagal");
    return { data: data as T, usage: { tokens_in: 100, tokens_out: 50 } };
  },
  async text() {
    return { text: "", usage: { tokens_in: 0, tokens_out: 0 } };
  },
});

const input = {
  editionId: "2026-11-10",
  now: new Date("2026-11-10T20:00:00+07:00"),
  items,
  sourceUrl: "https://turnbackhoax.id/",
};

test("hoax roundup memakai verdict deterministik dan tidak mengubah item", async () => {
  const card = await writeHoaxRoundup(input, {
    llm: llmReturning({
      title: "Dua fact-check hari ini: rekaman lama dan klaim pemakzulan",
      body: [
        "Dua klaim diperiksa hari ini. Keduanya berasal dari TurnBackHoax dan menyangkut politik nasional.",
        "Pola yang terlihat: rekaman lama diberi tanggal baru, dan dokumen tanpa sumber resmi diedarkan sebagai bukti.",
        "Balas dengan tautan pemeriksaannya; jangan debat isinya.",
      ],
      action: "Balas dengan tautan TurnBackHoax; jangan debat isinya.",
      pattern: "Rekaman lama dan dokumen tanpa sumber muncul kembali dengan tanggal baru.",
    }),
    model: "test",
  });

  assert.ok(card);
  assert.equal(card!.type, "hoax_roundup");
  assert.equal(card!.truth, null);
  assert.equal((card as { items: HoaxItem[] }).items.length, 2);
  assert.deepEqual((card as { items: HoaxItem[] }).items, items, "verdict/alasan tidak boleh berubah");
  assert.ok(card!.body.length >= 2);
  assert.match((card as { pattern?: string }).pattern ?? "", /rekaman lama/i);
});

test("hoax roundup mengembalikan null bila model gagal", async () => {
  const card = await writeHoaxRoundup(input, { llm: llmReturning(null, true), model: "test" });
  assert.equal(card, null);
});
