# PLAN-INDEX.md — daftar rencana berjalan

**Pintu masuk tunggal.** Setiap perubahan yang punya rencana terdaftar di sini.
Alur dan gerbangnya ada di `docs/WORKFLOW.md`.

Status yang mungkin: `plan-draft`, `plan-approved`, `mockup-v1`,
`mockup-approved`, `implementing`, `tested`, `shipped`, `superseded`.

---

## Berjalan

| # | Rencana | Kelas | Status | Diperbarui |
|---|---|---|---|---|
| 001 | [Harness tes UI](plans/001-ui-test-harness.md) | infra | `tested` — menunggu `ui.yml` hijau | 2026-11-11 |
| 002 | [DeepSeek opt-in](plans/002-deepseek-opt-in.md) | pipeline | `tested` | 2026-11-11 |

`001` sudah lengkap di kode: lapisan tanpa browser (`tests/ui-static.test.ts`)
dan lapisan browser (`tests-ui/shell.spec.ts`, `npm run test:ui`). `npm test`
= 195 lulus; suite browser = 4 lulus, dua kali berturut-turut. Negatif UI-01,
PUSH-01, dan UI-06 terbukti gagal saat perilakunya dirusak. `ui.yml` belum
pernah jalan di GitHub.

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
