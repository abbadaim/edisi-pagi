# WORKFLOW.md — alur kerja perubahan

**Status:** berlaku sejak 2026-11-11 · **DEC-0011**

Setiap perbaikan, penambahan, atau fitur melewati alur yang sama. Tujuannya
bukan menambah upacara, melainkan memastikan tiga hal: ada rencana yang bisa
dibaca, ada mockup yang bisa disetujui, dan ada tes yang membuktikan hasilnya.
Untuk perubahan sepele, alur ini disederhanakan (lihat §2).

---

## 1. Alur enam langkah

```
rencana → persetujuan rencana → mockup/kontrak → persetujuan mockup
        → implementasi → tes → verifikasi deploy → commit & push
                                               ↘ catat learnings + skill
```

| # | Langkah | Artefak | Gerbang |
|---|---|---|---|
| 1 | Rencana | `docs/plans/<slug>.md`, `Status: plan-draft` | — |
| 2 | Setujui rencana | header → `plan-approved` | **manusia** |
| 3 | Mockup / kontrak | `docs/mockups/<slug>.html` atau §Kontrak di rencana | — |
| 4 | Setujui mockup | header → `mockup-approved (tanggal)` | **manusia** |
| 5 | Implementasi | kode + tes | mockup tidak boleh menyimpang |
| 6 | Tes | `npm test`, `npm run typecheck`, `npm run test:ui` bila relevan | lulus |
| 7 | Verifikasi | manifest + URL edisi live | `latest_by_scope` cocok |
| 8 | Commit & push | commit yang menyebut slug rencana | rebase dulu |
| 9 | Refleksi | `docs/learnings/YYYY-MM.md`, `AGENTS.md`/skill bila perlu | — |

**Tidak ada implementasi sebelum langkah 4 disetujui.** Rencana berstatus
`plan-draft` atau `mockup-v1` tidak boleh menghasilkan kode.

---

## 2. Kelas perubahan — jangan paksakan mockup pada semua hal

Sebagian besar pekerjaan di repo ini adalah pipeline, bukan UI. Memaksa mockup
pada perubahan kebijakan akan menghasilkan mockup palsu, dan alur yang dipalsukan
akan segera ditinggalkan. Karena itu gerbangnya berbeda per kelas.

| Kelas | Contoh | Artefak wajib | Tes wajib |
|---|---|---|---|
| **UI** | PWA shell, kartu, nav, push, halaman Atur | **mockup HTML** dengan token CSS yang sama | unit + `test:ui` |
| **Pipeline/policy** | planner, dedupe, kuota, kartu meta, gerbang | **kontrak**: potongan `edition.json` sebelum/sesudah + baris log yang diharapkan | unit yang mengunci perilaku |
| **Infra/CI** | workflow, publish, cache state | kontrak: perintah + keluaran yang diharapkan | tes + satu run CI nyata |
| **Dokumen/salah ketik** | README, komentar | tidak ada | `npm run typecheck` bila menyentuh kode |

Kelas ditulis di header rencana: `Kelas: UI | pipeline | infra | docs`.

---

## 3. Status — satu mesin keadaan, append-only

```
plan-draft
  → plan-approved
    → mockup-v1 → mockup-approved (YYYY-MM-DD)
      → implementing
        → tested
          → shipped (YYYY-MM-DD)
          → superseded-by: docs/plans/<slug>.md
```

Aturan:

1. Status hanya ada di **header** rencana, satu baris, dengan tanggal.
2. Mengubah status = **menambah** baris riwayat, bukan menimpa yang lama.
3. Isi rencana **append-only**. Rencana yang berubah arah tidak dihapus; tambahkan
   §Revisi dan jelaskan sebabnya.
4. **Agen tidak boleh menyetujui.** Hanya manusia yang boleh menulis
   `plan-approved` atau `mockup-approved`. Agen boleh mengusulkan dan menjalankan.
5. Rencana `shipped` tetap tinggal sebagai catatan; ia menjadi konteks untuk
   rencana berikutnya.

---

## 4. Mockup

- Satu file HTML statis per rencana: `docs/mockups/<slug>.html`.
- **Wajib memakai token yang sama** dengan `public/style.css` (`--paper`, `--ink`,
  `--accent`, `--rule`, `--serif`, `--sans`). Mockup yang memakai palet lain tidak
  bisa disetujui karena hasil implementasinya akan berbeda.
- Precedent: `mockup/index.html` (mockup v2, bingkai ponsel 380px). Salin polanya.
- Setelah disetujui, mockup **tidak diedit**. Perubahan desain = `v2` + persetujuan
  baru.
- Selama implementasi, mockup adalah acuan. Menyimpang tanpa persetujuan = temuan
  review, bukan kreativitas.
- Mockup bukan kode produksi: jangan disalin mentah ke `public/`. Implementasi
  menyesuaikan struktur `app.js`/`style.css` yang ada.

---

## 5. Tes

| Perintah | Cakupan | Wajib untuk |
|---|---|---|
| `npm test` | `node --test`, tanpa jaringan | semua perubahan kode |
| `npm run typecheck` | `tsc --noEmit` | semua perubahan kode |
| `npm run test:ui` | Playwright atas edisi fixture | kelas UI |
| `npm run validate -- <file>` | skema `edition.json` | perubahan pipeline yang mengubah keluaran |

Aturan:

1. **Satu kebijakan = satu tes** (sudah berlaku). Tes menyebut `DEC-xxxx` yang
   diaturnya di komentar.
2. Perbaikan bug: tes harus **gagal sebelum** perbaikan dan lulus sesudahnya.
3. Setiap rencana mencantumkan §Tes: daftar tes yang membuktikan rencana itu.
   Rencana `shipped` tanpa tes = belum selesai.
4. Tes tidak boleh memakai tanggal edisi yang sudah terbit, dan tidak boleh
   memanggil jaringan.

---

## 6. Jalur darurat

Kegagalan produksi (CI mati menjelang 05:45 WIB, situs tidak deploy) tidak
menunggu mockup.

1. Perbaiki, jalankan tes, verifikasi, push.
2. **Dalam 24 jam**, tulis rencana retroaktif dengan `Kelas: darurat`, isi
   penyebab dan perbaikannya.
3. Jalur ini tidak boleh dipakai untuk fitur. Hanya untuk memulihkan layanan.

Tanpa jalur ini, alur akan dilanggar pada insiden pertama dan kehilangan wibawa.

---

## 7. Akhir sesi — ke mana catatan pergi

Tiga tempat, tiga fungsi berbeda. Jangan menulis fakta yang sama di ketiganya.

| Tempat | Isi | Contoh |
|---|---|---|
| `docs/learnings/YYYY-MM.md` | **apa yang terjadi**, dengan bukti dan angka | “run kedua state kosong: `state:info` = 0 artikel” |
| `AGENTS.md` §4–§6 | **wajib / dilarang** — aturan yang mengikat | “jangan pakai `opencode.ai/install`, itu v1” |
| `.opencode/skills/edisi-pagi/SKILL.md` | **prosedur** — cara agen bertindak | “sebelum menguji `app.js` baru, hapus cache SW” |
| `docs/DECISIONS.md` | keputusan yang dikunci, bernomor | `DEC-0007` |

Satu pelajaran boleh muncul di lebih dari satu tempat hanya bila ia benar-benar
mengubah perilaku di tempat itu. Duplikasi diam-diam akan menyimpang.

---

## 8. Bahasa

Prosa dokumentasi: **Indonesia**. Identifier, nama file, kode, dan nama perintah:
**Inggris**. Jangan menerjemahkan istilah yang sudah dipakai kode (`planner`,
`depth`, `notes_resolved`).

---

## 9. Satu sumber kebenaran

- `docs/PLAN-INDEX.md` adalah satu-satunya pintu masuk daftar rencana.
- `AGENTS.md` **menautkan**, tidak menyalin isi rencana.
- `REQUIREMENTS.md`/`SCHEMA.md` **diamendemen**, tidak diduplikasi di rencana baru.
  Rencana yang mengubah kontrak wajib menyebut dokumen mana yang ikut berubah.
