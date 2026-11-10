import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/** Ambil og:image dari halaman artikel. */
export async function fetchOgImage(pageUrl: string, timeoutMs = 12_000): Promise<string | null> {
  try {
    const res = await fetch(pageUrl, {
      headers: { "user-agent": UA, accept: "text/html" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m =
      html.match(/property=["']og:image["']\s+content=["']([^"']+)/i) ??
      html.match(/content=["']([^"']+)["']\s+property=["']og:image/i) ??
      html.match(/name=["']twitter:image["']\s+content=["']([^"']+)/i);
    if (!m?.[1]) return null;
    return new URL(m[1], pageUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Unduh, kecilkan, dan simpan sebagai WebP. Nama berkas content-addressed,
 * jadi tidak pernah ditimpa dan aman di-cache selamanya (SCHEMA.md §9.1).
 */
export async function storeWebp(
  imageUrl: string,
  assetsDir: string,
  quality = 78,
): Promise<{ url: string; bytes: number } | null> {
  try {
    const res = await fetch(imageUrl, {
      headers: { "user-agent": UA, accept: "image/*" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 3000) return null;

    const out = await sharp(buf)
      .rotate()
      .resize({ width: 1200, withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();

    const hash = createHash("sha1").update(out).digest("hex").slice(0, 10);
    mkdirSync(assetsDir, { recursive: true });
    const file = join(assetsDir, `${hash}.webp`);
    if (!existsSync(file)) writeFileSync(file, out);

    return { url: `assets/${hash}.webp`, bytes: out.byteLength };
  } catch {
    return null;
  }
}

export async function imageFor(pageUrl: string, assetsDir: string): Promise<{ url: string; bytes: number } | null> {
  const og = await fetchOgImage(pageUrl);
  if (!og) return null;
  return storeWebp(og, assetsDir);
}
