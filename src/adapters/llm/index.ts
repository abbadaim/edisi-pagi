import type { LlmAdapter } from "./types.ts";
import { createDeepSeekAdapter } from "./deepseek.ts";
import { createOpenCodeAdapter, probeOpenCode, listModels } from "./opencode.ts";
import { createFallbackAdapter } from "./fallback.ts";
import type { CapabilityConfig } from "../../config/llm.ts";

export type { LlmAdapter, Usage, JsonRequest, TextRequest, EmbedRequest } from "./types.ts";
export { createFallbackAdapter, probeOpenCode, listModels };

/**
 * Factory adapter. M1 hanya mengimplementasikan `deepseek`.
 * `opencode` dan `local` menyusul di M2 — lihat INFRA.md §11.4 dan §11.5.
 */
export function createAdapter(cfg: CapabilityConfig, env: NodeJS.ProcessEnv = process.env): LlmAdapter {
  switch (cfg.provider) {
    case "deepseek": {
      const apiKey = env.DEEPSEEK_API_KEY;
      if (!apiKey) throw new Error("DEEPSEEK_API_KEY tidak ada di environment");
      return createDeepSeekAdapter({ apiKey });
    }
    case "opencode":
      return createOpenCodeAdapter({
        bin: env.OPENCODE_BIN,
        defaultModel: cfg.model,
        cwd: env.OPENCODE_CWD,
      });
    case "local":
      throw new Error(
        "adapter local (embedding) belum diimplementasikan (M2). Lihat INFRA.md §11.5.",
      );
    default:
      throw new Error(`penyedia tidak dikenal: ${String((cfg as { provider?: string }).provider)}`);
  }
}
