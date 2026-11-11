# PLAN-INDEX.md — daftar rencana berjalan

**Pintu masuk tunggal.** Setiap perubahan yang punya rencana terdaftar di sini.
Alur dan gerbangnya ada di `docs/WORKFLOW.md`.

Status yang mungkin: `plan-draft`, `plan-approved`, `mockup-v1`,
`mockup-approved`, `implementing`, `tested`, `shipped`, `superseded`.

---

## Berjalan

| # | Rencana | Kelas | Status | Diperbarui |
|---|---|---|---|---|
| 002 | [DeepSeek opt-in](plans/002-deepseek-opt-in.md) | pipeline | `tested` | 2026-11-11 |
| 003 | [Verifikasi katalog model](plans/003-model-catalog-check.md) | infra | `tested` | 2026-11-11 |
| 004 | [Paritas newsroom mingguan](plans/004-weekly-newsroom-parity.md) | pipeline | `tested` | 2026-11-11 |
| 005 | [Sitemap sumber primer](plans/005-primary-sitemap.md) | pipeline | `tested` | 2026-11-11 |
| 006 | [Teks penuh meta lokal](plans/006-local-meta-text.md) | pipeline | `tested` | 2026-11-11 |
| 007 | [Kartu gap & debate](plans/007-gap-debate-cards.md) | pipeline | `tested` | 2026-11-11 |

`002` selesai di kode dan tes: 4 uji baru di `tests/llm-resolve.test.ts`.
Menunggu tidak ada; menunggu hanya konfirmasi run `daily.yml` berikutnya bahwa
edisi tetap terbit dengan OpenCode saja.

---

## Selesai

| # | Rencana | Kelas | Status | Selesai |
|---|---|---|---|---|
| 001 | [Harness tes UI](plans/001-ui-test-harness.md) | infra | `shipped` | 2026-11-11 |
| 008 | [Arsip edisi & gestur kembali](plans/008-arsip-dan-gestur-kembali.md) | UI | `shipped` | 2026-11-11 |

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
