# 009 — Verifikasi jadwal setelah deploy

```
Status: shipped (2026-11-12)
Kelas: docs
Dibuat: 2026-11-12
Diperbarui: 2026-11-12
Mockup: — (kelas docs; tidak ada artefak)
```

---

## 1. Masalah

Jadwal `45 22 * * *` (05:45 WIB) **tidak berjalan** pada 2026-11-12.

| Pemeriksaan | Hasil |
|---|---|
| `gh workflow list --all` | `edisi-harian` **active** — bukan dinonaktifkan |
| `gh run list --workflow daily.yml --event schedule` | hanya satu: `2026-11-11T02:16:55Z` |
| Run pada slot 22:45Z | **tidak ada**, termasuk yang berstatus `queued` |

Jadi bukan build gagal, bukan deploy gagal, dan bukan `latest_by_scope`:
**tidak ada run yang dibuat**. Penjadwal GitHub bersifat best-effort dan boleh
membuang trigger, terutama pada menit ramai. Tidak ada notifikasi, dan tidak ada
yang tahu sampai aplikasi masih menampilkan edisi kemarin.

**Pelajaran penting untuk rencana ini:** status `active` **tidak** menangkap
kejadian ini. Workflow-nya memang aktif. Satu-satunya bukti yang benar adalah
*run hari ini ada* dan *edisi hari ini terbit*.

## 2. Keputusan yang akan diambil

Tidak menambah cron kedua dan tidak mengubah `build.ts`. Sebagai gantinya:
langkah verifikasi setelah setiap deploy/publish masuk ke skill proyek dan
`AGENTS.md`, sehingga sesi berikutnya memeriksa tiga hal berurutan:

1. workflow **aktif**,
2. cron **masih ada** di `main` (bukan hilang saat menyunting workflow),
3. **run hari ini ada** dan **edisi hari ini terbit** — bukti yang sebenarnya.

Pemilik proyek menolak cron cadangan secara eksplisit: satu jadwal, dengan
verifikasi, bukan dua jadwal dengan saling menutupi.

## 3. Rencana

1. `.opencode/skills/edisi-pagi/SKILL.md` — bagian **“Setelah deploy — cek
   jadwal”** di dalam *Verification skills*, berisi empat perintah dan satu
   kalimat tentang mengapa `active` tidak cukup.
2. `AGENTS.md` §8 — versi ringkas perintah yang sama.
3. `AGENTS.md` §6 — baris tabel debugging: “edisi hari ini tidak terbit, tidak
   ada run” → workflow aktif? cron ada di `main`? run hari ini ada?
4. `AGENTS.md` §5 — catat bahwa trigger GitHub bisa dibuang dan bahwa penjaga
   build tidak ada (edisi immortal ditegakkan verifikasi, bukan kode).

## 4. Kontrak

```bash
# 1. aktif, bukan disabled_manually
gh workflow list --all | grep -E "^edisi-harian"

# 2. cron masih ada di main
git show origin/main:.github/workflows/daily.yml | grep -A2 "schedule:"

# 3. run hari ini ada
TZ=Asia/Jakarta date +%F
gh run list --workflow daily.yml --limit 3

# 4. edisi hari ini benar-benar terbit
curl -s https://abbadaim.github.io/edisi-pagi/manifest.json \
  | python3 -c 'import json,sys; m=json.load(sys.stdin); print(m["latest"], m["latest_by_scope"])'
```

`latest_by_scope.nasional` harus sama dengan tanggal WIB hari ini. Kalau tidak,
dan tidak ada run — trigger dibuang; jalankan `gh workflow run daily.yml`.

## 5. Tes

Kelas `docs`: tidak ada tes otomatis. Yang diperiksa:

1. Perintah pada §4 dijalankan apa adanya di mesin ini dan hasilnya dibaca —
   bukan sekadar ditulis.
2. Skill memuat bagian tersebut dan menautkan `DEC-0019`/§4.5 untuk
   `latest_by_scope`.

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| Verifikasi hanya berjalan bila ada yang ingat membacanya | ditaruh di skill (dibaca setiap sesi) dan di tabel debugging |
| Perintah `TZ=Asia/Jakarta` tidak portabel | macOS dan Linux GNU mendukung; Windows tidak, dan proyek ini tidak menargetkannya |
| Edisi tetap hilang bila tidak ada sesi di hari itu | diketahui dan diterima pemilik; alternatif cron kedua ditolak secara sadar |

Rollback: hapus bagian dari skill/AGENTS. Tidak ada kode yang berubah.

## 7. Riwayat

- `2026-11-12` — `plan-draft` — usulan awal: penjaga `build.ts` + cron kedua
  06:30 WIB.
- `2026-11-12` — **ditolak pemilik**: “no need to have a second cron, just add to
  the skills to make sure cron is active after deployment.” Rencana diubah ke
  kelas `docs`; penjaga `build.ts` tidak dikerjakan.
- `2026-11-12` — `shipped` — skill, `AGENTS.md` §5/§6/§8 diperbarui.

## 8. Pelajaran

Penjaga yang dipilih manusia harus menangkap kejadian yang benar-benar terjadi.
Di sini kejadiannya bukan “workflow dinonaktifkan”, melainkan “trigger dibuang” —
dan hanya pemeriksaan *run hari ini ada* yang menangkapnya. Verifikasi harus
dipilih dari gejala nyata, bukan dari gejala yang paling mudah diperiksa.

Biaya pilihan ini jujur dicatat: verifikasi manual hanya berjalan bila ada sesi
di hari itu. Cron kedua akan menutup celah itu, tetapi pemilik memilih kesederhanaan
satu jadwal.
