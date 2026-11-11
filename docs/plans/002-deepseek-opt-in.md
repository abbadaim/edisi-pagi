# 002 — DeepSeek API hanya lewat permintaan eksplisit

```
Status: tested
Kelas: pipeline
Dibuat: 2026-11-11
Diperbarui: 2026-11-11
Mockup: — (kelas pipeline; artefak = kontrak §4)
```

---

## 1. Masalah

Rantai penyedia menyertakan DeepSeek API langsung sebagai **cadangan otomatis**:

```ts
// sebelum
if ((!forced || forced === "deepseek") && env.DEEPSEEK_API_KEY) { ... }
```

Akibatnya, setiap kali OpenCode tidak tersedia atau gagal di tengah run, build
otomatis memakai DeepSeek API langsung dan menguras saldo — tanpa ada keputusan
manusia. Saldo DeepSeek sedang rendah; biaya per token ditanggung pribadi.

Bukti:

| Lokasi | Isi |
|---|---|
| `src/adapters/llm/resolve.ts` | `!forced` mengizinkan deepseek sebagai cadangan |
| `.github/workflows/daily.yml` | `DEEPSEEK_API_KEY` diekspor setiap run |
| `scripts/adjudicate.ts` | memakai `DEEPSEEK_API_KEY` langsung tanpa syarat |
| `scripts/build.ts` | komentar menyatakan urutan `opencode -> deepseek -> deterministik` |

Catatan: `OPENCODE_MODEL=opencode-go/deepseek-v4.1-flash` berarti OpenCode
sendiri memakai DeepSeek **lewat langganan OpenCode**. Yang dinonaktifkan di sini
adalah kunci `DEEPSEEK_API_KEY` langsung, bukan modelnya.

## 2. Keputusan yang akan diambil

DeepSeek API langsung menjadi **opt-in**: hanya aktif bila
`LLM_PROVIDER=deepseek` dan `DEEPSEEK_API_KEY` ada. Tanpa itu, urutan penyedia
adalah **opencode → deterministik**. Kode DeepSeek tetap ada dan tidak dihapus,
sehingga bisa dihidupkan kembali dengan satu variabel lingkungan.

## 3. Rencana

1. `src/adapters/llm/resolve.ts` — hapus `!forced` dari syarat DeepSeek; log
   eksplisit saat OpenCode tidak tersedia dan saat `LLM_PROVIDER=deepseek` tanpa
   kunci.
2. `scripts/adjudicate.ts` — syarat yang sama (`LLM_PROVIDER=deepseek`), karena
   skrip manual ini juga bisa menguras saldo.
3. `.github/workflows/daily.yml` — set `LLM_PROVIDER: opencode`, hapus ekspor
   `DEEPSEEK_API_KEY`, dengan komentar yang menunjuk `DEC-0016`.
4. `tests/llm-resolve.test.ts` — empat uji yang mengunci invariannya.
5. Perbarui komentar `scripts/build.ts` dan bagian LLM di `README.md`.

## 4. Kontrak

Keluaran `resolveLlm(env)` — tidak ada panggilan jaringan, hanya probe binari:

| Env | `provider` | Catatan |
|---|---|---|
| `OPENCODE_BIN=/nonexistent`, `DEEPSEEK_API_KEY=sk-…` | `deterministic` | **invarian utama**: kunci ada pun tidak dipakai |
| `LLM_PROVIDER=opencode`, idem | `deterministic` | opencode dipaksa, tidak jatuh ke mana pun |
| `LLM_PROVIDER=deepseek`, `DEEPSEEK_API_KEY=sk-…` | `deepseek` | satu-satunya jalan |
| `LLM_PROVIDER=deepseek`, tanpa kunci | `deterministic` | tidak gagal, hanya turun kualitas |

Baris log yang diharapkan:

```
opencode tidak tersedia — memakai penulis deterministik (DeepSeek nonaktif, DEC-0016)
LLM_PROVIDER=deepseek tetapi DEEPSEEK_API_KEY tidak ada — memakai penulis deterministik
```

## 5. Tes

`tests/llm-resolve.test.ts`, ikut `npm test`:

1. tanpa `LLM_PROVIDER` + kunci DeepSeek ada → `deterministic`.
2. `LLM_PROVIDER=opencode` + kunci ada → `deterministic`.
3. `LLM_PROVIDER=deepseek` + kunci ada → `deepseek`.
4. `LLM_PROVIDER=deepseek` tanpa kunci → `deterministic` (tidak melempar).

**Uji negatif (dijalankan 2026-11-11).** `resolve.ts` dikembalikan ke versi
`HEAD` (kode lama) → uji 1 gagal (`provider` menjadi `deepseek`, karena kunci
dipakai sebagai cadangan). Uji 2–4 tetap lulus, seperti diharapkan: `forced`
sudah dihormati kode lama. Dipulihkan → 4 lulus.

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| OpenCode mati → kualitas turun ke writer deterministik, bukan DeepSeek | log jelas + `fallback` di adjudikasi; kegagalan terlihat, tidak senyap |
| Angka kartu turun tanpa ada yang sadar | periksa `llm:` pada log build; bandingkan `card_count` edisi |
| Perlu DeepSeek lagi mendadak | `LLM_PROVIDER=deepseek` + kembalikan `DEEPSEEK_API_KEY`; kode tidak dihapus |
| Agen lain menjalankan tanpa env | default kode sudah aman (`!forced` tidak mengaktifkan DeepSeek) |

Rollback: `LLM_PROVIDER=deepseek` dan pulihkan secret. Tidak ada perubahan
skema, tidak ada migrasi.

## 7. Revisi

### v2 — 2026-11-11 — model dipatok ke DeepSeek Flash

**Permintaan.** “In opencode, always use deepseek flash model.”

**Keadaan sebelumnya.** `OPENCODE_MODEL` sudah berisi
`opencode-go/deepseek-v4.1-flash` di `daily.yml` dan `opencode-smoke.yml`, dan
itu juga default di `resolve.ts`. Jadi secara praktis sudah benar — tetapi hanya
sebagai **default yang bisa ditimpa**, tanpa tes yang menjaganya.

**Temuan yang menyertai.**

| Temuan | Bukti |
|---|---|
| `src/config/llm.ts` (konfigurasi per-kapabilitas) tidak pernah dibaca | hanya `CapabilityConfig` yang diimpor; `loadLlmConfig`/`validateLlmConfig`/`DEFAULT_CONFIG` tanpa pemanggil |
| `INFRA.md` §11.2 masih menyebut DeepSeek sebagai cadangan | bertentangan dengan `DEC-0016` |
| `config/llm.example.yaml` menyarankan `deepseek-v4-pro` untuk `verify` | contoh yang, bila disalin, memakai model lebih mahal |

**Perubahan.** `DEC-0017`; `tests/llm-model.test.ts` mengunci model default dan
model di kedua workflow, serta memastikan `daily.yml` tidak mengekspor
`DEEPSEEK_API_KEY`; `INFRA.md` §11.2 dan `config/llm.example.yaml` diselaraskan;
`src/config/llm.ts` diberi header “belum terpasang”.

**Yang tidak berubah.** Perilaku runtime — konfigurasi per-kapabilitas tetap
belum dipakai, dan `OPENCODE_MODEL` tetap bisa ditimpa. Yang baru adalah
peringatan yang terlihat bila model bergeser.

---

## 8. Riwayat

- `2026-11-11` — `plan-draft` — dibuat atas permintaan pemilik proyek: “disable
  deepseek direct api use for now, use opencode exclusively; saldo DeepSeek rendah”.
- `2026-11-11` — `mockup-approved` — kontrak §4 disetujui lewat instruksi sesi
  yang sama (kelas pipeline: tidak ada mockup).
- `2026-11-11` — `tested` — 4 uji lulus, uji negatif terbukti gagal pada kode
  lama, `npm test` 199 lulus.
- `2026-11-11` — `tested` — v2: model dipatok ke `opencode-go/deepseek-v4.1-flash`
  (`DEC-0017`), tiga uji baru di `tests/llm-model.test.ts`.

## 9. Pelajaran

Biaya adalah kebijakan, bukan efek samping. “Cadangan otomatis” pada penyedia
berbayar berarti keputusan pengeluaran diambil oleh kegagalan jaringan, bukan
oleh manusia. Invarian yang harus dipegang: **penyedia berbayar hanya aktif bila
diminta eksplisit**, dan itu harus dikunci tes — bukan hanya dihapus dari
konfigurasi CI, karena agen lain bisa menjalankan pipeline tanpa env tersebut.
