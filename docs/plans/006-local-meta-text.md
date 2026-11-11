# 006 — Teks penuh untuk kartu meta lokal

```
Status: tested (2026-11-11)
Kelas: pipeline
Dibuat: 2026-11-11
Diperbarui: 2026-11-11
Mockup: — (kelas pipeline; artefak = kontrak §4)
```

---

## 1. Masalah

`misread` jarang muncul di edisi Sleman. Deteksinya memerlukan teks penuh
(`article_text`, ≥500 karakter), tetapi cache itu hanya terisi untuk artikel
yang di-fetch newsroom. Brief lokal sering:

- ditulis oleh fallback saat newsroom gagal, atau
- memakai satu sumber yang tidak pernah di-fetch karena bukan bahan utama.

Log produksi menunjukkan `meta lokal: … teks 4/5 · celah 0` — teks ada untuk
sebagian sumber, tetapi tidak cukup untuk menemukan judul–isi yang berbeda.
Akibatnya lapisan “Salah dipahami” praktis hanya muncul di edisi nasional.

## 2. Keputusan

Khusus scope **lokal**, `buildMetaCards` boleh mengambil teks penuh untuk
sebagian kecil sumber yang belum ada di cache. Nasional tidak pernah fetch
tambahan. Batasnya ketat: maksimal 3 fetch per edisi, satu per kartu, timeout
12 detik, hasil disimpan ke `article_text` (TTL 14 hari).

## 3. Rencana

1. `MetaInput` bertambah: `scope`, `fetchArticle?`, `maxFetches?`.
2. `articleFor` menerima opsi `fetchMissing`; bila cache kosong dan izin ada,
   panggil `fetchArticleText(url)` lalu `cache.set(url, text)`.
3. `buildMetaCards`:
   - Coba sumber yang sudah punya teks lebih dulu (perilaku sekarang).
   - Bila satu kartu tidak punya teks sama sekali dan budget tersisa, fetch
     **sumber pertama** kartu itu, lalu evaluasi.
   - `maxFetches` default 3 untuk lokal, 0 untuk nasional.
   - Hormati `META_LOCAL_FETCH=0` sebagai rollback.
4. Log: `meta lokal: … teks a/b · fetch f · celah c`.
5. Tes `tests/meta-local.test.ts` dengan fetch palsu:
   - teks penuh mengandung kualifikasi → `misread` dihasilkan;
   - budget 1 tidak melakukan fetch kedua;
   - scope nasional tidak memanggil fetch;
   - fetch gagal → tidak ada kartu, tidak melempar.

## 4. Kontrak

| Hal | Nilai |
|---|---|
| Scope yang boleh fetch | hanya `lokal` |
| Budget | maks 3 fetch/edisi, 1 per kartu |
| Timeout | 12 dtk (`fetchArticleText`) |
| Cache | `article_text`, extractor `newsroom-extract-v1`, TTL 14 hari |
| Syarat teks | ≥500 karakter sebelum deteksi |
| Gagal | kartu dilewati; build lanjut |
| Rollback | `META_LOCAL_FETCH=0` |
| Log | `teks a/b · fetch f · celah c` |

Tidak ada perubahan skema edition, tidak ada perubahan kartu nasional.

## 5. Tes

1. Fetch palsu mengembalikan teks dengan “usulan” dan judul tanpa kualifikasi
   → `misread` lokal dihasilkan.
2. Budget 1: kartu kedua tidak memicu fetch.
3. `scope=national` + cache kosong → `fetchArticle` tidak dipanggil.
4. Fetch melempar/`ok:false` → hasil kosong, tidak ada exception.
5. `npm test`, `npm run typecheck`; build lokal terbatas pada tanggal baru.

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| Build lokal tambah lambat | maks 3 fetch × 12 dtk; hanya bila cache kosong |
| Sumber memblokir | gagal senyap, lanjut |
| False positive | syarat teks ≥500, subjek harus berbagi kata dengan judul, judul berkualifikasi ditolak |
| Nasional ikut lambat | fetch hanya untuk scope lokal |

Rollback: `META_LOCAL_FETCH=0`; tanpa fetch, perilaku kembali seperti sekarang.

## Riwayat

- `2026-11-11` — `plan-draft` — dibuat dari log `meta lokal … celah 0`.
- `2026-11-11` — `plan-approved` / `mockup-approved` — pemilik meminta
  “do 1 and 2” (P4b + meta lokal) pada sesi yang sama.
- `2026-11-11` — `tested` — 5 uji (`tests/meta-local.test.ts`); 230 uji total.
  Probe nyata pada edisi lokal 11-11: `teks 3/5 · fetch 3 · celah 0` — mekanisme
  fetch bekerja, tetapi headline lokal hari itu tidak memuat kualifikasi yang
  hilang. Cakupan kartu bergantung pada data, bukan pada jalur fetch.
