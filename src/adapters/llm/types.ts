export interface Usage {
  tokens_in: number;
  tokens_out: number;
  cost_usd?: number;
}

export interface JsonRequest {
  model: string;
  system: string;
  user: string;
  /** JSON Schema; adapter hanya memakai ini untuk instruksi, validasi dilakukan core. */
  schema?: unknown;
  maxTokens?: number;
  temperature?: number;
}

export interface TextRequest {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

export interface EmbedRequest {
  model: string;
  texts: string[];
}

export interface LlmAdapter {
  readonly name: "opencode" | "deepseek" | "local";
  json<T>(req: JsonRequest): Promise<{ data: T; usage: Usage }>;
  text(req: TextRequest): Promise<{ text: string; usage: Usage }>;
  embed?(req: EmbedRequest): Promise<{ vectors: number[][]; usage: Usage }>;
}

export interface Pricing {
  /** USD per 1 juta token. */
  input: number;
  output: number;
}
