# 003 — Verifikasi model OpenCode terhadap katalog

```
Status: tested
Kelas: infra
Dibuat: 2026-11-11
Diperbarui: 2026-11-11
Mockup: — (kelas infra; artefak = kontrak §4)
```

---

## 1. Masalah

`INFRA.md` §11.5 menyatakan: “Adapter memverifikasi model ada di katalog saat
startup, bukan saat 05.45.” Itu **tidak benar** — tidak ada kode yang membaca
katalog. `resolveLlm` hanya memeriksa `opencode --version` lalu langsung memakai
`OPENCODE_MODEL`.

Konsekuensi praktis: id model yang salah (salah ketik, model dihapus, varian
berganti nama) tidak tertangkap di awal. Setiap panggilan gagal, tiap kartu jatuh
ke penulisan deterministik, dan penyebabnya hanya terlihat sebagai
`! tulis gagal` berulang.

## 2. Keputusan yang akan diambil

Model diverifikasi terhadap katalog `opencode models` sekali, sebelum panggilan
pertama. Model yang tidak ada → OpenCode tidak dipakai, penulis deterministik,
dengan satu baris log yang menyebut id model dan `DEC-0018`. Katalog yang gagal
dibaca **tidak** memblokir penerbitan.

Dua perilaku ini sengaja berbeda:

| Keadaan | Sikap | Alasan |
|---|---|---|
| Katalog terbaca, model tidak ada | **tolak** OpenCode | kesalahan pasti; memakai model itu hanya menghabiskan waktu |
| Katalog tidak terbaca | **lanjut** dengan peringatan | kegagalan sementara; memblokir penerbitan lebih buruk daripada mencoba |

## 3. Rencana

1. `src/adapters/llm/opencode.ts` — `listModels()`: `opencode models`, satu id
   per baris, `null` bila gagal/kosong.
2. `src/adapters/llm/index.ts` — ekspor `listModels`.
3. `src/adapters/llm/resolve.ts` — verifikasi setelah probe, sebelum
   `createAdapter`.
4. `tests/fixtures/fake-opencode` — stub `sh` untuk `--version` dan `models`,
   dikendalikan `FAKE_MODELS` / `FAKE_MODELS_FAIL`.
5. `tests/llm-catalog.test.ts` — empat uji.
6. `INFRA.md` §11.2, §11.3, §11.5 — selaraskan dengan perilaku sebenarnya.

## 4. Kontrak

```
$ opencode models
opencode-go/beam-free
opencode-go/deepseek-v4-pro
opencode-go/deepseek-v4.1-flash
...
```

| Env | Keluaran `resolveLlm` | Log |
|---|---|---|
| katalog memuat `OPENCODE_MODEL` | `opencode`, model itu | — |
| katalog tidak memuatnya | `deterministic` | `model <id> tidak ada di katalog opencode — memakai penulis deterministik (DEC-0018)` |
| `opencode models` gagal | `opencode`, model itu | `katalog opencode tidak terbaca — model <id> tidak diverifikasi` |

Biaya: dua spawn sekali per build (`--version`, `models`), bukan per kartu.

## 5. Tes

`tests/llm-catalog.test.ts` (stub, tanpa jaringan, ikut `npm test`):

1. model ada di katalog → `opencode`.
2. model tidak ada → `deterministic`.
3. `LLM_PROVIDER=opencode` + model tidak ada → tetap `deterministic` (paksa
   penyedia bukan alasan melewati verifikasi).
4. katalog gagal dibaca → tetap `opencode`.

**Uji negatif.** `resolve.ts` dikembalikan ke versi `HEAD` (tanpa cek katalog)
→ uji 2 dan 3 gagal (`provider` menjadi `opencode` untuk model yang tidak ada).
Dipulihkan → 4 lulus.

**Verifikasi dengan binari sungguhan** (2026-11-11, opencode v2.2.6):

```
katalog terbaca: 51 model
flash ada di katalog: true
default -> opencode opencode-go/deepseek-v4.1-flash
model salah -> deterministic opencode-go/model-yang-tidak-ada
```

**Bug yang tertangkap tes sendiri.** Versi pertama `resolve.ts` hanya mencatat
“katalog tidak terbaca” tanpa memasang adapter — sehingga katalog yang gagal
dibaca menghasilkan `deterministic`, bukan `opencode`. Uji 4 gagal dan
memperbaikinya. Tanpa uji itu, kegagalan katalog akan diam-diam mematikan
seluruh penulisan LLM.

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| `opencode models` lambat / menggantung | timeout 20 detik; gagal → lanjut dengan peringatan |
| Katalog kosong padahal binari sehat | `null` diperlakukan seperti tidak terbaca → lanjut |
| Verifikasi menambah waktu build | dua spawn sekali per build, bukan per kartu |
| Stub tes bocor ke produksi | stub hanya dipakai lewat `OPENCODE_BIN` di tes |

Rollback: hapus pemanggilan `listModels` di `resolve.ts`. Tidak ada perubahan
skema.

## 7. Riwayat

- `2026-11-11` — `plan-draft` — dibuat setelah menemukan klaim `INFRA.md` §11.5
  yang tidak sesuai kode.
- `2026-11-11` — `mockup-approved` — kontrak §4 disetujui lewat instruksi pemilik
  proyek: “correct the doc and implement the check”.
- `2026-11-11` — `tested` — 4 uji stub lulus, verifikasi binari nyata (v2.2.6,
  51 model) sesuai, `npm test` 206 lulus, typecheck bersih.

## 8. Pelajaran

Klaim dokumentasi yang tidak sesuai kode adalah utang yang menipu: ia membuat
sesi berikutnya percaya ada jaring pengaman yang tidak ada. Yang benar bukan
sekadar menghapus kalimatnya, tetapi memutuskan apakah jaring itu layak dipasang
— lalu memasangnya, atau menghapus klaimnya.

Di sini jawabannya memasang, karena kegagalan yang dicegah (model salah) bersifat
pasti, dan biayanya dua spawn per build.
