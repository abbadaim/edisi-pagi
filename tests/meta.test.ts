import { test } from "node:test";
import assert from "node:assert/strict";
import type { Card, Status, Truth } from "../src/core/types.ts";
import {
  buildChangeCard,
  buildMisreadCard,
  diffCards,
  findQualifierGap,
} from "../src/core/newsroom/meta.ts";

function truth(status: Status, claim: string): Truth {
  return {
    claim,
    status,
    confidence: 0.8,
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

function card(over: Partial<Card> = {}): Card {
  const status = (over.truth?.status ?? "sebagian") as Status;
  return {
    id: "c1",
    type: "news",
    topic_id: "t_dpr_hmp_abcd",
    angle: "Usulan bergulir",
    kicker: "Nasional",
    title: "DPR Bahas Usulan Hak Menyatakan Pendapat",
    status,
    truth: truth(status, "DPR membahas usulan hak menyatakan pendapat"),
    body: ["Paragraf."],
    action: "Baca dokumennya.",
    image: null,
    sources: [
      {
        outlet: "cnnindonesia.com",
        url: "https://cnnindonesia.com/a",
        published_at: "2026-11-10T10:00:00+07:00",
        tier: 2,
        accessed_at: "2026-11-11T05:00:00+07:00",
      },
    ],
    revision: 2,
    first_seen: "2026-11-10",
    previous_edition: "2026-11-10",
    changes: [],
    ...over,
  } as Card;
}

test("status yang berubah terdeteksi", () => {
  const prev = card({ truth: truth("belum", "DPR belum memutuskan usulan") });
  const curr = card({ truth: truth("sebagian", "DPR menyepakati usulan") });

  const diff = diffCards(prev, curr, "2026-11-10T05:00:00+07:00", "2026-11-11T05:00:00+07:00");
  assert.ok(diff);
  assert.equal(diff!.field, "status");
  assert.equal(diff!.from, "belum");
  assert.equal(diff!.to, "sebagian");
});

test("angka yang berubah terdeteksi saat status sama", () => {
  const prev = card({ truth: truth("sebagian", "9 tersangka ditetapkan") });
  const curr = card({ truth: truth("sebagian", "11 tersangka ditetapkan") });

  const diff = diffCards(prev, curr, "2026-11-10T05:00:00+07:00", "2026-11-11T05:00:00+07:00");
  assert.ok(diff);
  assert.equal(diff!.field, "number");
  assert.equal(diff!.from, "9");
  assert.equal(diff!.to, "11");
});

test("tidak ada perubahan bila status dan angka sama", () => {
  const prev = card({ truth: truth("sebagian", "9 tersangka ditetapkan") });
  const curr = card({ truth: truth("sebagian", "9 tersangka ditetapkan") });
  assert.equal(
    diffCards(prev, curr, "2026-11-10T05:00:00+07:00", "2026-11-11T05:00:00+07:00"),
    null,
  );
});

test("kartu perubahan memuat dua versi dan sumber", () => {
  const prev = card({
    truth: truth("belum", "DPR belum memutuskan usulan"),
    sources: [
      {
        outlet: "tirto.id",
        url: "https://tirto.id/a",
        published_at: "2026-11-10T09:00:00+07:00",
        tier: 2,
        accessed_at: "2026-11-11T05:00:00+07:00",
      },
    ],
  });
  const curr = card({ truth: truth("sebagian", "DPR menyepakati usulan") });
  const diff = diffCards(prev, curr, "2026-11-10T05:00:00+07:00", "2026-11-11T05:00:00+07:00")!;

  const out = buildChangeCard(prev, curr, diff, "2026-11-10T05:00:00+07:00", "2026-11-11T05:00:00+07:00");
  assert.ok(out);
  assert.equal(out!.type, "change");
  assert.match(out!.topic_id, /^t_change_/);
  assert.equal(out!.sources.length, 2);
  assert.equal(out!.previous_edition, "2026-11-10");
  assert.match((out as { what_changed: string }).what_changed, /Belum terkonfirmasi/);
});

test("kualifikasi di isi yang tidak ada di judul ditemukan", () => {
  const title = "DPR Setujui Anggaran Pendidikan 2027";
  const text = [
    "Pembahasan berlangsung tertutup selama dua hari dan hanya dihadiri anggota komisi.",
    "Anggaran itu masih berupa usulan yang harus dibahas bersama presiden sebelum disahkan.",
    "Pemerintah menargetkan pengesahan pada Desember, tetapi jadwal itu belum pasti.",
    "Sejumlah anggota meminta rincian program diperlihatkan lebih dulu kepada publik.",
    "Dokumen yang beredar menyebut ada tiga pos belanja baru yang belum pernah dibahas sebelumnya.",
    "Kementerian keuangan belum memberikan tanggapan tertulis atas permintaan rincian tersebut.",
  ].join(" ");

  const gap = findQualifierGap(title, text);
  assert.ok(gap);
  assert.deepEqual(gap!.missing, ["usulan"]);
  assert.match(gap!.sentence, /usulan/);
});

test("judul yang sudah memuat kualifikasi tidak dianggap misread", () => {
  const gap = findQualifierGap(
    "Usulan Anggaran Pendidikan 2027 Dibahas",
    "Pemerintah menyebut ini masih usulan. ".repeat(30),
  );
  assert.equal(gap, null);
});

test("teks pendek tidak dipakai untuk deteksi", () => {
  assert.equal(findQualifierGap("Judul", "Masih usulan."), null);
});

test("kartu misread memuat klaim, realitas, dan kata yang hilang", () => {
  const base = card();
  const out = buildMisreadCard(
    base,
    {
      title: "DPR Setujui Anggaran Pendidikan 2027",
      url: "https://cnnindonesia.com/a",
      outlet: "cnnindonesia.com",
      published_at: "2026-11-10T10:00:00+07:00",
      tier: 2,
    },
    {
      missing: ["usulan"],
      sentence: "Anggaran itu masih berupa usulan yang harus dibahas bersama presiden.",
      meaning: "masih berupa usulan, bukan keputusan",
    },
  );

  assert.equal(out.type, "misread");
  assert.match(out.topic_id, /^t_misread_/);
  assert.equal((out as { claim: string }).claim, "DPR Setujui Anggaran Pendidikan 2027");
  assert.deepEqual((out as { missing: string[] }).missing, [
    "masih berupa usulan, bukan keputusan",
  ]);
  assert.equal((out as { trigger: string }).trigger, "headline_body_gap");
  assert.equal(out.sources.length, 1);
});

test("buildMetaCards menghasilkan kartu change yang lolos validasi", async () => {
  const { buildMetaCards } = await import("../src/core/newsroom/meta.ts");
  const { buildEdition } = await import("../src/core/assemble.ts");
  const { validateEdition } = await import("../src/core/validate.ts");
  const { openSqlite, migrate } = await import("../src/adapters/db/sqlite.ts");

  const db = openSqlite(":memory:");
  migrate(db, new URL("../migrations/", import.meta.url).pathname);

  const prev = card({
    truth: truth("belum", "DPR belum memutuskan usulan"),
    previous_edition: null,
    revision: 1,
  });
  const curr = card({
    truth: truth("sebagian", "DPR menyepakati usulan"),
  });

  const out = await buildMetaCards({
    db,
    editionId: "2026-11-11",
    publishedAt: "2026-11-11T05:00:00+07:00",
    cards: [curr],
    previous: [{ card: prev, at: "2026-11-10T05:00:00+07:00" }],
  });
  db.close();

  assert.equal(out.cards.length, 1);
  assert.equal(out.cards[0]!.type, "change");
  assert.equal(out.changes.get(curr.topic_id)?.length, 1);

  const edition = buildEdition({
    scope: "nasional",
    editionId: "2026-11-11",
    publishedAt: "2026-11-11T05:00:00+07:00",
    coverage: { from: "2026-11-10T05:00:00+07:00", to: "2026-11-11T05:00:00+07:00" },
    generatedAt: "2026-11-11T05:00:00+07:00",
    place: { kabupaten: "Sleman", province: "DI Yogyakarta" },
    cards: out.cards,
    truncatedReason: "uji satu kartu",
    generatedBy: {
      adjudicate: { provider: "test", model: "test" },
      write: { provider: "test", model: "test" },
      verify: { provider: "rules", model: "test" },
      embed: { provider: "none", model: "none" },
    },
  });

  const check = validateEdition(edition);
  // Satu kartu sengaja tipis; yang diuji adalah struktur kartu meta.
  const structural = check.errors.filter((e) => e.code !== "E001");
  assert.deepEqual(structural, [], JSON.stringify(structural));
});
