import { createAdapter, createFallbackAdapter, probeOpenCode } from "./index.ts";
import type { JsonRequest, LlmAdapter, TextRequest } from "./types.ts";

export interface ResolvedLlm {
  llm: LlmAdapter | null;
  model: string;
  provider: string;
}

/**
 * Setiap adapter diikat ke modelnya sendiri. Tanpa ini, rantai cadangan
 * mengirim nama model opencode ke DeepSeek — dan DeepSeek menolaknya
 * dengan 400 "model tidak didukung", yang dulu tersembunyi di balik fallback.
 */
function bindModel(adapter: LlmAdapter, model: string): LlmAdapter {
  return {
    name: adapter.name,
    json: <T>(req: JsonRequest) => adapter.json<T>({ ...req, model }),
    text: (req: TextRequest) => adapter.text({ ...req, model }),
    ...(adapter.embed ? { embed: (req: Parameters<NonNullable<LlmAdapter["embed"]>>[0]) => adapter.embed!(req) } : {}),
  };
}

/**
 * Rantai penyedia: opencode -> deterministik.
 *
 * `LLM_PROVIDER=opencode` memaksa OpenCode. `LLM_PROVIDER=deepseek` memakai
 * DeepSeek API langsung. Tanpa `LLM_PROVIDER`, DeepSeek **tidak** dipakai:
 * API itu berbayar per token dan tidak boleh menjadi cadangan otomatis
 * (`DEC-0016`).
 */
export function resolveLlm(env: NodeJS.ProcessEnv = process.env): ResolvedLlm {
  const forced = env.LLM_PROVIDER as "opencode" | "deepseek" | undefined;
  const opencodeModel = env.OPENCODE_MODEL || "opencode-go/deepseek-v4.1-flash";
  const deepseekModel = env.DEEPSEEK_MODEL || "deepseek-chat";

  const chain: LlmAdapter[] = [];
  let model = opencodeModel;

  if (!forced || forced === "opencode") {
    if (probeOpenCode(env.OPENCODE_BIN)) {
      try {
        chain.push(bindModel(createAdapter({ provider: "opencode", model: opencodeModel }, env), opencodeModel));
      } catch {
        /* lanjut ke deterministik */
      }
    } else {
      console.log("opencode tidak tersedia — memakai penulis deterministik (DeepSeek nonaktif, DEC-0016)");
    }
  }

  // DeepSeek hanya lewat permintaan eksplisit, tidak pernah sebagai cadangan.
  if (forced === "deepseek") {
    if (env.DEEPSEEK_API_KEY) {
      try {
        chain.push(bindModel(createAdapter({ provider: "deepseek", model: deepseekModel }, env), deepseekModel));
        if (chain.length === 1) model = deepseekModel;
      } catch {
        /* lanjut ke deterministik */
      }
    } else {
      console.log("LLM_PROVIDER=deepseek tetapi DEEPSEEK_API_KEY tidak ada — memakai penulis deterministik");
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
