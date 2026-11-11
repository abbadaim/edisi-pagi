/**
 * `DEC-0017`: OpenCode memakai model DeepSeek Flash untuk semua peran.
 *
 * Satu model untuk adjudicate/write/verify — bukan per-kapabilitas. Kalau
 * model berbeda antara kode dan workflow, edisi bisa tiba-tiba memakai model
 * yang lebih mahal tanpa ada yang memutuskan; tes ini mengunci keduanya.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLlm } from "../src/adapters/llm/resolve.ts";

const root = new URL("..", import.meta.url).pathname;
const FLASH = "opencode-go/deepseek-v4.1-flash";

test("model OpenCode default adalah deepseek flash", () => {
  const resolved = resolveLlm({ OPENCODE_BIN: "/nonexistent" });
  assert.equal(resolved.model, FLASH);
});

test("workflow CI memakai model yang sama dengan default kode", () => {
  for (const file of ["daily.yml", "opencode-smoke.yml"]) {
    const yaml = readFileSync(join(root, ".github", "workflows", file), "utf8");
    assert.match(yaml, new RegExp(`OPENCODE_MODEL:\\s*${FLASH.replace(/[./]/g, "\\$&")}`), file);
  }
});

test("daily.yml tidak mengekspor DEEPSEEK_API_KEY", () => {
  const yaml = readFileSync(join(root, ".github", "workflows", "daily.yml"), "utf8");
  assert.doesNotMatch(yaml, /^\s*DEEPSEEK_API_KEY:/m, "secret DeepSeek tidak boleh diekspor (DEC-0016)");
});
