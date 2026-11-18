/**
 * `DEC-0040`: job `verdict` harus membaca pohon yang baru ditulis `build`.
 *
 * `actions/checkout` tanpa `ref:` memakai `github.sha`. Pada
 * `workflow_dispatch` dan `repository_dispatch` itu commit saat dispatch, bukan
 * commit bot yang dibuat sesudahnya. Verdict lalu menilai pohon sebelum build
 * dan melaporkan `no-edition` walau edisinya terbit — run 44227970274
 * (2026-11-18) merah padahal edisi 7 kartu sudah dideploy.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const yaml = readFileSync(join(root, ".github", "workflows", "daily.yml"), "utf8");

/** Potongan YAML satu job, dari `  nama:` sampai job berikutnya. */
function job(name: string): string {
  const start = yaml.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `job ${name} tidak ada di daily.yml`);
  const rest = yaml.slice(start + 1);
  const end = rest.search(/\n {2}[a-zA-Z_-]+:\n/);
  return end === -1 ? rest : rest.slice(0, end);
}

/** Buang baris komentar: `github.sha` boleh disebut sebagai penjelasan, bukan dipakai. */
function withoutComments(block: string): string {
  return block
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

test("verdict memeriksa branch hasil build, bukan commit saat dispatch", () => {
  const block = job("verdict");
  assert.match(block, /uses: actions\/checkout@v4/, "verdict tidak checkout repo");
  assert.match(
    block,
    /ref:\s*\$\{\{\s*github\.ref_name\s*\}\}/,
    "verdict harus checkout `ref: github.ref_name` (DEC-0040)",
  );
  assert.doesNotMatch(
    withoutComments(block),
    /github\.sha/,
    "github.sha menunjuk commit sebelum build",
  );
});

test("job yang hanya butuh build tidak bergantung pada commit saat dispatch", () => {
  // deploy bekerja dari artefak, jadi tidak membaca repo; verdict satu-satunya
  // job yang membaca hasil build dari git.
  assert.match(job("deploy"), /download-artifact|deploy-pages/);
  assert.match(job("build"), /git push/);
});
