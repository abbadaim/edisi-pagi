#!/usr/bin/env node
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const root = join(new URL("..", import.meta.url).pathname, "public");
const port = Number(process.env.PORT ?? 8080);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  let path = normalize(join(root, decodeURIComponent(url.pathname)));

  if (!path.startsWith(root)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
  if (!existsSync(path)) path = join(root, "index.html");

  res.writeHead(200, {
    "content-type": MIME[extname(path)] ?? "application/octet-stream",
    "cache-control": url.pathname.startsWith("/data/") ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(path).pipe(res);
}).listen(port, () => console.log(`Edisi Pagi · http://localhost:${port}`));
