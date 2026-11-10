export interface WikiSummary {
  title: string;
  extract: string;
  url: string;
}

/**
 * Ringkasan Wikipedia bahasa Indonesia. Dipakai sebagai bahan konteks yang
 * bisa dikutip: model hanya boleh memilih dari kandidat, tidak mengarang.
 */
export async function fetchWikiSummary(
  query: string,
  lang = "id",
  timeoutMs = 8_000,
): Promise<WikiSummary | null> {
  const title = query.trim().replace(/\s+/g, "_");
  if (!title) return null;

  try {
    const res = await fetch(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`,
      {
        headers: { "user-agent": "EdisiPagi/0.1 (+personal news aggregator)" },
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as {
      title?: string;
      extract?: string;
      content_urls?: { desktop?: { page?: string } };
      type?: string;
    };
    if (j.type === "disambiguation" || !j.extract || j.extract.length < 60) return null;
    return {
      title: j.title ?? query,
      extract: j.extract,
      url: j.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${title}`,
    };
  } catch {
    return null;
  }
}
