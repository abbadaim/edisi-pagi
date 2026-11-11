import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeCards } from "../src/core/newsroom/dedupe.ts";
import type { Card } from "../src/core/types.ts";

function card(title: string, sources: number, body = "Isi berita yang cukup panjang."): Card {
  return {
    id: "c1",
    type: "news",
    topic_id: "t_test",
    angle: title,
    kicker: "Nasional",
    title,
    status: "sebagian",
    truth: null,
    body: [body],
    action: "Tidak ada.",
    image: null,
    sources: Array.from({ length: sources }, (_, i) => ({
      outlet: `media${i}.com`,
      url: `https://media${i}.com/a`,
      published_at: null,
      tier: 2 as const,
      accessed_at: "2026-11-10T20:00:00+07:00",
    })),
    revision: 1,
    first_seen: "2026-11-10",
    previous_edition: null,
    changes: [],
    place: "nasional",
  } as Card;
}

test("dedupeCards membuang judul kembar dan memilih yang lebih kuat", () => {
  const a = card("Kabar Raja Juli dan Isyana Mundur dari PSI", 1);
  const b = card("Kabar Raja Juli dan Isyana Mundur dari PSI Belum Terverifikasi", 3, "Isi lebih panjang dan lengkap.");
  const c = card("KPK periksa kepala kantor pertanahan", 2);
  const out = dedupeCards([a, b, c], 0.5);
  assert.equal(out.length, 2);
  assert.ok(out.some((x) => x.title.includes("Belum Terverifikasi")));
  assert.ok(out.some((x) => x.title.includes("KPK")));
});

test("dedupeCards tidak menggabungkan hoax_roundup dengan news", () => {
  const a = card("Yang beredar dan sudah dibantah", 1);
  const h = { ...card("Yang beredar dan sudah dibantah", 1), type: "hoax_roundup" } as Card;
  assert.equal(dedupeCards([a, h]).length, 2);
});
