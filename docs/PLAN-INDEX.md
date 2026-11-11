# PLAN-INDEX.md — daftar rencana berjalan

**Pintu masuk tunggal.** Setiap perubahan yang punya rencana terdaftar di sini.
Alur dan gerbangnya ada di `docs/WORKFLOW.md`.

Status yang mungkin: `plan-draft`, `plan-approved`, `mockup-v1`,
`mockup-approved`, `implementing`, `tested`, `shipped`, `superseded`.

---

## Berjalan

| # | Rencana | Kelas | Status | Diperbarui |
|---|---|---|---|---|
| 001 | [Harness tes UI](plans/001-ui-test-harness.md) | infra | `implementing` — commit 1 selesai, Playwright belum | 2026-11-11 |

`001` commit 1 sudah masuk: `scripts/serve.ts` (`BASE_PATH`, `PORT=0`) dan
`tests/ui-static.test.ts` (UI-01, UI-02, SRV-01, SRV-02, PUSH-01). `npm test`
= 195 lulus. Commit 2 (Playwright + `ui.yml`) belum dikerjakan.

---

## Selesai

| # | Rencana | Kelas | Status | Selesai |
|---|---|---|---|---|
| — | _(belum ada; rencana pertama yang `shipped` masuk ke sini)_ | | | |

---

## Gerbang singkat

| Kelas | Sebelum kode | Tes |
|---|---|---|
| UI | mockup HTML + persetujuan manusia | unit + `test:ui` |
| pipeline | kontrak (potongan JSON/log) | unit |
| infra | kontrak (perintah + keluaran) | tes + run CI |
| docs | — | `typecheck` bila menyentuh kode |

**Tidak ada implementasi sebelum `mockup-approved`.** Hanya manusia yang boleh
menyetujui; agen mengusulkan dan menjalankan.

---

## Tertunda / ide

- `gap` dan `debate` card — butuh amplifikasi (Reddit, komentar, Trends, TikTok).
  Lihat `AGENTS.md` §4.7.
- `P4b` sumber primer: sitemap, PDF, atau API resmi. Lihat `AGENTS.md` §5.

Ide di sini belum boleh dikerjakan. Naikkan menjadi rencana bernomor bila siap.
