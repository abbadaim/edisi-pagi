# 025 — Pertanyaan `failed` bisa dikirim ulang dari UI

```
Status: tested
Kelas: UI + pipeline
Dibuat: 2026-11-18
Diperbarui: 2026-11-18
Mockup: — (mengikuti pola tombol aksi `.pbtn` di layar detail Tanya)
```

## 1. Masalah

Pertanyaan yang gagal tidak punya jalan pulih dari aplikasi.

Bukti 2026-11-18, sembilan baris `public.asks` yang tersisa dari uji
2026-11-17:

```
state   count
failed    8
answered  1
```

Delapan baris itu `failed`, beberapa dengan `attempts: 5`. Penyebabnya bisa
sepele dan sementara — model tidak tersedia, batas waktu, satu keluaran JSON
cacat. Sesudah itu pertanyaannya tidak bergerak lagi:

- `scripts/ask.ts` mengambil pekerjaan dengan `asks?state=eq.new`, jadi `failed`
  tidak pernah disentuh lagi oleh sapuan 6 jam (`tanya.yml`).
- `asks` hanya punya policy `owner_read`, `owner_insert`, `owner_delete` — tidak
  ada `owner_update`. Aplikasi tidak bisa mengembalikan baris ke `new`; PATCH
  akan ditolak RLS.
- Layar detail menampilkan "Jawaban muncul di sini setelah diproses." untuk
  state `failed`, seolah masih berjalan. Tidak ada tombol apa pun.

Akibatnya satu kegagalan sesaat mengubur pertanyaan untuk selamanya, dan
satu-satunya pemulihan adalah SQL tangan yang hanya pemilik repo bisa lakukan.

## 2. Keputusan yang akan diambil

Layar detail menampilkan alasan gagal dan tombol **Coba lagi** untuk baris
`failed`. Tombol itu mengirim **pertanyaan baru** dengan `mode`, `question`, dan
`topic_id` yang sama lewat jalur `POST /rest/v1/asks` yang sudah ada, lalu
berpindah ke baris baru itu. Baris lama dibiarkan sebagai riwayat.

Yang **tidak** berubah: tidak ada policy UPDATE untuk pengguna, tidak ada
perubahan skema, tidak ada endpoint baru, dan pipeline tetap hanya mengambil
`state=new`. State `refused` tidak ditawari ulang — menolak karena bahan kurang
bukan kegagalan, dan mengulangnya hanya membakar panggilan model (`DEC-0042`).

## 3. Rencana

1. `public/app.js` — `retryAskBlock(item)`: tombol `.pbtn` + pesan galat; sukses
   → `refreshAsks()` lalu `navigate({name:"tanya", askId: <baris baru>})`.
2. `public/app.js` — di `renderAskDetail`, cabang `failed` menampilkan
   `item.error` (dipotong 200 karakter) dan blok kirim ulang.
3. `tests/ui-static.test.ts` — `UI-08` mengunci tombol, syarat `failed`, dan
   pemakaian ulang pertanyaan yang sama.

Tidak menyentuh `scripts/ask.ts`, `supabase/`, atau `public/answers/`.

## 4. Mockup / kontrak

Mengikuti pola yang sudah ada: kotak `.empty` di layar detail Tanya, dengan
`.pbtn` sebagai aksi. Tidak ada token atau kelas CSS baru.

Kontrak perilaku (infra/pipeline):

```
POST /rest/v1/asks   Prefer: return=minimal
{ "mode": "now", "question": "<pertanyaan lama>", "topic_id": null }
```

- `201` → baris baru `state=new`, trigger `tanya_dispatch` memicu run, layar
  berpindah ke baris baru dengan status "menjawab…".
- `401` → sesi habis; pesan `perlu masuk` tampil di bawah tombol.
- `42501` → GRANT hilang; pesan PostgREST tampil apa adanya.

Baris `failed` lama tetap `failed` dan tetap terlihat di daftar (riwayat).

## 5. Tes

- `tests/ui-static.test.ts` `UI-08` — `retryAskBlock` ada, hanya `state ===
  "failed"` yang ditawari, body POST memakai `item.question`, `item.error`
  ditampilkan. **Gagal sebelum** `app.js` diubah (regex `retryAskBlock` tidak
  ditemukan).
- `npm run typecheck`, `npm test`.
- Uji manual: buka satu baris `failed` → tombol muncul → tekan → muncul baris
  baru berstatus menunggu, tanpa duplikat.

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| Tombol dipencet berulang → banyak baris | tombol dinonaktifkan selama kirim; tiap kiriman tetap pertanyaan sah |
| Daftar penuh riwayat gagal | baris lama tidak dihapus; pemilik bisa membersihkannya lewat SQL |
| `refused` ikut ditawari ulang | sengaja tidak; hanya `failed` |
| Pengguna mengira baris lama ikut berubah | teks menyebut pertanyaan dikirim ulang, baris lama tetap |

Rollback: hapus `retryAskBlock` dan cabang `failed` di `renderAskDetail`;
`public/app.js` kembali ke perilaku sebelumnya tanpa perubahan data.

## 7. Riwayat

- `2026-11-18` — `tested` — dibuat setelah 8 dari 9 baris `asks` berakhir
  `failed` dan tidak bisa dipulihkan dari aplikasi.

## 8. Pelajaran (diisi setelah `shipped`)

—
