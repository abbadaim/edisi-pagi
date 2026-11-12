# 015 — Pemeriksaan jadwal otomatis

```
Status: tested
Kelas: infra
Dibuat: 2026-11-12
Diperbarui: 2026-11-12
Mockup: — (kelas infra; artefak = kontrak §4)
```

---

## 1. Masalah

Rencana 009 menaruh pemeriksaan jadwal di skill dan `AGENTS.md`. Itu berhasil
hanya bila ada orang yang mengingatnya — dan kejadian 2026-11-12 justru
memperlihatkan bahwa tidak ada yang tahu selama berjam-jam.

Trigger terjadwal GitHub bisa dibuang tanpa mengubah status workflow, tanpa
notifikasi. Pemeriksaan manual tidak menutup celah itu; ia hanya mendokumentasikan
celahnya.

## 2. Keputusan yang akan diambil

Memeriksa **hasil**, bukan niatnya: manifest live harus memuat edisi hari ini
(WIB). Kalau tidak, jalankan `daily.yml` sekali.

Bukan yang dilakukan: membaca status workflow (`active` tetap `active` saat
trigger dibuang — 2026-11-12 membuktikannya).

## 3. Rencana

1. `src/core/schedule-check.ts` — `scheduleVerdict(manifest, todayWib)`: fungsi
   murni, tanpa jam dan tanpa jaringan.
2. `scripts/check-schedule.ts` — ambil manifest live, cetak keputusan.
   Exit `0` ada · `10` tidak ada · `2` tidak bisa diperiksa.
3. `.github/workflows/schedule-check.yml` — cron `15 0 * * *` (07:15 WIB, dua jam
   setelah jadwal utama). Bila `10`, jalankan `daily.yml` — kecuali ada run yang
   masih berjalan.
4. `tests/schedule-check.test.ts` — enam kasus keputusan.

## 4. Kontrak

```
$ node scripts/check-schedule.ts
jadwal: hari ini 2026-11-12 · manifest 2026-11-12 · edisi hari ini sudah terbit
$ echo $?
0
```

```
$ MANIFEST_URL=http://127.0.0.1:1/manifest.json node scripts/check-schedule.ts
tidak bisa membaca manifest (fetch failed) — http://127.0.0.1:1/manifest.json
$ echo $?
2
```

| Keadaan | Exit | Tindakan workflow |
|---|---|---|
| edisi hari ini ada | 0 | tidak ada |
| edisi hari ini tidak ada | 10 | `gh workflow run daily.yml` |
| manifest tidak terbaca | 2 | peringatan; **tidak** menjalankan build |

Exit `2` sengaja tidak memicu build: kalau manifest tidak terbaca, kita tidak
tahu keadaannya, dan menerbitkan ulang tanpa alasan lebih berbahaya daripada
menunggu.

## 5. Tes

`tests/schedule-check.test.ts`: hari ini ada; hilang; `latest_by_scope` menang
atas `latest`; manifest kosong; manifest lebih baru (bukan kegagalan); `null` aman.

Dijalankan nyata terhadap manifest live (`2026-11-12`) → exit 0; dan terhadap
URL mati → exit 2.

`npm test` = **266 lulus**.

## 6. Risiko dan rollback

| Risiko | Mitigasi |
|---|---|
| Dispatch dobel saat build masih berjalan | cek `--status in_progress` sebelum dispatch |
| Dispatch pada tanggal yang sudah terbit | pemeriksaan membandingkan manifest live, bukan tanggal lokal; `daily.yml` hanya dipanggil bila tanggal itu belum ada |
| Jam WIB salah | `todayWib` dihitung dari UTC+7, bukan zona mesin |
| Workflow baru jadi sumber kegagalan lain | exit 2 tidak memicu apa pun; hanya `10` yang memicu |

Rollback: hapus workflow; skrip tetap berguna untuk pemeriksaan manual.

## 7. Riwayat

- `2026-11-12` — `plan-draft` — melanjutkan rencana 009 (yang berhenti di
  dokumentasi manual).
- `2026-11-12` — `mockup-approved` — disetujui lewat instruksi: “do both”.
- `2026-11-12` — `tested` — 6 uji, verifikasi terhadap manifest live dan URL mati.

## 8. Pelajaran

Aturan yang bergantung pada ingatan manusia adalah aturan yang akan dilanggar
pada hari paling sibuk. Perbaikannya bukan menulis aturan lebih tebal, melainkan
memindahkannya ke mesin yang tidak lelah — dan membuat mesin itu memeriksa
**gejala** (edisi tidak terbit), bukan **proksi** (status workflow `active`).
