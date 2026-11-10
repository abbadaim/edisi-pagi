#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { validateEdition, formatErrors, allowsThin } from "../src/core/validate.ts";

const root = new URL("..", import.meta.url).pathname;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".json")) out.push(p);
  }
  return out;
}

const args = process.argv.slice(2);
const files = args.length > 0 ? args : walk(join(root, "fixtures", "valid"));

if (files.length === 0) {
  console.error("tidak ada berkas untuk divalidasi");
  process.exit(2);
}

let failed = 0;

for (const file of files) {
  const label = relative(root, file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.log(`✗ ${label}  JSON tidak bisa dibaca: ${e instanceof Error ? e.message : e}`);
    failed++;
    continue;
  }

  const result = validateEdition(parsed);
  if (result.ok) {
    console.log(`✓ ${label}`);
  } else if (allowsThin(result.errors)) {
    // Edisi sengaja tipis (mode uji): bukan kegagalan struktur.
    console.log(`△ ${label}  (tipis: ${result.errors.map((e) => e.code).join(", ")})`);
  } else {
    console.log(`✗ ${label}`);
    console.log(formatErrors(result.errors));
    failed++;
  }
}

console.log(`\n${files.length - failed}/${files.length} valid`);
process.exit(failed === 0 ? 0 : 1);
