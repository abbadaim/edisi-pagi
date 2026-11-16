import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRegistry } from "../src/core/outlets.ts";
import { parse } from "yaml";

const root = new URL("..", import.meta.url).pathname;

test("registry: entri terverifikasi dipakai, yang kosong tidak", () => {
  const reg = parseRegistry({
    outlets: [
      { outlet: "a.com", pemilik: "Grup A", diverifikasi_pada: "2026-11-16" },
      { outlet: "b.com", pemilik: "Grup B", diverifikasi_pada: null },
    ],
  });
  assert.equal(reg.owners.get("a.com"), "Grup A");
  assert.equal(reg.owners.has("b.com"), false);
  assert.equal(reg.all.size, 2);
});

test("registry: dokumen rusak tidak melempar", () => {
  assert.equal(parseRegistry(null).entries.length, 0);
  assert.equal(parseRegistry({}).owners.size, 0);
});

test("setiap outlet di feeds.yaml punya entri registry", () => {
  const feeds = readFileSync(join(root, "config", "feeds.yaml"), "utf8");
  const outlets = new Set([...feeds.matchAll(/outlet:\s*([\w.\-]+)/g)].map((m) => m[1]!));
  const reg = parseRegistry(
    parse(readFileSync(join(root, "config", "outlets.yaml"), "utf8")),
  );
  const missing = [...outlets].filter((o) => !reg.all.has(o));
  assert.deepEqual(missing, [], `outlet tanpa registry: ${missing.join(", ")}`);
});
