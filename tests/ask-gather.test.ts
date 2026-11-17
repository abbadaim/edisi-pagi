/**
 * Fase 5 rencana 022: sumber di luar korpus.
 *
 * Yang dikunci di sini: URL datang dari model, jadi harus publik; dan kutipan
 * harus ada di halaman yang benar-benar diambil, bukan di cuplikan pencarian.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gatherWebSources, isPublicHttpUrl, type UrlFetcher } from "../src/core/ask/gather.ts";
import { splitCitations, writeAnswer } from "../src/core/ask/answer.ts";
import { parseAskConfig } from "../src/core/ask/config.ts";
import type { AskMaterial } from "../src/core/ask/retrieve.ts";

const root = new URL("..", import.meta.url).pathname;
const cfg = parseAskConfig(readFileSync(join(root, "config", "tanya.json"), "utf8"));

const halaman = (isi: string) => `${isi} ${"Kalimat pengisi halaman agar melewati ambang dua ratus karakter. ".repeat(4)}`;

test("URL privat dan skema asing ditolak", () => {
  assert.equal(isPublicHttpUrl("https://www.antaranews.com/berita/123"), true);
  assert.equal(isPublicHttpUrl("http://slemankab.go.id/"), true);
  for (const bad of [
    "http://localhost/",
    "http://127.0.0.1:8080/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://metadata.google.internal/",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "http://[::1]/",
    "http://intranet/",
  ]) {
    assert.equal(isPublicHttpUrl(bad), false, `${bad} seharusnya ditolak`);
  }
});

test("kutipan diverifikasi terhadap halaman, bukan cuplikan", async () => {
  const fetchUrl: UrlFetcher = async () => ({
    ok: true,
    text: halaman("Penerima Bantuan Iuran yang dibiayai APBN dinonaktifkan mulai 1 November 2026."),
  });
  const r = await gatherWebSources(
    [{ url: "https://contoh.id/a", kutipan: "dibiayai APBN dinonaktifkan mulai 1 November 2026" }],
    fetchUrl,
    3,
  );
  assert.equal(r.sources.length, 1);
  assert.equal(r.sources[0]?.tier, "luar");
  assert.equal(r.texts.length, 1);
});

test("kutipan yang tidak ada di halaman dibuang", async () => {
  const fetchUrl: UrlFetcher = async () => ({ ok: true, text: halaman("Isi halaman yang sama sekali berbeda.") });
  const r = await gatherWebSources(
    [{ url: "https://contoh.id/a", kutipan: "dinonaktifkan mulai 1 Desember 2026 oleh menteri" }],
    fetchUrl,
    3,
  );
  assert.equal(r.sources.length, 0);
  assert.match(String(r.unsupported[0]), /tidak ditemukan di halaman/);
});

test("halaman yang gagal diambil tidak menjadi sumber", async () => {
  const r = await gatherWebSources([{ url: "https://contoh.id/a", kutipan: "apa saja yang panjang" }], async () => ({
    ok: false,
    text: "",
  }), 3);
  assert.equal(r.sources.length, 0);
  assert.match(String(r.unsupported[0]), /tidak bisa diambil/);
});

test("batas pengambilan dihormati dan URL ganda tidak diambil dua kali", async () => {
  let calls = 0;
  const fetchUrl: UrlFetcher = async () => {
    calls += 1;
    return { ok: true, text: halaman("Penerima Bantuan Iuran yang dibiayai APBN dinonaktifkan mulai 1 November 2026.") };
  };
  const kutipan = "dibiayai APBN dinonaktifkan mulai 1 November 2026";
  const r = await gatherWebSources(
    [
      { url: "https://a.id/x", kutipan },
      { url: "https://a.id/x", kutipan },
      { url: "https://b.id/x", kutipan },
      { url: "https://c.id/x", kutipan },
    ],
    fetchUrl,
    2,
  );
  assert.equal(calls, 2, "hanya dua pengambilan");
  assert.equal(r.sources.length, 2);
  assert.ok(r.unsupported.some((u) => /batas 2 pengambilan/.test(u)));
});

test("sitasi dipisah: id bahan, url bahan, dan url luar", () => {
  const materials: AskMaterial[] = [
    {
      id: "s1",
      url: "https://arsip.id/a",
      outlet: "arsip.id",
      title: "t",
      published_at: null,
      text: "isi",
      chars: 3,
      tier: "teks",
    },
  ];
  const out = splitCitations(
    [
      { id: "s1", kutipan: "dari arsip" },
      { url: "https://arsip.id/a", kutipan: "juga arsip" },
      { url: "https://luar.id/b", kutipan: "dari web" },
      { url: "kata-saja", kutipan: "bukan apa-apa" },
      { id: "s9", kutipan: "bahan tak dikenal" },
    ],
    materials,
  );
  assert.equal(out.corpus.length, 2);
  assert.equal(out.web.length, 1);
  assert.equal(out.web[0]?.url, "https://luar.id/b");
});

test("jawaban boleh bersumber halaman luar saat korpus kosong", async () => {
  const llm = {
    name: "opencode" as const,
    json: async () => ({ data: {} as never, usage: { tokens_in: 0, tokens_out: 0 } }),
    text: async () => ({
      text: JSON.stringify({
        jawaban: "Penerima Bantuan Iuran dinonaktifkan mulai 1 November 2026 menurut pemberitaan daerah.",
        sitasi: [
          {
            url: "https://luar.id/b",
            kutipan: "Penerima Bantuan Iuran yang dibiayai APBN dinonaktifkan mulai 1 November 2026",
          },
        ],
      }),
      usage: { tokens_in: 100, tokens_out: 40 },
    }),
  };
  // Lantai `config/tanya.json` sengaja mematikan sumber luar; setelan di
  // Supabase yang menyalakannya. Uji ini menyalakan lewat konfigurasi.
  const nyala = { ...cfg, cari: { ...cfg.cari, enabled: true, izin_luar_bahan: true } };
  const r = await writeAnswer(llm, "uji", "kenapa PBI nonaktif?", [], nyala, {
    fetchUrl: async () => ({
      ok: true,
      text: halaman("Penerima Bantuan Iuran yang dibiayai APBN dinonaktifkan mulai 1 November 2026."),
    }),
  });
  assert.equal(r.state, "answered");
  assert.equal(r.sources[0]?.tier, "luar");
});

test("tanpa izin web, sitasi luar tidak dipakai", async () => {
  const llm = {
    name: "opencode" as const,
    json: async () => ({ data: {} as never, usage: { tokens_in: 0, tokens_out: 0 } }),
    text: async () => ({
      text: JSON.stringify({
        jawaban: "Penerima Bantuan Iuran dinonaktifkan mulai 1 November 2026 menurut pemberitaan daerah.",
        sitasi: [{ url: "https://luar.id/b", kutipan: "Penerima Bantuan Iuran yang dibiayai APBN dinonaktifkan" }],
      }),
      usage: { tokens_in: 1, tokens_out: 1 },
    }),
  };
  const mati = { ...cfg, cari: { ...cfg.cari, enabled: false } };
  const r = await writeAnswer(llm, "uji", "kenapa PBI nonaktif?", [], mati, {
    fetchUrl: async () => ({ ok: true, text: halaman("apa pun") }),
  });
  assert.equal(r.state, "refused");
});
