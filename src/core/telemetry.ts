/**
 * Telemetri per panggilan model (NEWSROOM-IMPLEMENTATION.md P1).
 *
 * Wrapper ini tidak mengubah perilaku adapter. Ia hanya mencatat role, topik,
 * token, biaya, dan latensi ke `llm_calls`, sehingga build bisa menjawab
 * "kartu mana yang mahal/lambat" tanpa menebak.
 */

import type { Db } from "../adapters/db/sqlite.ts";
import type { JsonRequest, LlmAdapter, TextRequest } from "../adapters/llm/types.ts";
import { isoWib } from "./time.ts";

export type LlmRole =
  | "adjudicate"
  | "plan"
  | "write"
  | "repair"
  | "edit"
  | "desk"
  | "hoax"
  | "fallback";

export interface TelemetryContext {
  role: LlmRole;
  topicId?: string | null;
  attempt?: number;
}

export interface LlmSummary {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  maxLatencyMs: number;
}

export class LlmTelemetry {
  private readonly db: Db;
  private readonly editionId: string;
  private ctx: TelemetryContext = { role: "write" };
  private enabled = true;

  constructor(db: Db, editionId: string) {
    this.db = db;
    this.editionId = editionId;
  }

  set(ctx: TelemetryContext): void {
    this.ctx = ctx;
  }

  wrap(adapter: LlmAdapter): LlmAdapter {
    const self = this;
    return {
      name: adapter.name,
      json: async <T>(req: JsonRequest) => {
        const start = Date.now();
        const res = await adapter.json<T>(req);
        self.record(adapter.name, req.model, res.usage, Date.now() - start);
        return res;
      },
      text: async (req: TextRequest) => {
        const start = Date.now();
        const res = await adapter.text(req);
        self.record(adapter.name, req.model, res.usage, Date.now() - start);
        return res;
      },
      ...(adapter.embed
        ? {
            embed: async (req: Parameters<NonNullable<LlmAdapter["embed"]>>[0]) => {
              const start = Date.now();
              const res = await adapter.embed!(req);
              self.record(adapter.name, req.model, res.usage, Date.now() - start);
              return res;
            },
          }
        : {}),
    };
  }

  private record(
    provider: string,
    model: string,
    usage: { tokens_in: number; tokens_out: number; cost_usd?: number },
    latencyMs: number,
  ): void {
    if (!this.enabled) return;
    try {
      this.db.run(
        `INSERT INTO llm_calls
           (edition_id, topic_id, role, attempt, provider, model,
            tokens_in, tokens_out, cost_usd, latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          this.editionId,
          this.ctx.topicId ?? null,
          this.ctx.role,
          this.ctx.attempt ?? 1,
          provider,
          model,
          usage.tokens_in,
          usage.tokens_out,
          usage.cost_usd ?? null,
          latencyMs,
          isoWib(new Date())!,
        ],
      );
    } catch (e) {
      this.enabled = false;
      const why = e instanceof Error ? e.message.slice(0, 120) : String(e);
      console.log(`  ! telemetri llm dimatikan: ${why} (jalankan npm run migrate)`);
    }
  }

  summary(): LlmSummary {
    try {
      const r = this.db.get<{
        calls: number;
        tin: number | null;
        tout: number | null;
        cost: number | null;
        max_latency: number | null;
      }>(
        `SELECT COUNT(*) AS calls,
                COALESCE(SUM(tokens_in), 0) AS tin,
                COALESCE(SUM(tokens_out), 0) AS tout,
                COALESCE(SUM(cost_usd), 0) AS cost,
                COALESCE(MAX(latency_ms), 0) AS max_latency
           FROM llm_calls WHERE edition_id = ?`,
        [this.editionId],
      );
      return {
        calls: Number(r?.calls ?? 0),
        tokensIn: Number(r?.tin ?? 0),
        tokensOut: Number(r?.tout ?? 0),
        costUsd: Number(r?.cost ?? 0),
        maxLatencyMs: Number(r?.max_latency ?? 0),
      };
    } catch {
      return { calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, maxLatencyMs: 0 };
    }
  }
}
