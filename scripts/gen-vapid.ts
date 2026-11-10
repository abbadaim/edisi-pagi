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

writeFileSync(configPath, JSON.stringify({ vapidPublicKey: keys.publicKey }, null, 2) + "\n");

console.log("kunci dibuat.");
console.log("  privat -> .env.local (gitignored)");
console.log("  publik -> public/config.json (aman dipublikasikan)");
console.log("\nSalin kunci privat ke GitHub Secrets sebagai VAPID_PRIVATE_KEY.");
