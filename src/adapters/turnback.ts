const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h1|h2|h3|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * TurnBackHoax selalu menyatakan temuannya setelah "Faktanya," dan menutup
 * dengan "Jadi, ... merupakan konten ...". Lead artikel justru berisi
 * deskripsi unggahan — bukan alasannya.
 */
export function extractVerdict(text: string): string | null {
  const faktanya = text.match(/Faktanya[,\s]+(.{40,400}?)(?:\.\s|$)/i);
  if (faktanya) {
    const s = faktanya[1]!.trim();
    if (s.length >= 40) return sentenceCase(s.endsWith(".") ? s : `${s}.`);
  }

  const jadi = text.match(/Jadi[,\s]+(.{30,300}?)(?:\.\s|$)/i);
  if (jadi) {
    const s = jadi[1]!.trim();
    if (s.length >= 30) return sentenceCase(s.endsWith(".") ? s : `${s}.`);
  }

  return null;
}

export async function fetchVerdict(url: string, timeoutMs = 12_000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!res.ok) return null;
    return extractVerdict(toText(await res.text()));
  } catch {
    return null;
  }
}
