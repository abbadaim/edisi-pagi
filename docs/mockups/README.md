# docs/mockups — mockup yang menunggu atau sudah disetujui

Satu file HTML statis per rencana UI, bernama sama dengan rencana di
`docs/plans/`. Rencana `001-ui-test-harness` → `docs/mockups/001-ui-test-harness.html`.

## Aturan

1. **Token CSS wajib sama** dengan `public/style.css`:
   `--paper`, `--ink`, `--muted`, `--faint`, `--rule`, `--accent`,
   `--accent-soft`, `--ok`, `--warn`, `--bad`, `--serif`, `--sans`.
   Mockup berpalet lain tidak bisa disetujui.
2. Precedent: `mockup/index.html` (mockup v2, bingkai ponsel 380×820). Salin
   polanya — beberapa layar berdampingan, tiap layar punya caption.
3. **Setelah `mockup-approved`, file tidak diedit.** Perubahan desain =
   `v2`: simpan sebagai `<slug>-v2.html`, minta persetujuan baru, lalu catat di
   §Riwayat rencana.
4. Mockup adalah acuan implementasi, bukan kode produksi. Jangan disalin mentah
   ke `public/`; sesuaikan dengan struktur `app.js` dan `style.css` yang ada.
5. Mockup yang sudah `shipped` tetap disimpan. Ia bukti apa yang disetujui, dan
   dipakai saat menduga "apakah ini regresi atau perubahan yang diminta".
6. Mockup tidak boleh memuat data nyata pembaca, token, atau kredensial. Pakai
   isi contoh.

## Melihat mockup

```bash
npm run serve          # :8080, lalu buka /docs/mockups/<slug>.html
# atau langsung:
open mockup/index.html
```
