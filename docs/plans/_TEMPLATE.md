# <Nomor> — <Judul rencana>

```
Status: plan-draft
Kelas: UI | pipeline | infra | docs
Dibuat: YYYY-MM-DD
Diperbarui: YYYY-MM-DD
Mockup: docs/mockups/<slug>.html | — (kelas pipeline/infra)
```

> Salin file ini menjadi `docs/plans/<slug>.md`, lalu daftarkan di
> `docs/PLAN-INDEX.md`. Hapus kutipan ini.

---

## 1. Masalah

Apa yang salah atau belum ada. Sertakan bukti: log, keluaran perintah, nomor
baris, potongan `edition.json`. Jangan menulis kesan tanpa angka.

## 2. Keputusan yang akan diambil

Satu paragraf. Apa yang berubah, untuk siapa, dan apa yang **tidak** berubah.
Sebut `DEC-xxxx` yang terkait.

## 3. Rencana

1. Langkah konkret dengan nama file.
2. Satu perubahan kebijakan per langkah; jangan gabungkan dua.
3. Sebut dokumen lain yang ikut berubah (`SCHEMA.md`, `REQUIREMENTS.md`, …).

## 4. Mockup / kontrak

Isi salah satu sesuai `Kelas`:

- **UI** — tautkan `docs/mockups/<slug>.html`. Sebut layar/keadaan yang
  dicakup mockup dan token CSS yang dipakai.
- **pipeline** — tempel potongan `edition.json` sebelum/sesudah dan baris log
  yang diharapkan.
- **infra** — tempel perintah dan keluaran yang diharapkan.
- **docs** — tulis "tidak ada artefak".

## 5. Tes

Daftar tes yang membuktikan rencana ini, dengan nama file dan perilaku yang
dikunci. Untuk perbaikan bug, sebutkan bukti bahwa tes **gagal sebelum** perbaikan.

## 6. Risiko dan rollback

Apa yang bisa rusak, dan bagaimana kembali. Ingat: edisi terbit immutable; uji
dengan `--newsroom-limit 2 --thin` pada tanggal baru atau POC.

## 7. Riwayat

Format: `YYYY-MM-DD — status — catatan`.

- `YYYY-MM-DD` — `plan-draft` — dibuat.

## 8. Pelajaran (diisi setelah `shipped`)

Apa yang ternyata salah dari rencana ini. Satu paragraf. Ini bahan untuk
`docs/learnings/YYYY-MM.md`.
