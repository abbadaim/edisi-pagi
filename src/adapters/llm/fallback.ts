import type { EmbedRequest, JsonRequest, LlmAdapter, TextRequest } from "./types.ts";

/**
 * Coba penyedia berurutan. Dipakai untuk opencode -> deepseek -> (pemanggil
 * memakai writer deterministik jika semuanya gagal).
 */
export function createFallbackAdapter(
  adapters: LlmAdapter[],
  onFallback?: (from: string, to: string, error: unknown) => void,
): LlmAdapter {
  if (adapters.length === 0) throw new Error("tidak ada adapter");
  const primary = adapters[0]!;

  async function attempt<T>(
    call: (a: LlmAdapter) => Promise<T>,
    capability: string,
  ): Promise<T> {
    let lastError: unknown;

    for (let i = 0; i < adapters.length; i++) {
      const adapter = adapters[i]!;
      try {
        return await call(adapter);
      } catch (e) {
        lastError = e;
        const next = adapters[i + 1];
        if (next) onFallback?.(adapter.name, next.name, e);
      }
    }

    throw new Error(
      `${capability}: semua penyedia gagal — ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  const withEmbed = adapters.some((a) => typeof a.embed === "function");

  const adapter: LlmAdapter = {
    name: primary.name,
    json: <T>(req: JsonRequest) => attempt((a) => a.json<T>(req), "json"),
    text: (req: TextRequest) => attempt((a) => a.text(req), "text"),
  };

  if (withEmbed) {
    adapter.embed = (req: EmbedRequest) =>
      attempt((a) => {
        if (!a.embed) throw new Error(`${a.name} tidak mendukung embedding`);
        return a.embed(req);
      }, "embed");
  }

  return adapter;
}
