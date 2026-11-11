import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openSqlite } from "../src/adapters/db/sqlite.ts";
import { LlmTelemetry } from "../src/core/telemetry.ts";
import type { LlmAdapter } from "../src/adapters/llm/types.ts";

const fake: LlmAdapter = {
  name: "deepseek",
  async json<T>() {
    return { data: { ok: true } as T, usage: { tokens_in: 10, tokens_out: 5, cost_usd: 0.001 } };
  },
  async text() {
    return { text: "halo", usage: { tokens_in: 3, tokens_out: 2 } };
  },
};

test("telemetri mencatat role, topik, token, dan latensi", async () => {
  const db = openSqlite(":memory:");
  db.exec(readFileSync(new URL("../migrations/005_llm_calls.sql", import.meta.url), "utf8"));
  const t = new LlmTelemetry(db, "2026-11-10");
  const wrapped = t.wrap(fake);

  t.set({ role: "write", topicId: "t_kpk", attempt: 1 });
  await wrapped.json({ model: "test", system: "s", user: "u" });
  t.set({ role: "edit", topicId: "t_kpk", attempt: 2 });
  await wrapped.text({ model: "test", system: "s", user: "u" });

  const rows = db.all<{ role: string; topic_id: string; tokens_in: number; tokens_out: number }>(
    "SELECT role, topic_id, tokens_in, tokens_out FROM llm_calls ORDER BY id",
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.role, "write");
  assert.equal(rows[1]!.role, "edit");
  assert.equal(rows[0]!.tokens_in, 10);
  assert.equal(rows[1]!.tokens_out, 2);

  const s = t.summary();
  assert.equal(s.calls, 2);
  assert.equal(s.tokensIn, 13);
  assert.equal(s.tokensOut, 7);
  db.close();
});

test("telemetri tidak melempar bila tabel belum ada", async () => {
  const db = openSqlite(":memory:");
  const t = new LlmTelemetry(db, "2026-11-10");
  const wrapped = t.wrap(fake);
  await wrapped.json({ model: "test", system: "s", user: "u" });
  assert.equal(t.summary().calls, 0);
  db.close();
});
