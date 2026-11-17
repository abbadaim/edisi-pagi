/**
 * Regresi 2026-11-17: `frames` bertambah `owner`/`media` tetapi schema masih
 * `additionalProperties: false`, sehingga edisi 17 November ditolak validasi
 * dan tidak pernah terbit. Tes ini mengunci bentuk yang diterima schema.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateEdition } from "../src/core/validate.ts";

const root = new URL("..", import.meta.url).pathname;

test("edisi dengan frames ber-owner dan media lolos validasi", () => {
  const raw = JSON.parse(readFileSync(join(root, "data", "editions", "2026-11-13.nasional.json"), "utf8"));
  const card = raw.cards.find((c: { type: string }) => c.type === "news");
  card.frames = [
    {
      outlet: "detik.com",
      title: "Judul dari detik",
      url: "https://news.detik.com/a",
      at: "2026-11-13T10:00:00+07:00",
      owner: "CT Corp",
      media: 3,
    },
    {
      outlet: "tirto.id",
      title: "Judul dari Tirto",
      url: "https://tirto.id/b",
      at: "2026-11-13T09:00:00+07:00",
      owner: "Tirto",
      media: 1,
    },
  ];
  const res = validateEdition(raw);
  const framesErrors = res.errors.filter((e) => e.path.includes("/frames"));
  assert.deepEqual(framesErrors, [], `frames ditolak: ${JSON.stringify(framesErrors)}`);
});

test("frames tanpa owner tetap diterima", () => {
  const raw = JSON.parse(readFileSync(join(root, "data", "editions", "2026-11-13.nasional.json"), "utf8"));
  const card = raw.cards.find((c: { type: string }) => c.type === "news");
  card.frames = [
    { outlet: "a.com", title: "A", url: "https://a.com/x", at: null },
    { outlet: "b.com", title: "B", url: "https://b.com/y", at: null },
  ];
  const res = validateEdition(raw);
  assert.deepEqual(res.errors.filter((e) => e.path.includes("/frames")), []);
});

test("kontrol: properti asing di frames tetap ditolak", () => {
  const raw = JSON.parse(readFileSync(join(root, "data", "editions", "2026-11-13.nasional.json"), "utf8"));
  const card = raw.cards.find((c: { type: string }) => c.type === "news");
  card.frames = [{ outlet: "a.com", title: "A", url: "https://a.com/x", at: null, bogus: 1 }];
  const res = validateEdition(raw);
  assert.ok(
    res.errors.some((e) => e.path.includes("/frames")),
    "schema harus menolak properti di luar daftar; kalau tidak, tes owner/media tidak mengunci apa pun",
  );
});
