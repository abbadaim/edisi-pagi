import type { JsonRequest, LlmAdapter, Pricing, TextRequest, Usage } from "./types.ts";

const BASE_URL = "https://api.deepseek.com";

export interface DeepSeekOptions {
  apiKey: string;
  baseUrl?: string;
  /** Dipakai hanya untuk menghitung cost_usd. Tanpa ini, biaya tidak dicatat. */
  pricing?: Record<string, Pricing>;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Model kadang menyisipkan newline mentah di dalam string JSON. Itu bukan
 * JSON valid, tetapi isinya masih bisa dipakai setelah karakter kontrol
 * diubah menjadi spasi (di luar string, spasi tetap whitespace sah).
 */
function parseJsonLoose(content: string): unknown {
  const fenced = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  for (const attempt of [fenced, fenced.replace(/[\u0000-\u001F]/g, " ")]) {
    try {
      return JSON.parse(attempt);
    } catch {
      /* coba bentuk berikutnya */
    }
  }
  throw new Error(`respons bukan JSON valid: ${fenced.slice(0, 160)}`);
}

export function createDeepSeekAdapter(opts: DeepSeekOptions): LlmAdapter {
  if (!opts.apiKey) throw new Error("DEEPSEEK_API_KEY kosong");
  const baseUrl = opts.baseUrl ?? BASE_URL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxRetries = opts.maxRetries ?? 2;

  async function chat(body: Record<string, unknown>): Promise<{ content: string; usage: Usage }> {
    let lastErr: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${opts.apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (res.status >= 500 || res.status === 429) {
          throw new Error(`HTTP ${res.status}`);
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`DeepSeek ${res.status}: ${text.slice(0, 200)}`);
        }

        const json = (await res.json()) as ChatResponse;
        const choice = json.choices?.[0];
        const content = choice?.message?.content ?? "";
        const model = String(body.model);

        // Model reasoning (mis. deepseek-flash) menghabiskan token di
        // reasoning_content dan bisa mengembalikan content kosong dengan
        // finish_reason "length". Itu kegagalan, bukan jawaban sah.
        if (!content.trim()) {
          const why = choice?.finish_reason === "length" ? "kehabisan token" : "kosong";
          throw new Error(`DeepSeek: konten ${why} (${model})`);
        }
        const price = opts.pricing?.[model];

        const usage: Usage = {
          tokens_in: json.usage?.prompt_tokens ?? 0,
          tokens_out: json.usage?.completion_tokens ?? 0,
        };
        if (price) {
          usage.cost_usd =
            (usage.tokens_in / 1_000_000) * price.input +
            (usage.tokens_out / 1_000_000) * price.output;
        }

        return { content, usage };
      } catch (e) {
        lastErr = e;
        if (attempt === maxRetries) break;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }

    throw new Error(
      `DeepSeek gagal setelah ${maxRetries + 1} percobaan: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`,
    );
  }

  return {
    name: "deepseek",

    async json<T>(req: JsonRequest) {
      const { content, usage } = await chat({
        model: req.model,
        messages: [
          { role: "system", content: `${req.system}\n\nBalas HANYA dengan JSON valid.` },
          { role: "user", content: req.user },
        ],
        response_format: { type: "json_object" },
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.2,
        stream: false,
      });

      let data: T;
      try {
        data = parseJsonLoose(content) as T;
      } catch (e) {
        const tail = content.trim().slice(-60).replace(/\s+/g, " ");
        throw new Error(
          `${(e as Error).message} [finish=${choice?.finish_reason ?? "?"}, akhir="${tail}"]`,
        );
      }
      return { data, usage };
    },

    async text(req: TextRequest) {
      const { content, usage } = await chat({
        model: req.model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        max_tokens: req.maxTokens ?? 2048,
        temperature: req.temperature ?? 0.4,
        stream: false,
      });
      return { text: content, usage };
    },

    // DeepSeek tidak punya endpoint embedding — sengaja tidak diimplementasikan.
  };
}
