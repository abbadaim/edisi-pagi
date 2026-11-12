/**
 * `DEC-0024` — prompt cache harus terukur, dan prefix bersama tidak boleh
 * dipotong data per-kartu.
 *
 * Konteks: dasbor DeepSeek 2026-11-11 menunjukkan 659.328 token cache hit dari
 * 2.551.637 token masukan (25,8%). Hit rate hanya bisa diperbaiki kalau
 * pipeline sendiri yang melaporkannya.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createDeepSeekAdapter } from "../src/adapters/llm/deepseek.ts";
import { buildWriterPrompt, type WriteContext } from "../src/core/newsroom/write.ts";
import type { AdjudicatedTopic } from "../src/core/adjudicate.ts";
import type { Assignment, MaterialPack } from "../src/core/newsroom/contracts.ts";

const fakeFetch = (body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

test("token cache DeepSeek terbaca ke usage.cached_tokens", async () => {
  const adapter = createDeepSeekAdapter({
    apiKey: "x",
    maxRetries: 0,
    fetchImpl: fakeFetch({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1000, completion_tokens: 20, prompt_cache_hit_tokens: 768, prompt_cache_miss_tokens: 232 },
    }),
  });

  const out = await adapter.json<{ ok: boolean }>({ model: "deepseek-chat", system: "s", user: "u" });
  assert.equal(out.usage.tokens_in, 1000);
  assert.equal(out.usage.cached_tokens, 768);
});

test("tanpa laporan cache, cached_tokens 0 dan bukan undefined", async () => {
  const adapter = createDeepSeekAdapter({
    apiKey: "x",
    maxRetries: 0,
    fetchImpl: fakeFetch({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 5 },
    }),
  });

  const out = await adapter.json<{ ok: boolean }>({ model: "deepseek-chat", system: "s", user: "u" });
  assert.equal(out.usage.cached_tokens, 0);
});

const baseTopic = {
  cids: ["c01"],
  title: "Contoh topik",
  angle: "Sudut",
  kind: "ongoing",
  entities: [],
  local: false,
  horse_race: false,
  drop: false,
  significance: 3,
  heavy: false,
  category: "politik",
  first_seen: "2026-11-11T00:00:00Z",
} as unknown as AdjudicatedTopic;

const pack: MaterialPack = {
  topic_id: "t1",
  items: [
    {
      id: "s1",
      kind: "article",
      outlet: "contoh.id",
      published_at: "2026-11-11T00:00:00+07:00",
      text: "Isi bahan yang cukup panjang untuk dipakai sebagai konteks.",
      title: "Judul bahan",
      url: "https://contoh.id/a",
    },
  ],
  missing: [],
  stats: { lead_chars: 10, material_chars: 60, fetched: 1, failed: 0 },
} as unknown as MaterialPack;

function ctxFor(answers: string[]): WriteContext {
  const assignment = {
    cids: ["c01"],
    title: "Contoh topik",
    angle: "Sudut",
    category: "politik",
    significance: 3,
    heavy: false,
    depth: "standard",
    why_now: "Hari ini",
    answers,
    note_ids: [],
    drop: false,
    reason: null,
  } as unknown as Assignment;
  return { assignment, pack, topic: baseTopic, topicId: "t1", local: false, prior: [] };
}

test("system prompt penulis identik untuk kartu berbeda", () => {
  const a = buildWriterPrompt(ctxFor(["Apa yang terjadi?"]));
  const b = buildWriterPrompt(ctxFor(["Siapa yang hadir?", "Kapan?", "Mengapa penting?"]));

  // Prefix bersama hanya berguna bila byte-nya sama. Pertanyaan per-kartu
  // harus tinggal di `user`, bukan memotong `system` (DEC-0024).
  assert.equal(a.system, b.system);
  assert.notEqual(a.user, b.user);
});

test("pertanyaan wajib tetap sampai ke model lewat user", () => {
  const ctx = ctxFor(["Apa yang terjadi di Sleman?"]);
  const { system, user } = buildWriterPrompt(ctx);

  assert.ok(!system.includes("Apa yang terjadi di Sleman?"), "pertanyaan per-kartu tidak boleh di system");
  assert.ok(user.includes("pertanyaan_wajib"), "user harus memuat field pertanyaan_wajib");
  assert.ok(user.includes("Apa yang terjadi di Sleman?"), "isi pertanyaan harus tetap terkirim");
});

// DEC-0025: batas keluaran harus muat di anggaran waktu panggilan.
test("batas token penulis muat di timeout OpenCode", async () => {
  const { WRITER_MAX_TOKENS } = await import("../src/core/newsroom/write.ts");
  // 28 token/detik terukur; pakai 25 untuk margin.
  const TOK_PER_SEC = 25;
  const TIMEOUT_SEC = Number(process.env.OPENCODE_TIMEOUT_MS ?? 240_000) / 1000;

  for (const [depth, cap] of Object.entries(WRITER_MAX_TOKENS)) {
    const worst = cap / TOK_PER_SEC;
    assert.ok(
      worst < TIMEOUT_SEC,
      `${depth}: ${cap} token ≈ ${Math.round(worst)} s, melebihi timeout ${TIMEOUT_SEC} s`,
    );
  }
});
