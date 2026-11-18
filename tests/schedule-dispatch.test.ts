/**
 * `DEC-0041`: jadwal harian dipicu dari luar GitHub.
 *
 * Cron GitHub di repo ini dikirim berjam-jam terlambat dan pada 2026-11-18
 * tidak dikirim sama sekali. `supabase/005_schedule.sql` menjadwalkan
 * `repository_dispatch` dari pg_cron. Tes ini mengunci dua hal yang mudah
 * rusak tanpa terlihat: jamnya harus UTC 22:45 (bukan 05:45 WIB), dan berkasnya
 * harus idempoten.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const raw = readFileSync(join(root, "supabase", "005_schedule.sql"), "utf8");

/** Buang komentar SQL: `--force` boleh disebut sebagai penjelasan, bukan dipakai. */
const sql = raw
  .split("\n")
  .filter((line) => !/^\s*--/.test(line))
  .join("\n");

test("jadwal pg_cron memakai 22:45 UTC, sama dengan cron GitHub", () => {
  const daily = readFileSync(join(root, ".github", "workflows", "daily.yml"), "utf8");
  assert.match(daily, /cron:\s*"45 22 \* \* \*"/, "jadwal utama daily.yml berubah");

  assert.match(
    sql,
    /cron\.schedule\(\s*'edisi-harian-dispatch',\s*'45 22 \* \* \*'/,
    "pg_cron harus memakai '45 22 * * *' (22:45 UTC = 05:45 WIB)",
  );
  // `cron.timezone` = GMT di Supabase. Menulis 45 5 berarti 05:45 UTC = 12:45 WIB.
  assert.doesNotMatch(sql, /cron\.schedule\([^)]*'45 5 \* \* \*'/, "jam WIB tidak boleh ditulis apa adanya");
});

test("dispatch memakai Vault dan tipe event build", () => {
  assert.match(sql, /event_type',\s*'build'/, "event_type harus build");
  assert.match(sql, /gh_dispatch_url/, "endpoint harus dari Vault");
  assert.match(sql, /gh_dispatch_token/, "token harus dari Vault");
  assert.doesNotMatch(sql, /--force/, "tidak ada --force; edition-guard yang memutuskan");
});

test("berkas idempoten: job lama dicabut sebelum dijadwalkan ulang", () => {
  const unschedule = sql.indexOf("cron.unschedule('edisi-harian-dispatch')");
  const schedule = sql.indexOf("cron.schedule(");
  assert.ok(unschedule !== -1, "harus mencabut job bernama sama");
  assert.ok(schedule !== -1 && unschedule < schedule, "unschedule harus sebelum schedule");
  assert.match(sql, /where jobname = 'edisi-harian-dispatch'/, "cabut hanya bila job-nya ada");
});

test("fungsi tidak dapat dipanggil anon/authenticated", () => {
  assert.match(sql, /revoke all on function public\.dispatch_build\(\) from anon, authenticated/);
});
