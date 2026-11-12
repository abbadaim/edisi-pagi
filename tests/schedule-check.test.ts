/**
 * `DEC-0028` — jadwal yang hilang harus terdeteksi oleh mesin, bukan ingatan.
 *
 * 2026-11-12: trigger 05:45 WIB tidak dibuat sama sekali; manifest tetap
 * 2026-11-11 dan tidak ada yang tahu sampai edisi itu tidak ada.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { scheduleVerdict } from "../src/core/schedule-check.ts";

const TODAY = "2026-11-12";

test("edisi hari ini ada -> ok", () => {
  const v = scheduleVerdict({ latest: TODAY, latest_by_scope: { nasional: TODAY } }, TODAY);
  assert.equal(v.ok, true);
  assert.equal(v.latest, TODAY);
});

test("edisi hari ini hilang -> tidak ok, dan menyebut tanggal yang diharapkan", () => {
  const v = scheduleVerdict({ latest: "2026-11-11", latest_by_scope: { nasional: "2026-11-11" } }, TODAY);
  assert.equal(v.ok, false);
  assert.equal(v.latest, "2026-11-11");
  assert.equal(v.expected, TODAY);
  assert.match(v.reason, /belum terbit/);
});

test("latest_by_scope menang atas latest", () => {
  const v = scheduleVerdict({ latest: "2026-11-11", latest_by_scope: { nasional: TODAY } }, TODAY);
  assert.equal(v.ok, true);
});

test("manifest kosong -> tidak ok dengan alasan jelas", () => {
  const v = scheduleVerdict({}, TODAY);
  assert.equal(v.ok, false);
  assert.equal(v.latest, null);
  assert.match(v.reason, /tidak memuat/);
});

test("manifest lebih baru dari perkiraan bukan kegagalan", () => {
  const v = scheduleVerdict({ latest_by_scope: { nasional: "2026-11-13" } }, TODAY);
  assert.equal(v.ok, true);
  assert.match(v.reason, /lebih baru/);
});

test("latest_by_scope null tidak melempar", () => {
  const v = scheduleVerdict({ latest: null, latest_by_scope: null }, TODAY);
  assert.equal(v.ok, false);
  assert.equal(v.latest, null);
});
