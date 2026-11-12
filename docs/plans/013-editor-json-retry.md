# 013 — Ulang sekali saat editor mengembalikan JSON tidak sah

```
Status: tested
Kelas: pipeline
Dibuat: 2026-11-12
Diperbarui: 2026-11-12
Mockup: — (kelas pipeline; artefak = kontrak §4)
```

---

## 1. Masalah

Build 2026-11-12 (run `43142858798`) berhasil, tetapi satu panggilan editor gagal:

```
! editor gagal (Expected ',' or '}' after array element in JSON at position 769)
  — memakai temuan deterministik
```

Kartu tetap terbit, tetapi **editor model tidak dipakai untuk kartu itu**; yang
bekerja hanya aturan deterministik. Penurunan kualitasnya senyap: tidak ada yang
memberi tahu pembaca bahwa satu kartu tidak melewati editor.

Kegagalan ini berbeda sifat dari timeout yang sudah ditangani `DEC-0025`:
bentuk JSON yang cacat **bisa** diperbaiki dengan satu ulangan, sedangkan timeout
hanya akan menghabiskan waktu lagi.

## 2. Keputusan yang akan diambil

Membedakan dua jenis kegagalan dan hanya mengulang yang layak:

| Kegagalan | Sikap |
|---|---|
| bentuk JSON (parse) | ulang **sekali**, dengan penanda di akhir system |
| timeout | **tidak** diulang; jatuh ke temuan deterministik |
| HTTP 429/5xx | tidak diulang di lapisan ini (adapter sudah punya retry sendiri) |

Penanda retry ditempel di **akhir** system prompt supaya panggilan pertama tetap
memakai prefix yang sama (`DEC-0024`).

## 3. Rencana

1. `src/core/newsroom/edit.ts` — `isJsonShapeError()` + satu ulangan di
   `editDraft`.
2. `tests/newsroom.test.ts` — tiga uji: ulangan berhasil, timeout tidak diulang,
   klasifikasi error.

## 4. Kontrak

```
! editor: JSON tidak sah (Expected ',' … in JSON at position 769) — ulang sekali
```

| Keadaan | Panggilan LLM | `edit.verdict` |
|---|---|---|
| JSON sah | 1 | dari model |
| JSON cacat, ulangan sah | 2 | dari model |
| JSON cacat dua kali | 2 | `revise` + temuan deterministik |
| timeout | 1 | `revise` + temuan deterministik |

## 5. Tes

`npm test` = **258 lulus**, typecheck bersih.

Uji negatif dijalankan: `if (!isJsonShapeError(e)) throw e;` diganti `throw e;`
→ uji “mengulang sekali” **gagal** (`calls` tetap 1). Dipulihkan → lulus.

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| Dua kali biaya untuk keluaran cacat | hanya pada kegagalan bentuk; maksimum satu ulangan |
| Retry menutupi bug prompt | log menyebut “ulang sekali” dengan potongan pesan; frekuensinya terlihat di `llm_calls` (2 baris `edit` untuk topik yang sama) |
| Ulangan juga cacat | batas satu; setelah itu jalur deterministik seperti sebelumnya |

Rollback: hapus blok ulangan; perilaku kembali ke satu panggilan.

## 7. Riwayat

- `2026-11-12` — `plan-draft` — dibuat dari kegagalan editor pada run
  `43142858798`.
- `2026-11-12` — `mockup-approved` — disetujui lewat instruksi: “do the targetted
  retry”.
- `2026-11-12` — `tested` — 3 uji baru, 258 lulus, uji negatif terbukti gagal.

## 8. Pelajaran

“Gagal” bukan satu kategori. Timeout, 429, 5xx, dan JSON cacat punya penyebab
berbeda dan biaya ulangan yang berbeda. Kebijakan yang benar bukan “retry atau
tidak”, melainkan **klasifikasikan dulu, baru putuskan** — dan klasifikasinya
diuji, bukan ditulis sebagai komentar.
