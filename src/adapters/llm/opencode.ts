import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { JsonRequest, LlmAdapter, TextRequest, Usage } from "./types.ts";

export interface OpenCodeOptions {
  /** Default: env OPENCODE_BIN, lalu `opencode` di PATH, lalu ~/.opencode/bin/opencode */
  bin?: string;
  defaultModel?: string;
  timeoutMs?: number;
  /** Direktori kerja untuk sesi (default: cwd). */
  cwd?: string;
}

interface Event {
  type?: string;
  part?: {
    type?: string;
    text?: string;
    tokens?: { input?: number; output?: number };
    cost?: number;
  };
}

export function resolveBinary(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN;

  const home = join(homedir(), ".opencode", "bin", "opencode");
  if (existsSync(home)) return home;
  return "opencode";
}

function parseEvents(stdout: string): { text: string; usage: Usage } {
  let text = "";
  let tokensIn = 0;
  let tokensOut = 0;
  let cost = 0;

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let ev: Event;
    try {
      ev = JSON.parse(trimmed) as Event;
    } catch {
      continue;
    }
    if (ev.type === "text" && ev.part?.text) text += ev.part.text;
    if (ev.type === "step_finish") {
      tokensIn += ev.part?.tokens?.input ?? 0;
      tokensOut += ev.part?.tokens?.output ?? 0;
      cost += ev.part?.cost ?? 0;
    }
  }

  return { text, usage: { tokens_in: tokensIn, tokens_out: tokensOut, cost_usd: cost } };
}

/** Cek cepat apakah CLI bisa dijalankan. Dipakai untuk memilih penyedia utama. */
export function probeOpenCode(explicit?: string): boolean {
  const bin = resolveBinary(explicit);
  try {
    const r = spawnSync(bin, ["--version"], { timeout: 8000, stdio: "ignore" });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * Katalog model dari `opencode models` — satu id `provider/model` per baris.
 *
 * Mengembalikan `null` bila katalog tidak terbaca (binari hilang, server mati,
 * waktu habis). Pemanggil memutuskan: katalog tak terbaca bukan alasan untuk
 * menghentikan penerbitan, tetapi model yang tidak ada di katalog adalah alasan
 * untuk tidak memakai OpenCode sama sekali.
 */
export function listModels(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 20_000,
): string[] | null {
  const bin = resolveBinary(explicit);
  try {
    const r = spawnSync(bin, ["models"], { timeout: timeoutMs, encoding: "utf8", env });
    if (r.status !== 0 || typeof r.stdout !== "string") return null;
    const models = r.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return models.length > 0 ? models : null;
  } catch {
    return null;
  }
}

export function createOpenCodeAdapter(opts: OpenCodeOptions = {}): LlmAdapter {
  const bin = resolveBinary(opts.bin);
  const timeoutMs = opts.timeoutMs ?? 180_000;

  async function run(model: string, system: string, user: string): Promise<{ text: string; usage: Usage }> {
    const prompt = `${system}\n\n---\n\n${user}`;

    const args = [
      "run",
      "--model",
      model,
      "--format",
      "json",
      "--auto",
      "--archived",
      prompt,
    ];

    const child = spawn(bin, args, {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, OPENCODE_NO_TELEMETRY: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | undefined;

    const done = new Promise<number>((resolve, reject) => {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`opencode timeout ${timeoutMs}ms`));
      }, timeoutMs);
      child.stdout.on("data", (d) => (stdout += String(d)));
      child.stderr.on("data", (d) => (stderr += String(d)));
      child.on("error", (e) => reject(e));
      child.on("close", (code) => resolve(code ?? 1));
    });

    try {
      const code = await done;
      if (code !== 0) {
        throw new Error(`opencode exit ${code}: ${stderr.slice(0, 300)}`);
      }
    } finally {
      if (timer) clearTimeout(timer);
    }

    const parsed = parseEvents(stdout);
    if (!parsed.text.trim()) throw new Error(`opencode tanpa keluaran teks: ${stderr.slice(0, 200)}`);
    return parsed;
  }

  return {
    name: "opencode",

    async json<T>(req: JsonRequest) {
      const { text, usage } = await run(
        req.model,
        `${req.system}\n\nBalas HANYA dengan JSON valid, tanpa penjelasan.`,
        req.user,
      );
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start < 0 || end < start) throw new Error(`bukan JSON: ${cleaned.slice(0, 200)}`);
      return { data: JSON.parse(cleaned.slice(start, end + 1)) as T, usage };
    },

    async text(req: TextRequest) {
      return run(req.model, req.system, req.user);
    },
  };
}
