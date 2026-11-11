import { test } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "../src/adapters/db/sqlite.ts";
import type { Card, Truth } from "../src/core/types.ts";
import { buildMetaCards } from "../src/core/newsroom/meta.ts";

// DEC-0021: meta lokal boleh fetch teks penuh, maksimal tiga kali.

function truth(): Truth {
  return {
    claim: "Kontrak influencer masih dibahas",
    status: "sebagian",
    confidence: 0.7,
    band: "kemungkinan_besar",
    basis: {
      strongest: "two_independent_tier2",
      primary: 0,
      tier2: 2,
      independent_outlets: 2,
      contradicting: 0,
    },
    gaps: [],
    would_change_if: null,
    assessed_at: "2026-11-11T05:00:00+07:00",
  };
}

function card(id: string, title: string): Card {
  return {
    id: "c1",
    type: "news",
    topic_id: `t_${id}`,
    angle: title,
    kicker: "Sleman",
    title,
    status: "sebagian",
    truth: truth(),
    body: ["Paragraf."],
    action: "Baca sumbernya.",
    image: null,
    sources: [
      {
        outlet: "harianjogja.com",
        url: `https://harianjogja.com/${id}`,
        published_at: "2026-11-10T10:00:00+07:00",
        tier: 2,
        accessed_at: "2026-11-11T05:00:00+07:00",
      },
    ],
    revision: 1,
    first_seen: "2026-11-10",
    previous_edition: null,
    changes: [],
    place: "lokal",
  } as Card;
}

function stubDb(title: string): Db {
  return {
    get(sql: string) {
      if (sql.includes("FROM articles")) {
        return { title_display: title, lead: "", outlet: "harianjogja.com", published_at: "2026-11-10T10:00:00+07:00" };
      }
      return undefined;
    },
    run() {
      /* cache set diabaikan */
    },
  } as unknown as Db;
}

const LONG = [
  "Kontrak influencer itu masih berstatus usulan di kementerian dan belum ditandatangani.",
  "Sejumlah pihak meminta dokumen kontrak dibuka kepada publik sebelum proses berjalan.",
  "Kementerian belum memberikan tanggapan resmi atas permintaan tersebut.",
  "Pengamat menyebut proses pengadaan perlu diaudit sebelum pembayaran dilakukan.",
  "Nilai kontrak disebut mencapai belasan miliar rupiah dalam dokumen yang beredar.",
  "Dokumen itu memuat lampiran anggaran, jadwal pelaksanaan, dan daftar pihak yang terlibat.",
  "Audit internal dijadwalkan menelusuri alur persetujuan sebelum kontrak ditandatangani.",
].join(" ");

test("lokal: fetch teks penuh lalu menghasilkan misread", async () => {
  let calls = 0;
  const out = await buildMetaCards({
    db: stubDb("RANS Ungkap Rincian Kontrak Influencer"),
    editionId: "2026-11-11",
    publishedAt: "2026-11-11T05:00:00+07:00",
    scope: "lokal",
    cards: [card("a", "RANS Ungkap Rincian Kontrak Influencer")],
    previous: [],
    fetchArticle: async () => {
      calls++;
      return { ok: true, text: LONG };
    },
  });

  assert.equal(calls, 1);
  assert.equal(out.cards.length, 1);
  assert.equal(out.cards[0]!.type, "misread");
  assert.equal(out.stats.text_fetched, 1);
});

test("nasional tidak melakukan fetch tambahan", async () => {
  let calls = 0;
  const out = await buildMetaCards({
    db: stubDb("RANS Ungkap Rincian Kontrak Influencer"),
    editionId: "2026-11-11",
    publishedAt: "2026-11-11T05:00:00+07:00",
    scope: "nasional",
    cards: [card("a", "RANS Ungkap Rincian Kontrak Influencer")],
    previous: [],
    fetchArticle: async () => {
      calls++;
      return { ok: true, text: LONG };
    },
  });

  assert.equal(calls, 0);
  assert.equal(out.cards.length, 0);
});

test("budget fetch dihormati", async () => {
  let calls = 0;
  await buildMetaCards({
    db: stubDb("Topik tanpa kualifikasi"),
    editionId: "2026-11-11",
    publishedAt: "2026-11-11T05:00:00+07:00",
    scope: "lokal",
    maxFetches: 1,
    cards: [card("a", "Topik pertama"), card("b", "Topik kedua")],
    previous: [],
    fetchArticle: async () => {
      calls++;
      return { ok: true, text: "Tidak ada kualifikasi di sini. ".repeat(30) };
    },
  });

  assert.equal(calls, 1, "hanya satu fetch meski dua kartu");
});

test("META_LOCAL_FETCH=0 mematikan fetch", async () => {
  process.env.META_LOCAL_FETCH = "0";
  let calls = 0;
  await buildMetaCards({
    db: stubDb("RANS Ungkap Rincian Kontrak Influencer"),
    editionId: "2026-11-11",
    publishedAt: "2026-11-11T05:00:00+07:00",
    scope: "lokal",
    cards: [card("a", "RANS Ungkap Rincian Kontrak Influencer")],
    previous: [],
    fetchArticle: async () => {
      calls++;
      return { ok: true, text: LONG };
    },
  });
  delete process.env.META_LOCAL_FETCH;
  assert.equal(calls, 0);
});

test("fetch gagal tidak melempar dan tidak menghasilkan kartu", async () => {
  const out = await buildMetaCards({
    db: stubDb("RANS Ungkap Rincian Kontrak Influencer"),
    editionId: "2026-11-11",
    publishedAt: "2026-11-11T05:00:00+07:00",
    scope: "lokal",
    cards: [card("a", "RANS Ungkap Rincian Kontrak Influencer")],
    previous: [],
    fetchArticle: async () => ({ ok: false, text: "" }),
  });
  assert.equal(out.cards.length, 0);
});
