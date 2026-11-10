import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeepSeekAdapter } from "../src/adapters/llm/deepseek.ts";

const fakeFetch = (body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

test("model reasoning yang mengembalikan content kosong dianggap gagal", async () => {
  const adapter = createDeepSeekAdapter({
    apiKey: "x",
    maxRetries: 0,
    fetchImpl: fakeFetch({
      choices: [{ message: { content: "", reasoning_content: "..." }, finish_reason: "length" }],
      usage: { prompt_tokens: 10, completion_tokens: 50 },
    }),
  });

  await assert.rejects(
    () => adapter.json({ model: "deepseek-flash", system: "s", user: "u" }),
    /konten kehabisan token/,
  );
});

test("content normal tetap diteruskan", async () => {
  const adapter = createDeepSeekAdapter({
    apiKey: "x",
    maxRetries: 0,
    fetchImpl: fakeFetch({
      choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
  });

  const out = await adapter.json<{ ok: boolean }>({ model: "deepseek-chat", system: "s", user: "u" });
  assert.equal(out.data.ok, true);
  assert.equal(out.usage.tokens_out, 5);
});

test("newline mentah di dalam string JSON tetap terbaca", async () => {
  const adapter = createDeepSeekAdapter({
    apiKey: "x",
    maxRetries: 0,
    fetchImpl: fakeFetch({
      choices: [{ message: { content: "{\"title\":\"baris satu\nbaris dua\"}" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
  });
  const out = await adapter.json<{ title: string }>({ model: "deepseek-chat", system: "s", user: "u" });
  assert.equal(out.data.title, "baris satu baris dua");
});
