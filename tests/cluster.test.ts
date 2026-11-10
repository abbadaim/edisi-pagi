import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterArticles, type ArticleRow } from "../src/core/cluster.ts";

const T = (hoursAgo: number) => new Date(Date.UTC(2026, 10, 10, 8, 0, 0) - hoursAgo * 3_600_000).toISOString();

function A(
  id: string,
  outlet: string,
  title: string,
  ents: Array<[string, number, number]>,
  hoursAgo: number,
): ArticleRow {
  return {
    id,
    url: `https://example.com/${id}`,
    outlet,
    title,
    titleNorm: title.toLowerCase(),
    lead: title,
    publishedAt: T(hoursAgo),
    entities: ents.map(([eid, idf, df]) => ({ id: eid, idf, df })),
  };
}

const gibranEnts: Array<[string, number, number]> = [
  ["dpr", 3.0, 55],
  ["gibran", 3.0, 49],
  ["hmp", 3.4, 20],
];

test("cerita sama dengan 3 entitas bersama menjadi satu klaster", () => {
  const rows = [
    A("a", "detik.com", "50 Anggota DPR Teken Hak Menyatakan Pendapat soal Gibran", gibranEnts, 20),
    A("b", "cnnindonesia.com", "Puluhan Anggota DPR Teken Hak Menyatakan Pendapat Wapres Gibran", gibranEnts, 18),
    A("c", "tirto.id", "Usulan Hak Menyatakan Pendapat soal Ijazah Gibran Bergulir", gibranEnts, 16),
  ];
  const clusters = clusterArticles(rows);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]!.articles.length, 3);
  assert.equal(clusters[0]!.outlets.length, 3);
});

test("satu entitas bersama saja tidak cukup", () => {
  const rows = [
    A("a", "detik.com", "Turkiye buka dua ladang minyak baru dekat Irak", [["turkiye", 3.0, 10]], 10),
    A("b", "cnnindonesia.com", "Turkiye peringatkan agar serangan ke Iran tidak dilakukan", [["turkiye", 3.0, 10]], 9),
  ];
  assert.equal(clusterArticles(rows).length, 0);
});

test("satu entitas bersama tetap boleh jika teksnya hampir identik (sindikasi)", () => {
  const t = "BP Lepas Bisnis SPBU di Indonesia, AKR Caplok 100 Persen Saham";
  const rows = [
    A("a", "detik.com", t, [["bp", 3.0, 10]], 10),
    A("b", "cnnindonesia.com", t, [["bp", 3.0, 10]], 9),
  ];
  assert.equal(clusterArticles(rows).length, 1);
});

test("jarak waktu > 72 jam memisahkan klaster", () => {
  const rows = [
    A("a", "detik.com", "50 Anggota DPR Teken Hak Menyatakan Pendapat", gibranEnts, 100),
    A("b", "cnnindonesia.com", "Puluhan Anggota DPR Teken Hak Menyatakan Pendapat", gibranEnts, 1),
  ];
  assert.equal(clusterArticles(rows).length, 0);
});

test("satu outlet saja tidak lolos", () => {
  const rows = [
    A("a", "detik.com", "50 Anggota DPR Teken Hak Menyatakan Pendapat", gibranEnts, 10),
    A("b", "detik.com", "Puluhan Anggota DPR Teken Hak Menyatakan Pendapat", gibranEnts, 9),
  ];
  assert.equal(clusterArticles(rows).length, 0);
});

test("entitas df=1 tidak dipakai sebagai bukti", () => {
  const rows = [
    A("a", "detik.com", "Kabar langka satu", [["unik_a", 6.5, 1], ["dpr", 3.0, 55]], 10),
    A("b", "cnnindonesia.com", "Kabar langka dua", [["unik_a", 6.5, 1], ["dpr", 3.0, 55]], 9),
  ];
  assert.equal(clusterArticles(rows).length, 0);
});
