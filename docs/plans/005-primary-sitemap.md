# 005 — Sitemap untuk sumber primer (P4b)

```
Status: tested (2026-11-11)
Kelas: pipeline
Dibuat: 2026-11-11
Diperbarui: 2026-11-11
Mockup: — (kelas pipeline; artefak = kontrak §4)
```

---

## 1. Masalah

P4a hanya menemukan sumber primer lewat tiga jalur: artikel resmi di klaster,
artikel resmi di database, dan halaman listing. Listing sering tidak berguna:

| Sumber | Listing | Sitemap (diuji 11 Nov 2026) |
|---|---|---|
| KPK | JS/berat | **200**, `urlset` 245 KB, ada `lastmod` |
| ESDM | JS | **200**, `urlset` 63 KB |
| DPR | JS-rendered | 403 |
| Mahkamah Agung | JS | 403 |
| Kemenkeu | JS | gagal |
| Sleman | JS | 403 |
| BPS | JS | `/id/sitemap.xml` 404; API tetap jalur utama |

Akibatnya topik KPK/ESDM sering tidak mendapat sumber primer meski
halamannya ada dan dapat diambil.

## 2. Keputusan

Tambahkan jalur **sitemap** yang deterministik: satu fetch sitemap per sumber
yang cocok, saring URL berdasarkan domain + kemiripan slug dengan topik,
ambil maksimal dua artikel. Tidak ada crawl bebas; hanya URL yang ada di
sitemap resmi.

## 3. Rencana

1. `PrimarySourceConfig.sitemap?: string`; isi hanya untuk KPK dan ESDM yang
   sudah diverifikasi 200.
2. `primary.ts`:
   - `parseSitemap(xml)` → `{ urls, sitemaps }` (mendukung `urlset` dan
     `sitemapindex` satu tingkat).
   - `rankSitemapUrls(urls, topic, domains, max)` → skor token slug + `lastmod`.
   - `findPrimarySources`: setelah API, sebelum listing; batas 1 sitemap +
     2 artikel per topik; fetch artikel lewat `get()` yang sama; cache
     `article_text` bila tersedia.
3. `config/primary-sources.yaml`: `sitemap` hanya untuk `kpk`. ESDM tidak
   dipakai karena sitemap-nya berisi profil/PDF 2017, bukan berita.
4. Tes `tests/primary-sitemap.test.ts`: parse urlset/index, filter domain,
   ranking, integrasi `findPrimarySources` dengan fetch palsu.
5. Verifikasi nyata (read-only) sudah dilakukan; tidak ada fetch jaringan di tes.

## 4. Kontrak

| Hal | Nilai |
|---|---|
| Fetch sitemap | maks 1 per sumber cocok, timeout 10 dtk |
| Fetch artikel | maks 2 per topik, timeout 10 dtk |
| Domain | wajib sama dengan `domains` sumber |
| Skor | token slug (`-` → spasi) ∩ judul/angle/entitas; `lastmod` sebagai pemecah seri |
| Tanggal | artikel hanya diterima bila tanggal terbit (meta atau teks "10 November 2026") berada di jendela topik; `lastmod` sitemap tidak dipercaya |
| Teks | diekstrak dari HTML (`extractArticleText`), minimal 40 karakter; disimpan ke `article_text` bila cache diberikan |
| Gagal | sitemap/artikel gagal → lanjut ke listing/link lama, tanpa error |
| Log | `primer: N (outlet)` dari `card.ts`; tidak ada log baru wajib |

Rollback: hapus `sitemap:` dari YAML; jalur tidak aktif, kode tetap.

## 5. Tes

1. `parseSitemap` membaca `<url><loc>` dan `<lastmod>`; `sitemapindex`
   mengembalikan child sitemap.
2. `rankSitemapUrls` membuang domain lain, homepage, dan URL tanpa token
   relevan; mengutamakan `lastmod` terbaru.
3. `findPrimarySources` dengan fetch palsu: sitemap → 2 kandidat artikel,
   bukan listing.
4. Sitemap 403/kosong → hasil kosong, tidak melempar.
5. `npm test` dan `npm run typecheck` bersih.

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| Sitemap besar (245 KB) | parse regex, hanya 1 fetch, ambil 2 URL |
| Sitemap usang | `lastmod` + skor topik; batas waktu tidak ketat |
| Sumber memblokir | gagal senyap, lanjut jalur lama |
| Crawl melebar | hanya URL di sitemap resmi + domain config |

## Riwayat

- `2026-11-11` — `plan-draft` — dibuat setelah probe sitemap nyata.
- `2026-11-11` — `plan-approved` / `mockup-approved` — pemilik meminta
  “do 1 and 2” (P4b + meta lokal) pada sesi yang sama.
- `2026-11-11` — `tested` — 7 uji sitemap + tanggal; 230 uji total. Probe nyata:
  sitemap KPK 1.108 URL, artikel 2021 ditolak oleh gerbang tanggal; ESDM
  dinonaktifkan karena bukan sitemap berita.
