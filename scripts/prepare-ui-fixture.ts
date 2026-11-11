#!/usr/bin/env node
/**
 * Menyusun `fixtures/ui/public/` dari `public/` + fixture data.
 *
 * Tujuan: suite UI memakai aplikasi sungguhan (`index.html`, `app.js`,
 * `style.css`, `sw.js`) dengan data yang stabil dan bisa diprediksi — bukan
 * edisi hasil build, bukan jaringan.
 *
 * Direktori hasil di-.gitignore; skrip ini menulis ulang setiap kali.
 */
import { cpSync, copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

const projectRoot = new URL("..", import.meta.url).pathname;
const source = join(projectRoot, "public");
const fixture = join(projectRoot, "fixtures", "ui");
const out = join(fixture, "public");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Salin aset statis. `data/` dan `manifest.json` diganti versi fixture:
// kalau tidak, suite akan menguji edisi terbit hari itu, yang berubah tiap pagi.
cpSync(source, out, {
  recursive: true,
  filter: (from) => {
    const path = relative(source, from);
    if (path === "") return true;
    if (path === "data" || path.startsWith(`data${process.platform === "win32" ? "\\" : "/"}`)) return false;
    if (path === "manifest.json") return false;
    return true;
  },
});

copyFileSync(join(fixture, "manifest.json"), join(out, "manifest.json"));

const editions = join(out, "data", "editions");
mkdirSync(editions, { recursive: true });
for (const file of readdirSync(join(fixture, "editions"))) {
  copyFileSync(join(fixture, "editions", file), join(editions, file));
}

console.log(`fixture UI siap: ${relative(projectRoot, out)}`);
