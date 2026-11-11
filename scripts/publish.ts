#!/usr/bin/env node
/**
 * Kumpulkan edisi yang valid ke `public/` dan tulis manifest.
 * Aplikasi hanya membaca `public/`, jadi tidak pernah menyentuh state pipeline.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { isoWib } from "../src/core/time.ts";
import { validateEdition, allowsThin } from "../src/core/validate.ts";

const root = new URL("..", import.meta.url).pathname;
const dataDir = join(root, "data");
const editionsDir = join(dataDir, "editions");
const assetsDir = join(dataDir, "assets");
const outDir = join(root, "public");
const outEditions = join(outDir, "data", "editions");
const outAssets = join(outDir, "assets");
const outIcons = join(outDir, "icons");

if (!existsSync(editionsDir)) {
  console.error("belum ada edisi; jalankan npm run build dulu");
  process.exit(2);
}

rmSync(outEditions, { recursive: true, force: true });
mkdirSync(outEditions, { recursive: true });
mkdirSync(outAssets, { recursive: true });
mkdirSync(outIcons, { recursive: true });

interface Entry {
  edition_id: string;
  scope: string;
  published_at: string;
  card_count: number;
  reading_time_min: number;
  path: string;
}

const entries: Entry[] = [];
let skipped = 0;

for (const file of readdirSync(editionsDir).filter((f) => f.endsWith(".json")).sort()) {
  const raw = JSON.parse(readFileSync(join(editionsDir, file), "utf8"));
  const check = validateEdition(raw);
  const thin = !check.ok && raw.cards?.length > 0 && allowsThin(check.errors);
  if (!check.ok && !thin) {
    console.log(`lewati ${file}: tidak valid`);
    skipped++;
    continue;
  }
  if (thin) console.log(`publikasikan ${file}: edisi tipis (uji)`);
  copyFileSync(join(editionsDir, file), join(outEditions, file));
  entries.push({
    edition_id: raw.edition_id,
    scope: raw.scope,
    published_at: raw.published_at,
    card_count: raw.card_count,
    reading_time_min: raw.reading_time_min,
    path: `data/editions/${file}`,
  });
}

if (assetsDir && existsSync(assetsDir)) {
  for (const file of readdirSync(assetsDir)) {
    if (file.endsWith(".webp")) copyFileSync(join(assetsDir, file), join(outAssets, file));
  }
}

const iconsSrc = join(root, "mockup", "icons");
if (existsSync(iconsSrc)) {
  for (const file of readdirSync(iconsSrc)) copyFileSync(join(iconsSrc, file), join(outIcons, file));
}
const iconSvg = join(root, "mockup", "icon.svg");
if (existsSync(iconSvg)) copyFileSync(iconSvg, join(outIcons, "icon.svg"));

const latest = entries
  .map((e) => e.edition_id)
  .sort()
  .at(-1);
const oldest = entries.map((e) => e.edition_id).sort()[0];

// Hanya edisi yang tanggalnya sama dengan `latest` yang dianggap "hari ini".
// Edisi lokal kemarin tidak boleh tampil sebagai edisi lokal hari ini.
const latestByScope: Record<string, string | null> = {
  nasional: null,
  lokal: null,
  mingguan: null,
};
for (const e of entries) {
  if (e.edition_id === latest) latestByScope[e.scope] = latest;
}

const manifest = {
  schema_version: 1,
  generated_at: isoWib(new Date()),
  latest: latest ?? null,
  latest_by_scope: latestByScope,
  retention: { years: 2, oldest: oldest ?? null },
  editions: entries.sort((a, b) =>
    a.edition_id === b.edition_id ? a.scope.localeCompare(b.scope) : b.edition_id.localeCompare(a.edition_id),
  ),
};

writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

// Cache-busting: GitHub Pages meng-cache app.js selama 10 menit. Tanpa versi
// berbasis isi, perubahan kode tidak sampai ke pengguna sampai cache kedaluwarsa.
const digest = (file: string) =>
  createHash("sha1").update(readFileSync(join(outDir, file))).digest("hex").slice(0, 8);

const indexPath = join(outDir, "index.html");
const versions = { "app.js": digest("app.js"), "style.css": digest("style.css"), "sw.js": digest("sw.js") };

let html = readFileSync(indexPath, "utf8");
for (const [file, v] of Object.entries(versions)) {
  html = html.replace(new RegExp(`${file.replace(".", "\\.")}(\\?v=[a-f0-9]+)?`, "g"), `${file}?v=${v}`);
}
writeFileSync(indexPath, html);

console.log(`${entries.length} edisi dipublikasikan${skipped ? `, ${skipped} dilewati` : ""}`);
for (const e of manifest.editions) console.log(`  ${e.edition_id} ${e.scope.padEnd(8)} ${e.card_count} kartu`);
console.log(`  ${join(outDir, "manifest.json")}`);
