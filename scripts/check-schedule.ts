#!/usr/bin/env node
/**
 * Periksa apakah edisi hari ini (WIB) benar-benar terbit.
 *
 * Exit 0  = ada
 * Exit 10 = tidak ada (workflow akan menjalankan daily.yml)
 * Exit 2  = tidak bisa memeriksa (manifest tidak terbaca) — jangan dispatch,
 *           karena kita tidak tahu keadaannya.
 */
import { scheduleVerdict, type ManifestLike } from "../src/core/schedule-check.ts";

const WIB_OFFSET_MS = 7 * 3_600_000;
const url = process.env.MANIFEST_URL ?? "https://abbadaim.github.io/edisi-pagi/manifest.json";
const todayWib = new Date(Date.now() + WIB_OFFSET_MS).toISOString().slice(0, 10);

let manifest: ManifestLike;
try {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  manifest = (await res.json()) as ManifestLike;
} catch (e) {
  const why = e instanceof Error ? e.message : String(e);
  console.error(`tidak bisa membaca manifest (${why}) — ${url}`);
  process.exit(2);
}

const verdict = scheduleVerdict(manifest, todayWib);
console.log(
  `jadwal: hari ini ${verdict.expected} · manifest ${verdict.latest ?? "kosong"} · ${verdict.reason}`,
);

if (verdict.ok) process.exit(0);
console.error("edisi hari ini TIDAK terbit — trigger terjadwal mungkin dibuang GitHub");
process.exit(10);
