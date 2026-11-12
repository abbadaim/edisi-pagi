# 014 — Ulang sekali saat feed gagal karena gangguan sesaat

```
Status: tested
Kelas: pipeline
Dibuat: 2026-11-12
Diperbarui: 2026-11-12
Mockup: — (kelas pipeline; artefak = kontrak §4)
```

---

## 1. Masalah

Build 2026-11-12 (run `43142858798`) mencatat:

```
tempo_nasional      0  × The operation was aborted due to timeout
```

Satu feed hilang. Build tetap terbit, jadi tidak ada yang memperbaikinya — dan
cakupan berita menyempit secara senyap. Timeout itu berasal dari
`AbortSignal.timeout(15_000)` milik kita sendiri, bukan dari server yang
menolak.

## 2. Keputusan yang akan diambil

Membedakan **gangguan sesaat** dari **kesalahan tetap**, lalu hanya mengulang
yang pertama:

| Kegagalan | Ulang? | Alasan |
|---|---|---|
| timeout / abort | ya, sekali | server lambat, bukan menolak |
| `fetch failed`, ECONNRESET, ETIMEDOUT | ya, sekali | gangguan jaringan |
| HTTP 5xx | ya, sekali | gangguan sisi server |
| HTTP 4xx | **tidak** | URL/izin salah; hasilnya akan sama |

Jeda 500 ms sebelum ulangan. Feed diambil paralel, jadi satu retry tidak
memperlambat total secara berarti.

## 3. Rencana

1. `src/core/ingest.ts` — `isRetryableFeedError()` + satu ulangan per feed.
   Pesan galat menyebut jumlah percobaan (`(2 percobaan)`) supaya terlihat.
2. `tests/ingest-retry.test.ts` — klasifikasi timeout/5xx vs 4xx.

## 4. Kontrak

| Keadaan | Percobaan | Baris tabel `npm run ingest` |
|---|---|---|
| feed sehat | 1 | `ok` |
| timeout lalu berhasil | 2 | `ok` |
| timeout dua kali | 2 | `× … (2 percobaan)` |
| HTTP 404 | 1 | `× HTTP 404` |

## 5. Tes

`npm test` = **266 lulus**, typecheck bersih.

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| Umpan balik lambat diulang | hanya 1 ulangan; 4xx tidak diulang |
| Sumber mati memperlambat ingest | feed paralel; tambahan maksimum = timeout + 500 ms untuk feed yang gagal |
| Retry menutupi feed yang benar-benar mati | pesan menyebut `(2 percobaan)`, dan kegagalan tetap muncul di tabel |

Rollback: hapus loop ulangan; perilaku kembali ke satu percobaan.

## 7. Riwayat

- `2026-11-12` — `plan-draft` — dibuat dari kegagalan `tempo_nasional` pada run
  `43142858798`.
- `2026-11-12` — `mockup-approved` — disetujui lewat instruksi: “do both”.
- `2026-11-12` — `tested` — 2 uji baru, 266 lulus.

## 8. Pelajaran

Feed yang diambil paralel membuat kegagalan satu sumber **tidak terasa**: build
tetap cepat dan tetap terbit. Itu bagus untuk ketersediaan, buruk untuk cakupan.
Yang membuatnya terlihat adalah tabel `perFeed`; yang membuatnya pulih adalah
retry. Keduanya perlu, bukan salah satu.
