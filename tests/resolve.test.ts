import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLlm } from "../src/adapters/llm/resolve.ts";

// DEC-0016: DeepSeek hanya aktif bila diminta eksplisit. Tes di bawah menjaga
// pengikatan model ke penyedia yang benar-benar dipakai (bug lama: nama model
// opencode terkirim ke DeepSeek dan ditolak 400).
test("DeepSeek yang diminta eksplisit memakai model DeepSeek", () => {
  const r = resolveLlm({
    LLM_PROVIDER: "deepseek",
    OPENCODE_BIN: "/tidak/ada/opencode",
    DEEPSEEK_API_KEY: "x",
  } as NodeJS.ProcessEnv);

  assert.equal(r.provider, "deepseek");
  assert.equal(r.model, "deepseek-chat", "model harus milik penyedia yang benar-benar dipakai");
});

test("DEEPSEEK_MODEL menimpa default", () => {
  const r = resolveLlm({
    LLM_PROVIDER: "deepseek",
    OPENCODE_BIN: "/tidak/ada/opencode",
    DEEPSEEK_API_KEY: "x",
    DEEPSEEK_MODEL: "deepseek-flash",
  } as NodeJS.ProcessEnv);
  assert.equal(r.model, "deepseek-flash");
});

test("LLM_PROVIDER=deepseek melewati opencode", () => {
  const r = resolveLlm({ DEEPSEEK_API_KEY: "x", LLM_PROVIDER: "deepseek" } as NodeJS.ProcessEnv);
  assert.equal(r.provider, "deepseek");
  assert.equal(r.model, "deepseek-chat");
});

test("tanpa kunci dan tanpa opencode, tidak ada LLM", () => {
  const r = resolveLlm({ OPENCODE_BIN: "/tidak/ada/opencode" } as NodeJS.ProcessEnv);
  assert.equal(r.llm, null);
  assert.equal(r.provider, "deterministic");
});
