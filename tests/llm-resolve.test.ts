/**
 * `DEC-0016`: DeepSeek API langsung hanya dipakai bila diminta eksplisit.
 *
 * Biaya per token ada di saldo pribadi; cadangan otomatis berarti saldo bisa
 * terkuras tanpa ada yang memutuskan. OpenCode tetap boleh jadi penyedia
 * default — yang dikunci di sini adalah DeepSeek tidak pernah menjadi
 * cadangan diam-diam.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveLlm, modelInCatalog } from "../src/adapters/llm/resolve.ts";

const tanpaOpenCode = "/nonexistent";

/**
 * Rencana 022: `--model provider/model#varian` sah bagi CLI, tetapi katalog
 * hanya memuat `provider/model`. Dulu perbandingan utuh membuat setiap model
 * bervarian dianggap hilang, dan Tanya AI akan diam-diam memakai penulis
 * deterministik alih-alih menolak dengan jelas.
 */
test("varian dilepas sebelum mencocokkan katalog model", () => {
  const catalog = ["opencode/deepseek-v4.1-flash-free", "opencode-go/deepseek-v4.1-flash"];
  assert.equal(modelInCatalog(catalog, "opencode/deepseek-v4.1-flash-free#low"), true);
  assert.equal(modelInCatalog(catalog, "opencode/deepseek-v4.1-flash-free#max"), true);
  assert.equal(modelInCatalog(catalog, "opencode/deepseek-v4.1-flash-free"), true);
});

test("model di luar katalog tetap ditolak walau bervarian", () => {
  const catalog = ["opencode-go/deepseek-v4.1-flash"];
  assert.equal(modelInCatalog(catalog, "opencode/beam-free#low"), false);
  assert.equal(modelInCatalog(catalog, "#low"), false);
  assert.equal(modelInCatalog([], "opencode/deepseek-v4.1-flash-free#low"), false);
});

test("tanpa LLM_PROVIDER, DeepSeek tidak dipakai walau kuncinya tersedia", () => {
  const resolved = resolveLlm({ OPENCODE_BIN: tanpaOpenCode, DEEPSEEK_API_KEY: "sk-uji" });
  assert.equal(resolved.provider, "deterministic");
  assert.equal(resolved.llm, null);
});

test("LLM_PROVIDER=opencode tidak pernah jatuh ke DeepSeek", () => {
  const resolved = resolveLlm({
    LLM_PROVIDER: "opencode",
    OPENCODE_BIN: tanpaOpenCode,
    DEEPSEEK_API_KEY: "sk-uji",
  });
  assert.equal(resolved.provider, "deterministic");
  assert.equal(resolved.llm, null);
});

test("LLM_PROVIDER=deepseek satu-satunya jalan memakai DeepSeek", () => {
  const resolved = resolveLlm({
    LLM_PROVIDER: "deepseek",
    OPENCODE_BIN: tanpaOpenCode,
    DEEPSEEK_API_KEY: "sk-uji",
  });
  assert.equal(resolved.provider, "deepseek");
  assert.ok(resolved.llm, "adapter deepseek seharusnya terbentuk");
});

test("LLM_PROVIDER=deepseek tanpa kunci tetap deterministik, tidak gagal", () => {
  const resolved = resolveLlm({ LLM_PROVIDER: "deepseek", OPENCODE_BIN: tanpaOpenCode });
  assert.equal(resolved.provider, "deterministic");
});
