#!/usr/bin/env node
/** Buat pasangan kunci VAPID sekali. Kunci privat jangan pernah masuk repo. */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const webpush = require("web-push") as {
  generateVAPIDKeys(): { publicKey: string; privateKey: string };
};

const root = new URL("..", import.meta.url).pathname;
const envPath = join(root, ".env.local");
const configPath = join(root, "public", "config.json");

const keys = webpush.generateVAPIDKeys();

// .env.local: tambah atau ganti baris VAPID_PRIVATE_KEY
let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
env = env.replace(/^VAPID_PRIVATE_KEY=.*$/m, "").trim();
env += `\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`;
writeFileSync(envPath, env.trim() + "\n");

// config.json memuat lebih dari VAPID sejak rencana 022 (Supabase). Tulis
// ulang hanya kuncinya — jangan hapus kunci lain yang sudah ada di berkas.
const existing = existsSync(configPath)
  ? (JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>)
  : {};
writeFileSync(configPath, JSON.stringify({ ...existing, vapidPublicKey: keys.publicKey }, null, 2) + "\n");

console.log("kunci dibuat.");
console.log("  privat -> .env.local (gitignored)");
console.log("  publik -> public/config.json (aman dipublikasikan)");
console.log("\nSalin kunci privat ke GitHub Secrets sebagai VAPID_PRIVATE_KEY.");
