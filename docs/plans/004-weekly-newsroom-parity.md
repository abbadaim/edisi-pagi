# 004 — Paritas newsroom untuk edisi mingguan

```
Status: tested (2026-11-11)
Kelas: pipeline
Dibuat: 2026-11-11
Diperbarui: 2026-11-11
Mockup: — (kelas pipeline; artefak = kontrak §4)
```

---

## 1. Masalah

Edisi mingguan masih memakai penulis lama. `scripts/weekly.ts` memanggil
`buildDeepDiveWithLlm()` atau `buildDeepDive()`, bukan alur newsroom
(riset → writer → editor → repair fakta → disclaimer/unresolved).

Akibatnya, pada edisi `2026-11-10.mingguan.json`:

| Metrik | Mingguan sekarang | Harian newsroom |
|---|---|---|
| Panjang body | 1.311–1.750 karakter | 3.000–9.000 karakter |
| Sitasi per paragraf | tidak ada | ada |
| Riset teks penuh | lead + `ringkasan` | `MaterialPack` |
| Catatan/disclaimer | tidak ada | ada |
| Sumber | 2–3 | 3–5 |

Rekap mingguan adalah bacaan terpanjang produk ini; justru di situ riset dan
editor paling dibutuhkan.

## 2. Keputusan

Mingguan memakai `writeNewsroomCard()` dengan assignment `depth: "deep"` dan
`asDeep: true`. Penulis lama tetap tersedia sebagai fallback dan rollback.

Dua penyesuaian kecil diperlukan:

1. `writeNewsroomCard` menerima `minDeepSources` (default 3). Mingguan
   memakai **2** karena validator mingguan mengizinkan 2 sumber (`E015`).
2. Kartu hasil newsroom dirapikan untuk konteks rekap: angle `Rekap N hari`,
   kicker `Rekap pekan`, statistik artikel/media/hari, aksi “ini rekap”.

Tidak ada perubahan skema `edition.json`.

## 3. Rencana

1. `src/core/newsroom/card.ts` — tambah `minDeepSources?: number` pada input;
   `toCard()` memakai `input.minDeepSources ?? 3`.
2. `scripts/weekly.ts`:
   - Bangun `Assignment` mingguan dari `AdjudicatedTopic`: `depth: "deep"`,
     5 pertanyaan rekap, `note_ids: []`.
   - Panggil `writeNewsroomCard()` dengan `asDeep: true`,
     `minDeepSources: 2`, `fromIso` 7 hari, `toIso` sekarang.
   - `weeklyise(card, cluster, now)` untuk angle/kicker/stats/action/read_min.
   - Fallback per kartu: newsroom → `buildDeepDiveWithLlm` → `buildDeepDive`.
   - `--limit` (default 5, minimum terbit 3) untuk kontrol biaya.
   - Log: `mingguan · N thread · X newsroom / Y legacy`.
3. Tes:
   - `tests/weekly-newsroom.test.ts` — assignment builder, `weeklyise`,
     fallback, validasi edisi mingguan.
   - `tests/newsroom-card.test.ts` — `minDeepSources: 2` menghasilkan
     `deep_dive`; default tetap `news` untuk 2 sumber.
4. Uji terbatas pada tanggal **baru** (bukan edisi terbit), mis.
   `--date 2026-11-12 --days 7 --thin`, lalu `npm run validate`.
5. Produksi pertama: Minggu **2026-11-15**. Edisi mingguan `2026-11-10`
   tidak dibangun ulang.

## 4. Kontrak

### Masukan

- Jendela 7 hari, klaster ≥3 artikel, top 5 menurut `artikel × media`.
- `Assignment` mingguan: `depth: "deep"`, `answers` 5 pertanyaan (apa yang
  berubah, mengapa, siapa terdampak, apa yang belum jelas, apa langkah
  berikutnya), `note_ids: []`.
- `writeNewsroomCard`: `asDeep: true`, `minDeepSources: 2`, `openNotes: []`,
  `prior: []`.

### Keluaran

- Setiap kartu: `type: "deep_dive"`, `angle: "Rekap N hari"`,
  `kicker: "Rekap pekan"`, `optional: true`, `dek`, `read_min` 4–15,
  `stats: [{artikel}, {media}, {hari}]`, `truth` dari sumber yang disitasi,
  `disclaimer`/`unresolved` bila editor menemukannya.
- Log:
  ```
  mingguan · 5 thread · 5 newsroom / 0 legacy
  mingguan · 5 thread · 4 newsroom / 1 legacy
  ```
- `generated_by.write` = provider jika minimal satu kartu ditulis newsroom.

### Batas dan rollback

- Maksimum 5 `deep_dive` (validator `E014`); minimum terbit 3.
- `WEEKLY_WRITER=legacy` memaksa jalur lama tanpa mengubah kode.
- Tidak ada migrasi, tidak ada perubahan `public/`.

## 5. Tes

1. `weeklyAssignment(topic)` → `depth === "deep"`, 5 `answers`, `note_ids` kosong.
2. `weeklyise(card, cluster)` → tipe/angle/kicker/stats/action benar; `truth`
   dan `sources` tidak berubah.
3. `minDeepSources: 2` → kartu 2 sumber menjadi `deep_dive`; tanpa parameter →
   tetap `news` (perilaku harian tidak berubah).
4. Edisi mingguan hasil `weeklyise` lolos `validateEdition` (3 kartu, coverage
   168 jam, sumber ≥2).
5. Fallback: LLM mengembalikan `null` → `buildDeepDiveWithLlm` dipakai; bila
   itu juga gagal → `buildDeepDive`.
6. Uji negatif: hapus `minDeepSources: 2` dari pemanggilan mingguan → kartu
   2 sumber kembali `news` dan validasi mingguan gagal (`E014`/`E015`).

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| 5 kartu deep menambah waktu build Minggu | `--limit` 5, fallback per kartu, timeout CI 45 menit; ukur run pertama |
| Biaya naik (riset + editor per kartu) | hanya Minggu; `llm_calls` mencatat token/latensi |
| 2 sumber ditolak `toCard` | `minDeepSources: 2`, dikunci tes |
| Kualitas turun karena fallback senyap | log `newsroom / legacy` per edisi |
| Edisi mingguan lama terbit ulang | tanggal baru; `2026-11-10` tidak disentuh |

Rollback: `WEEKLY_WRITER=legacy` atau hapus pemanggilan newsroom; jalur lama
masih utuh.

## Riwayat

- `2026-11-11` — `plan-draft` — dibuat setelah pemilik memilih “weekly newsroom
  parity” sebagai known gap pertama.
- `2026-11-11` — `plan-approved` — pemilik menyetujui arah dan prioritas.
- `2026-11-11` — `mockup-approved` — kontrak §4 disetujui (kelas pipeline:
  tidak ada mockup).
- `2026-11-11` — `implementing` — `minDeepSources` di `card.ts`,
  `src/core/weekly-newsroom.ts`, integrasi `scripts/weekly.ts`, 6 uji baru.
- `2026-11-11` — `tested` — `npm test` 212 lulus; build terbatas
  `--date 2026-11-12 --days 7 --limit 3 --thin`: **3 thread, 3 newsroom /
  0 legacy**, valid, body 9.514–9.678 karakter, 2–4 sumber. Artefak uji
  dihapus; edisi terbit tidak disentuh. Produksi pertama: Minggu 2026-11-15.
