import { existsSync, readFileSync } from "node:fs";

/** Muat .env.local sederhana tanpa dependensi. Tidak menimpa env yang sudah ada. */
export function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    if (process.env[key] !== undefined) continue;
    process.env[key] = m[2]!.replace(/^["']|["']$/g, "").trim();
  }
}
