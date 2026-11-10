import { test } from "node:test";
import assert from "node:assert/strict";
import { createFallbackAdapter } from "../src/adapters/llm/fallback.ts";
import type { LlmAdapter } from "../src/adapters/llm/types.ts";

const ok = (name: "opencode" | "deepseek" | "local", text: string): LlmAdapter => ({
  name,
  async json<T>() {
    return { data: { from: text } as T, usage: { tokens_in: 1, tokens_out: 1 } };
  },
  async text() {
    return { text, usage: { tokens_in: 1, tokens_out: 1 } };
  },
});

const boom = (name: "opencode" | "deepseek" | "local"): LlmAdapter => ({
  name,
  async json<T>(): Promise<{ data: T; usage: { tokens_in: number; tokens_out: number } }> {
    throw new Error(`${name} mati`);
  },
  async text() {
    throw new Error(`${name} mati`);
  },
});

test("memakai penyedia pertama jika berhasil", async () => {
  const a = createFallbackAdapter([ok("opencode", "primary"), ok("deepseek", "backup")]);
  const r = await a.text({ model: "m", system: "s", user: "u" });
  assert.equal(r.text, "primary");
});

test("pindah ke cadangan saat penyedia utama gagal", async () => {
  const seen: string[] = [];
  const a = createFallbackAdapter([boom("opencode"), ok("deepseek", "backup")], (from, to) => {
    seen.push(`${from}->${to}`);
  });
  const r = await a.text({ model: "m", system: "s", user: "u" });
  assert.equal(r.text, "backup");
  assert.deepEqual(seen, ["opencode->deepseek"]);
});

test("melempar error jika semua gagal", async () => {
  const a = createFallbackAdapter([boom("opencode"), boom("deepseek")]);
  await assert.rejects(() => a.text({ model: "m", system: "s", user: "u" }), /semua penyedia gagal/);
});

test("embed dilewati jika adapter tidak mendukung", async () => {
  const withEmbed: LlmAdapter = {
    name: "local",
    async json<T>() {
      return { data: {} as T, usage: { tokens_in: 0, tokens_out: 0 } };
    },
    async text() {
      return { text: "", usage: { tokens_in: 0, tokens_out: 0 } };
    },
    async embed() {
      return { vectors: [[0.1, 0.2]], usage: { tokens_in: 1, tokens_out: 0 } };
    },
  };

  const a = createFallbackAdapter([boom("opencode"), withEmbed]);
  const r = await a.embed!({ model: "m", texts: ["x"] });
  assert.deepEqual(r.vectors, [[0.1, 0.2]]);
});

test("nama adapter mengikuti penyedia utama", () => {
  const a = createFallbackAdapter([ok("opencode", "x"), ok("deepseek", "y")]);
  assert.equal(a.name, "opencode");
});
