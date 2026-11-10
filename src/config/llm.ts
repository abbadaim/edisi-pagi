import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

export type Provider = "opencode" | "deepseek" | "local";
export type Capability = "adjudicate" | "write" | "verify" | "embed";

export interface CapabilityConfig {
  provider: Provider;
  model: string;
}

export interface LlmConfig {
  capabilities: Record<Capability, CapabilityConfig>;
}

const PROVIDERS: Provider[] = ["opencode", "deepseek", "local"];
const CAPABILITIES: Capability[] = ["adjudicate", "write", "verify", "embed"];

export const DEFAULT_CONFIG: LlmConfig = {
  capabilities: {
    adjudicate: { provider: "deepseek", model: "deepseek-flash" },
    write: { provider: "deepseek", model: "deepseek-flash" },
    verify: { provider: "deepseek", model: "deepseek-v4-pro" },
    embed: { provider: "local", model: "Xenova/multilingual-e5-small" },
  },
};

export function loadLlmConfig(path: string): LlmConfig {
  const raw = parseYaml(readFileSync(path, "utf8")) as Partial<LlmConfig> | null;
  if (!raw?.capabilities) throw new Error(`${path}: bagian "capabilities" tidak ada`);

  const out = { capabilities: {} as Record<Capability, CapabilityConfig> };
  for (const cap of CAPABILITIES) {
    const entry = raw.capabilities[cap];
    if (!entry) throw new Error(`${path}: kapabilitas "${cap}" tidak ada`);
    out.capabilities[cap] = { provider: entry.provider, model: entry.model };
  }
  return out;
}

/**
 * Validasi konfigurasi sebelum pipeline berjalan (INFRA.md §11.6).
 * Gagal di sini jauh lebih baik daripada gagal pukul 05.45.
 */
export function validateLlmConfig(cfg: LlmConfig, env: NodeJS.ProcessEnv = process.env): string[] {
  const errors: string[] = [];

  for (const cap of CAPABILITIES) {
    const c = cfg.capabilities[cap];
    if (!c) {
      errors.push(`kapabilitas "${cap}" tidak dikonfigurasi`);
      continue;
    }
    if (!PROVIDERS.includes(c.provider)) {
      errors.push(`${cap}: penyedia tidak dikenal "${c.provider}"`);
    }
    if (!c.model?.trim()) {
      errors.push(`${cap}: model kosong`);
    }
  }

  // DeepSeek tidak punya endpoint embedding.
  if (cfg.capabilities.embed?.provider === "deepseek") {
    errors.push('embed: deepseek tidak mendukung embedding; pakai "local" atau "opencode"');
  }

  const needsDeepSeekKey = CAPABILITIES.some(
    (cap) => cfg.capabilities[cap]?.provider === "deepseek",
  );
  if (needsDeepSeekKey && !env.DEEPSEEK_API_KEY) {
    errors.push("DEEPSEEK_API_KEY tidak ada di environment");
  }

  return errors;
}

export function describe(cfg: LlmConfig): string {
  return CAPABILITIES.map((c) => `  ${c.padEnd(11)} ${cfg.capabilities[c].provider}/${cfg.capabilities[c].model}`).join("\n");
}
