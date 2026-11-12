/**
 * `DEC-0027` — feed yang gagal karena gangguan sesaat diulang sekali.
 *
 * 2026-11-12: `tempo_nasional` gagal dengan `The operation was aborted due to
 * timeout`. Satu feed hilang mempersempit cakupan tanpa menghentikan build,
 * jadi tidak ada yang memperbaikinya.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isRetryableFeedError } from "../src/core/ingest.ts";

test("timeout dan gangguan jaringan layak diulang", () => {
  for (const msg of [
    "The operation was aborted due to timeout",
    "fetch failed",
    "ETIMEDOUT",
    "ECONNRESET",
    "socket hang up",
    "HTTP 503",
    "HTTP 502",
  ]) {
    assert.equal(isRetryableFeedError(msg), true, msg);
  }
});

test("4xx tidak diulang: kesalahan kita, bukan gangguan", () => {
  for (const msg of ["HTTP 404", "HTTP 403", "HTTP 400", "HTTP 410"]) {
    assert.equal(isRetryableFeedError(msg), false, msg);
  }
});
