import { createAdapter, createFallbackAdapter, probeOpenCode } from "./index.ts";
import type { LlmAdapter } from "./types.ts";

export interface ResolvedLlm {
  llm: LlmAdapter | null;
  model: string;
  provider: string;
}

/**
 * Rantai penyedia: opencode -> deepseek -> deterministik.
 * `LLM_PROVIDER` memaksa satu penyedia (berguna saat menguji cadangan).
 * Dipakai oleh `build` (harian) dan `weekly` supaya keduanya menulis
 * dengan kualitas yang sama.
 */
export function resolveLlm(env: NodeJS.ProcessEnv = process.env): ResolvedLlm {
  const forced = env.LLM_PROVIDER as "opencode" | "deepseek" | undefined;
  const opencodeModel = env.OPENCODE_MODEL || "opencode-go/deepseek-v4.1-flash";
  const deepseekModel = env.DEEPSEEK_MODEL || "deepseek-chat";
  const model = forced === "deepseek" ? deepseekModel : opencodeModel;

  const chain: LlmAdapter[] = [];
  if (!forced || forced === "opencode") {
    if (probeOpenCode(env.OPENCODE_BIN)) {
      try {
        chain.push(createAdapter({ provider: "opencode", model: opencodeModel }, env));
      } catch {
        /* lanjut ke cadangan */
      }
    } else if (!forced) {
      console.log("opencode tidak tersedia, mencoba deepseek");
    }
  }
  if ((!forced || forced === "deepseek") && env.DEEPSEEK_API_KEY) {
    try {
      chain.push(createAdapter({ provider: "deepseek", model: deepseekModel }, env));
    } catch {
      /* lanjut */
    }
  }

  const first = chain[0];
  const llm =
    chain.length === 0
      ? null
      : chain.length === 1 && first
        ? first
        : createFallbackAdapter(chain, (from, to, e) => {
            const why = e instanceof Error ? e.message.slice(0, 80) : String(e);
            console.log(`  ! ${from} gagal (${why}), pindah ke ${to}`);
          });

  return { llm, model, provider: llm?.name ?? "deterministic" };
}
