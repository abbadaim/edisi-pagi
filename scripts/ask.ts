#!/usr/bin/env node
/**
 * Menjawab satu pertanyaan pembaca (rencana 022, fase 2).
 *
 * Alur: ambil satu baris `asks` berstatus `new` → tandai `claimed` → ambil bahan
 * dari arsip lokal → satu panggilan model → verifikasi sitasi → tulis
 * `public/answers/<id>.json` → tandai `answered`/`refused`.
 *
 * Tidak menyentuh edisi. Tidak pernah menulis `data/editions/`.
 *
 * Pemakaian:
 *   SUPABASE_SERVICE_KEY=... node scripts/ask.ts [--id <ask_id>] [--dry]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "../src/config/env.ts";
import { openSqlite } from "../src/adapters/db/sqlite.ts";
import { resolveLlm } from "../src/adapters/llm/resolve.ts";
import { parseAskConfig, mergeAskConfig, configHash, promptHash } from "../src/core/ask/config.ts";
import { selectMaterial, type AskArticle } from "../src/core/ask/retrieve.ts";
import { writeAnswer } from "../src/core/ask/answer.ts";

const root = new URL("..", import.meta.url).pathname;
loadEnvFile(join(root, ".env.local"));

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? "") : null;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const dry = flag("dry");
const debug = flag("debug");
const wantedId = arg("id");

const publicCfg = JSON.parse(readFileSync(join(root, "public", "config.json"), "utf8")) as {
  supabaseUrl?: string;
  supabaseKey?: string;
};
const SUPABASE_URL = process.env.SUPABASE_URL ?? publicCfg.supabaseUrl;
// `apikey` selalu kunci proyek (publishable). Token yang memberi hak ada di
// Authorization: service_role di CI, atau JWT pengguna saat menguji lokal —
// RLS tetap yang memutuskan, jadi jalur uji tidak butuh kunci rahasia.
const PROJECT_KEY = publicCfg.supabaseKey ?? process.env.SUPABASE_ANON_KEY ?? "";
const AUTH_KEY = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_JWT;

if (!SUPABASE_URL || !AUTH_KEY) {
  console.error(
    "butuh SUPABASE_SERVICE_KEY (CI) atau SUPABASE_JWT (uji lokal) — keduanya tidak pernah masuk repo.",
  );
  process.exit(2);
}

/**
 * Dua bentuk kredensial, dua cara pakai — dan salah tempel menghasilkan PGRST301
 * yang menyesatkan:
 *
 *   `sb_secret_…`  kunci opaque. Gateway Supabase memetakannya ke `service_role`
 *                  lewat header `apikey`; ia bukan JWT, jadi jangan dikirim
 *                  sebagai `Authorization: Bearer`.
 *   `eyJ…`         JWT (service_role lama, atau sesi pengguna saat uji lokal):
 *                  `apikey` tetap kunci proyek, tokennya di Authorization.
 */
const AUTH_MODE: "secret-key" | "jwt" = AUTH_KEY.startsWith("sb_secret_") ? "secret-key" : "jwt";
console.log(`auth: ${AUTH_MODE}`);

function authHeaders(): Record<string, string> {
  if (AUTH_MODE === "secret-key") return { apikey: AUTH_KEY as string };
  return { apikey: PROJECT_KEY || (AUTH_KEY as string), Authorization: `Bearer ${AUTH_KEY}` };
}

const dbPath = process.env.DATABASE_PATH ?? join(root, "local.db");
const baseCfg = parseAskConfig(readFileSync(join(root, "config", "tanya.json"), "utf8"));

interface AskRow {
  id: string;
  question: string;
  mode: "now" | "watch";
  topic_id: string | null;
  state: string;
  attempts: number;
}

async function sb<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`supabase ${res.status}: ${text.slice(0, 200)}`);
  return data as T;
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

async function claim(): Promise<AskRow | null> {
  if (wantedId) {
    const rows = await sb<AskRow[]>(
      `asks?id=eq.${encodeURIComponent(wantedId)}&select=id,question,mode,topic_id,state,attempts`,
    );
    return rows[0] ?? null;
  }
  const rows = await sb<AskRow[]>(
    `asks?state=eq.new&order=created_at.asc&limit=1&select=id,question,mode,topic_id,state,attempts`,
  );
  return rows[0] ?? null;
}

function markClaimed(ask: AskRow): Promise<unknown> {
  return sb(`asks?id=eq.${encodeURIComponent(ask.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ state: "claimed", claimed_at: new Date().toISOString(), attempts: ask.attempts + 1 }),
  }).catch(() => null);
}

function markDone(
  ask: AskRow,
  state: "answered" | "refused" | "new" | "failed",
  answerId: string | null,
  error: string | null,
): Promise<unknown> {
  return sb(`asks?id=eq.${encodeURIComponent(ask.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ state, answer_id: answerId, error }),
  });
}

interface Row {
  url: string;
  outlet: string;
  published_at: string | null;
  title: string;
  topic_id: string | null;
  lead: string | null;
  text: string | null;
}

const toArticle = (r: Row): AskArticle => ({
  url: r.url,
  outlet: r.outlet,
  title: r.title,
  published_at: r.published_at,
  topic_id: r.topic_id,
  lead: r.lead,
  text: r.text,
});

const SELECT = `SELECT a.url, a.outlet, a.published_at, a.title_display AS title, a.topic_id, a.lead, t.text
                  FROM articles a LEFT JOIN article_text t ON t.url = a.url`;

/**
 * Bahan untuk satu pertanyaan.
 *
 * `articles.topic_id` **tidak pernah diisi** oleh pipeline (0 dari 2.026 baris
 * pada 2026-11-17), jadi jalur kartu memakai relasi entitas:
 * `topic_entities` ∩ `article_entities`. Bila topik tidak punya entitas,
 * jatuh ke pencocokan judul topik — dan `mode` ikut berubah supaya peringkatnya
 * jujur.
 */
function articlesFor(ask: AskRow): { articles: AskArticle[]; mode: "kartu" | "bebas"; query: string } {
  const db = openSqlite(dbPath);
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
  try {
    if (ask.topic_id) {
      const topic = db.get<{ canonical_title: string }>(
        "SELECT canonical_title FROM topics WHERE topic_id = ?",
        [ask.topic_id],
      );
      const aliases = db.all<{ alias: string }>("SELECT alias FROM topic_aliases WHERE topic_id = ?", [
        ask.topic_id,
      ]);
      const recent = db.all<Row>(
        `${SELECT} WHERE COALESCE(a.is_duplicate_of, '') = '' AND a.published_at >= ?
          ORDER BY a.published_at DESC LIMIT 400`,
        [since],
      );
      // Kueri = judul kanonis + alias (judul artikel pendiri). Itu satu-satunya
      // relasi topik→artikel yang benar-benar terisi di basis data.
      const query = [topic?.canonical_title ?? "", ...aliases.map((a) => a.alias), ask.question]
        .filter(Boolean)
        .join(" ");
      return { articles: recent.map(toArticle), mode: "kartu", query };
    }

    const recent = db.all<Row>(
      `${SELECT} WHERE COALESCE(a.is_duplicate_of, '') = '' AND a.published_at >= ?
        ORDER BY a.published_at DESC LIMIT 400`,
      [since],
    );
    return { articles: recent.map(toArticle), mode: "bebas", query: ask.question };
  } finally {
    db.close();
  }
}

async function settingsConfig(): Promise<unknown> {
  try {
    const rows = await sb<Array<{ config: unknown }>>("settings?select=config");
    return rows[0]?.config ?? null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const ask = await claim();
  if (!ask) {
    console.log("tidak ada pertanyaan baru");
    return;
  }
  console.log(`tanya: ${ask.id.slice(0, 8)} · mode=${ask.mode} · topik=${ask.topic_id ?? "—"}`);
  if (!dry) await markClaimed(ask);

  const cfg = mergeAskConfig(baseCfg, await settingsConfig());
  const scope = articlesFor(ask);
  const pack = selectMaterial(scope.articles, scope.query, {
    mode: scope.mode,
    topicId: ask.topic_id,
    maxItems: cfg.cari.max_fetch + 1,
  });

  console.log(
    `bahan: ${pack.materials.length} (${pack.materials.filter((m) => m.tier === "teks").length} teks penuh) · ` +
      `${scope.articles.length} artikel diperiksa · mode=${scope.mode}`,
  );
  if (pack.reason) console.log(`bahan kosong: ${pack.reason}`);

  const answerId = `a_${ask.id}`;
  const createdAt = new Date().toISOString();

  let result: {
    state: "answered" | "refused";
    answer: string;
    sources: unknown[];
    unsupported: string[];
    reason: string | null;
  } = {
    state: "refused",
    answer: cfg.tolak,
    sources: [],
    unsupported: [],
    reason: pack.reason ?? "tanpa bahan",
  };
  let model = "tanpa-model";
  let usage = { tokens_in: 0, tokens_out: 0 };

  if (pack.materials.length > 0) {
    const resolved = resolveLlm({ ...process.env, OPENCODE_MODEL: cfg.model.bawaan });
    if (!resolved.llm) {
      // OpenCode yang gagal dipasang bukan salah pertanyaannya. Kembalikan ke
      // antrean supaya run berikutnya mencoba lagi, sampai batas percobaan.
      const retryable = ask.attempts + 1 < 3;
      console.log(
        `model: ${cfg.model.bawaan} tidak tersedia (DEC-0018) — ` +
          (retryable ? "dikembalikan ke antrean" : "menyerah setelah 3 percobaan"),
      );
      if (!dry) {
        await markDone(ask, retryable ? "new" : "failed", null, "model tidak tersedia");
      }
      return;
    }
    model = cfg.model.bawaan;
    const r = await writeAnswer(resolved.llm, cfg.model.bawaan, ask.question, pack.materials, cfg);
    result = { state: r.state, answer: r.answer, sources: r.sources, unsupported: r.unsupported, reason: r.reason };
    if (debug && r.raw) {
      console.log("--- keluaran mentah model ---");
      console.log(r.raw.slice(0, 1600));
      console.log("--- akhir keluaran ---");
    }
    usage = { tokens_in: r.usage?.tokens_in ?? 0, tokens_out: r.usage?.tokens_out ?? 0 };
  }

  const payload = {
    schema_version: 1,
    id: answerId,
    question: ask.question,
    topic_id: ask.topic_id,
    state: result.state,
    answer: result.answer,
    sources: result.sources,
    unsupported: result.unsupported,
    reason: result.reason,
    model,
    config_hash: configHash(cfg),
    prompt_hash: promptHash(cfg),
    tokens: usage,
    created_at: createdAt,
    edition_date: isoToday(),
  };

  const dir = join(root, "public", "answers");
  mkdirSync(dir, { recursive: true });
  if (!dry) writeFileSync(join(dir, `${answerId}.json`), JSON.stringify(payload, null, 2) + "\n");

  console.log(
    `jawaban: ${result.state} · sumber ${result.sources.length} · dibuang ${result.unsupported.length}` +
      (result.reason ? ` · ${result.reason}` : ""),
  );

  if (!dry) await markDone(ask, result.state, result.state === "answered" ? answerId : null, result.reason);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
