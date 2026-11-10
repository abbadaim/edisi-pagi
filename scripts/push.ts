#!/usr/bin/env node
/**
 * Kirim satu notifikasi harian (Model A). Payload generik; aplikasi yang
 * memutuskan apakah pembaruan itu relevan.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "../src/config/env.ts";

const require = createRequire(import.meta.url);
const webpush = require("web-push") as {
  setVapidDetails(subject: string, pub: string, priv: string): void;
  sendNotification(sub: unknown, payload: string): Promise<unknown>;
};

const root = new URL("..", import.meta.url).pathname;
loadEnvFile(join(root, ".env.local"));

const dry = process.argv.includes("--dry");
const publicKey = (() => {
  try {
    return (JSON.parse(readFileSync(join(root, "public", "config.json"), "utf8")) as { vapidPublicKey?: string })
      .vapidPublicKey;
  } catch {
    return undefined;
  }
})();
const privateKey = process.env.VAPID_PRIVATE_KEY;

if (!publicKey || !privateKey) {
  console.error("VAPID tidak lengkap: jalankan npm run gen:vapid lalu set VAPID_PRIVATE_KEY");
  process.exit(2);
}

const subscriptions: unknown[] = [];
if (process.env.PUSH_SUBSCRIPTIONS) subscriptions.push(...JSON.parse(process.env.PUSH_SUBSCRIPTIONS));
else if (process.env.PUSH_SUBSCRIPTION) subscriptions.push(JSON.parse(process.env.PUSH_SUBSCRIPTION));

if (subscriptions.length === 0) {
  console.log("tidak ada langganan (PUSH_SUBSCRIPTION kosong) — notifikasi dilewati");
  process.exit(0);
}

interface Manifest {
  latest: string | null;
  editions: Array<{ edition_id: string; scope: string; card_count: number; path: string }>;
}

const manifest = JSON.parse(readFileSync(join(root, "public", "manifest.json"), "utf8")) as Manifest;

let payload = {
  edition_id: manifest.latest,
  title: "Edisi Pagi",
  body: "Edisi baru siap.",
  updates: 0,
  url: "/",
};

if (manifest.latest) {
  const entry = manifest.editions.find((e) => e.edition_id === manifest.latest && e.scope === "nasional");
  if (entry) {
    const edition = JSON.parse(readFileSync(join(root, "public", entry.path.replace(/^\//, "")), "utf8"));
    const updates = (edition.cards ?? []).filter((c: { changes?: unknown[] }) => (c.changes ?? []).length > 0).length;
    const lokal = manifest.editions.find((e) => e.edition_id === manifest.latest && e.scope === "lokal");
    payload = {
      edition_id: manifest.latest,
      title: `Edisi ${manifest.latest}`,
      body: `Nasional ${entry.card_count}${lokal ? ` · Sleman ${lokal.card_count}` : ""}${updates ? ` · ${updates} pembaruan` : ""}`,
      updates,
      url: "/",
    };
  }
}

if (dry) {
  console.log(JSON.stringify({ payload, recipients: subscriptions.length }, null, 2));
  process.exit(0);
}

webpush.setVapidDetails("mailto:admin@example.com", publicKey, privateKey);

let ok = 0;
for (const sub of subscriptions) {
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload));
    ok++;
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    console.warn(`gagal kirim${status ? ` (${status})` : ""}: ${e instanceof Error ? e.message : e}`);
  }
}
console.log(`${ok}/${subscriptions.length} notifikasi terkirim · ${payload.body}`);
