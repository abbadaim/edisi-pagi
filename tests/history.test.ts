import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHistory, previousTitle } from "../src/core/history.ts";
import { withStatusChanges, updateCount } from "../src/core/newsroom/continuity.ts";
import type { Card } from "../src/core/types.ts";

function card(over: Partial<Card> = {}): Card {
  return {
    id: "c1",
    type: "news",
    topic_id: "t_contoh_topik",
    angle: "Angle",
    kicker: "Nasional",
    title: "Judul",
    status: "sebagian",
    truth: null,
    body: [],
    action: "Pantau",
    image: null,
    sources: [{ outlet: "tirto.id", url: "https://tirto.id/a", tier: 2, accessed_at: "2026-11-16T06:00:00+07:00" }],
    revision: 2,
    first_seen: "2026-11-14",
    previous_edition: "2026-11-15",
    changes: [],
    ...over,
  } as Card;
}

test("riwayat: satu baris per edisi, revisi tertinggi menang", () => {
  const out = buildHistory([
    { edition_id: "2026-11-15", title: "Judul lama", revision: 3 },
    { edition_id: "2026-11-15", title: "Judul baru", revision: 9 },
    { edition_id: "2026-11-16", title: "Judul hari ini", revision: 2 },
  ]);
  assert.deepEqual(out, [
    { date: "2026-11-15", title: "Judul baru" },
    { date: "2026-11-16", title: "Judul hari ini" },
  ]);
});

test("riwayat: dipotong dari belakang, urut lama ke baru", () => {
  const rows = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"].map((d) => ({
    edition_id: d,
    title: `Judul ${d}`,
  }));
  const out = buildHistory(rows, 2);
  assert.deepEqual(out.map((h) => h.date), ["2026-11-12", "2026-11-13"]);
});

test("riwayat: baris kosong diabaikan, satu edisi tidak dianggap lanjutan", () => {
  assert.deepEqual(buildHistory([{ edition_id: "", title: "x" }]), []);
  assert.deepEqual(buildHistory([{ edition_id: "2026-11-16", title: "  " }]), []);
  assert.equal(buildHistory([{ edition_id: "2026-11-16", title: "Hanya sekali" }]).length, 1);
});

test("judul sebelumnya diambil dari edisi sebelum tanggal ini", () => {
  const hist = [
    { date: "2026-11-14", title: "A" },
    { date: "2026-11-16", title: "B" },
  ];
  assert.equal(previousTitle(hist, "2026-11-16"), "A");
  assert.equal(previousTitle(hist, "2026-11-14"), null);
});

test("perubahan status dicatat, perubahan judul tidak", () => {
  const now = card({ title: "Judul baru", status: "terkonfirmasi" });
  const prev = [
    { card: { topic_id: "t_contoh_topik", status: "sebagian" as const, title: "Judul lama" }, at: "2026-11-15" },
  ];
  const out = withStatusChanges([now], prev, "2026-11-16T06:00:00+07:00")[0]!;
  assert.equal(out.changes.length, 1);
  const change = out.changes[0]!;
  assert.equal(change.field, "status");
  assert.equal(change.from, "sebagian");
  assert.equal(change.to, "terkonfirmasi");
  assert.equal(change.basis.outlet, "tirto.id");
});

test("status sama atau tanpa sumber tidak menghasilkan perubahan", () => {
  const prev = [
    { card: { topic_id: "t_contoh_topik", status: "sebagian" as const, title: "x" }, at: "2026-11-15" },
  ];
  const same = withStatusChanges([card()], prev, "2026-11-16T06:00:00+07:00")[0]!;
  assert.equal(same.changes.length, 0);

  const noSource = card({ status: "terkonfirmasi", sources: [] });
  const withoutBasis = withStatusChanges([noSource], prev, "2026-11-16T06:00:00+07:00")[0]!;
  assert.equal(withoutBasis.changes.length, 0);
});

test("jumlah pembaruan dihitung dari edisi unik", () => {
  assert.equal(updateCount([{ date: "2026-11-15" }, { date: "2026-11-15" }, { date: "2026-11-16" }]), 2);
});
