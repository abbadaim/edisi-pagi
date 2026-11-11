#!/usr/bin/env node
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const root = join(new URL("..", import.meta.url).pathname, "public");
const port = Number(process.env.PORT ?? 8080);

/**
 * Produksi dilayani dari `/edisi-pagi/`. Tanpa `BASE_PATH`, `npm run serve`
 * melayani di akar sehingga bug path absolut lolos di lokal dan baru terlihat
 * setelah deploy. Default tetap `/` agar perilaku lama tidak berubah.
 */
function normalizeBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed === "") return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

const base = normalizeBase(process.env.BASE_PATH ?? "/");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const pathname = decodeURIComponent(url.pathname);

  // Di luar prefix produksi: 404. Tanpa ini, server uji bisa diam-diam melayani
  // aset di akar dan suite akan lulus meski path di aplikasi absolut.
  let relative = pathname;
  if (base) {
    if (pathname !== base && !pathname.startsWith(`${base}/`)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
      return;
    }
    relative = pathname.slice(base.length) || "/";
  }

  let path = normalize(join(root, relative));

  if (!path.startsWith(root)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
  if (!existsSync(path)) path = join(root, "index.html");

  res.writeHead(200, {
    "content-type": MIME[extname(path)] ?? "application/octet-stream",
    "cache-control": relative.startsWith("/data/") ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(path).pipe(res);
});

server.listen(port, () => {
  const address = server.address();
  const actual = typeof address === "object" && address ? address.port : port;
  console.log(`Edisi Pagi · http://localhost:${actual}${base}/`);
});
