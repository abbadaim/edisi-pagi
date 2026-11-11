/**
 * `DEC-0018`: model OpenCode diverifikasi terhadap katalog sebelum dipakai.
 *
 * Model yang salah akan gagal di setiap kartu — menghabiskan waktu dan
 * panggilan. Lebih baik turun ke penulis deterministik sekali, di awal, dengan
 * log yang jelas.
 *
 * Tes memakai stub `tests/fixtures/fake-opencode`: tanpa jaringan, tanpa
 * kredensial, tanpa binari opencode sungguhan.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { resolveLlm } from "../src/adapters/llm/resolve.ts";

const stub = join(new URL("..", import.meta.url).pathname, "tests", "fixtures", "fake-opencode");
const FLASH = "opencode-go/deepseek-v4.1-flash";

test("model yang ada di katalog memakai OpenCode", () => {
  const resolved = resolveLlm({ OPENCODE_BIN: stub, FAKE_MODELS: FLASH } as NodeJS.ProcessEnv);
  assert.equal(resolved.provider, "opencode");
  assert.equal(resolved.model, FLASH);
});

test("model yang tidak ada di katalog tidak dipakai", () => {
  const resolved = resolveLlm({
    OPENCODE_BIN: stub,
    FAKE_MODELS: "opencode-go/model-lain",
  } as NodeJS.ProcessEnv);
  assert.equal(resolved.provider, "deterministic");
  assert.equal(resolved.llm, null);
});

test("model yang tidak ada di katalog tetap deterministik walau LLM_PROVIDER=opencode", () => {
  const resolved = resolveLlm({
    LLM_PROVIDER: "opencode",
    OPENCODE_BIN: stub,
    FAKE_MODELS: "opencode-go/model-lain",
  } as NodeJS.ProcessEnv);
  assert.equal(resolved.provider, "deterministic");
});

test("katalog tidak terbaca tidak memblokir penerbitan", () => {
  const resolved = resolveLlm({
    OPENCODE_BIN: stub,
    FAKE_MODELS_FAIL: "1",
  } as NodeJS.ProcessEnv);
  assert.equal(resolved.provider, "opencode", "katalog gagal dibaca bukan alasan menolak OpenCode");
});
