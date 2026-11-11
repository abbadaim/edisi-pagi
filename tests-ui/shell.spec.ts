/**
 * Suite browser — lapisan atas dari `DEC-0014`.
 *
 * Annex `docs/plans/001-ui-test-harness.md` §4:
 *   UI-03 nav bawah + halaman Atur
 *   UI-04 edisi fixture ter-render
 *   UI-06 shell tetap tampil offline (SW v4)
 *   UI-07 chip "Kata yang hilang dari judul" pada kartu misread
 *
 * Rencana `docs/plans/008-arsip-dan-gestur-kembali.md`:
 *   UI-10 back dari detail mempertahankan posisi baca
 *   UI-11 tautan langsung ke kartu
 *   UI-12 arsip dan pembukaan edisi lama
 *   UI-13 boot tidak menambah entri history
 *   UI-14 arsip offline menandai edisi yang belum tersimpan
 *   UI-15 detail menyembunyikan header feed
 *
 * Asersi tanpa browser ada di `tests/ui-static.test.ts` dan ikut `npm test`.
 * Yang di sini butuh DOM, JavaScript, atau service worker sungguhan.
 */
import { expect, test, type Page } from "@playwright/test";

/** Tunggu boot selesai: dateline berhenti "Memuat…" dan feed terisi. */
async function openFeed(page: Page): Promise<void> {
  await page.goto("./");
  await expect(page.locator("#dateline")).not.toHaveText("Memuat…", { timeout: 20_000 });
  await expect(page.locator("#empty")).toBeHidden();
}

test("UI-03: nav bawah dan halaman Atur", async ({ page }) => {
  await openFeed(page);

  const bar = page.locator("#bottom");
  await expect(bar).toBeVisible();
  await expect(bar.locator('.it[data-nav="atur"]')).toContainText("Atur");

  await bar.locator('.it[data-nav="atur"]').click();

  await expect(page).toHaveURL(/#\/atur$/);
  await expect(page.locator("#atur")).toBeVisible();
  await expect(page.locator("#bottom .it.on")).toHaveAttribute("data-nav", "atur");
  for (const label of ["Pasang", "Notifikasi", "Tentang"]) {
    await expect(page.locator("#atur .plbl").filter({ hasText: label })).toBeVisible();
  }
});

test("UI-04: edisi fixture ter-render", async ({ page }) => {
  await openFeed(page);

  // Subline: "8 kartu · ±20 menit · Nasional" — bukti jalur data jalan.
  await expect(page.locator("#subline")).toContainText("kartu");

  const cards = page.locator("#feed button.card");
  expect(await cards.count()).toBeGreaterThan(3);
  await expect(cards.first()).toBeVisible();
  await expect(cards.first().locator("h2")).not.toBeEmpty();
});

test("UI-06: shell tetap tampil offline", async ({ page, context }) => {
  await openFeed(page);

  // Tunggu service worker aktif, lalu muat ulang sekali saat masih online
  // supaya shell dan datanya masuk cache.
  await page.waitForFunction("navigator.serviceWorker.ready.then((r) => !!r.active)");
  await page.reload();
  await expect(page.locator("#dateline")).not.toHaveText("Memuat…", { timeout: 20_000 });

  await context.setOffline(true);
  await page.reload();

  // Shell dari cache: nav harus tetap tampil walau jaringan mati.
  await expect(page.locator("#bottom")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#bottom .it").first()).toBeVisible();
  await expect(page.locator("#feed button.card").first()).toBeVisible({ timeout: 20_000 });

  await context.setOffline(false);
});

test("UI-07: kartu misread menampilkan kata yang hilang dari judul", async ({ page }) => {
  await openFeed(page);

  const card = page.locator("#feed button.card").filter({ hasText: "Yang hilang dari judul" });
  await expect(card).toHaveCount(1);
  await card.click();

  await expect(page.locator("#detail")).toBeVisible();
  await expect(page.locator("#detailbody .dtitle")).toContainText("Yang hilang dari judul");
  await expect(page.locator("#detailbody .missing .lbl")).toHaveText("Kata yang hilang dari judul");
  expect(await page.locator("#detailbody .missing .chip").count()).toBeGreaterThan(0);
});

// UI-10 — rencana 008
// Gestur back Android/iOS mengirim navigasi history yang sama dengan
// page.goBack(). Sebelum perbaikan, hash berubah tapi detail tetap di layar
// karena S.view masih "feed".
test("UI-10: back dari detail kembali ke feed dan mempertahankan posisi gulir", async ({ page }) => {
  await openFeed(page);

  await page.evaluate("window.scrollTo(0, 600)");
  // Kartu yang dibaca harus terlihat sebelum dibuka — itu patokan posisi.
  const card = page.locator("#feed button.card").nth(3);
  await expect(card).toBeInViewport();

  // dispatchEvent tidak menggulir halaman seperti click(), jadi posisi baca
  // yang diuji adalah posisi sebelum detail dibuka.
  await card.dispatchEvent("click");
  await expect(page.locator("#detail")).toBeVisible();
  await expect(page).toHaveURL(/#\/nasional\/2026-11-11\/3$/);

  await page.goBack();

  await expect(page.locator("#detail")).toBeHidden();
  await expect(page.locator("#feed")).toBeVisible();

  // Gambar fixture bisa gagal dimuat sehingga tinggi kartu berubah dan
  // `scrollY` bergeser. Yang dikunci: pembaca kembali ke kartu yang sama,
  // bukan ke atas feed.
  await expect(card).toBeInViewport();
  expect(await page.evaluate("Math.round(window.scrollY)")).toBeGreaterThan(0);
});

// UI-11 — rencana 008
// Sebelum perbaikan, boot menimpa hash dengan #/<scope>, jadi tautan ke kartu
// berakhir di feed.
test("UI-11: tautan langsung ke kartu membuka kartu itu", async ({ page }) => {
  await page.goto("./#/nasional/2026-11-11/2");
  await expect(page.locator("#dateline")).not.toHaveText("Memuat…", { timeout: 20_000 });

  await expect(page.locator("#detail")).toBeVisible();
  await expect(page.locator("#feed")).toBeHidden();
  await expect(page.locator("#navlabel")).toContainText("kartu 3 dari 8");
  await expect(page.locator("#navlabel")).toContainText("Nov");
});

// UI-12 — rencana 008
// Arsip membaca seluruh manifest, bukan hanya edisi `latest_by_scope`.
test("UI-12: arsip menampilkan edisi lama dan membukanya", async ({ page }) => {
  await openFeed(page);

  await page.locator('#bottom .it[data-nav="arsip"]').click();
  await expect(page.locator("#arsip")).toBeVisible();
  await expect(page).toHaveURL(/#\/arsip$/);

  await expect(page.locator("#arsip .arsipItem")).toHaveCount(4);
  await expect(page.locator("#arsip .arsipDayDate").first()).toContainText("11 November 2026");
  await expect(page.locator("#arsip .arsipItem[data-edition='2026-11-11'][data-scope='nasional']"))
    .toHaveAttribute("aria-current", "true");
  // Dua tanggal belum melewati batas 30, jadi tombol muat lebih banyak tidak ada.
  await expect(page.locator("#arsip .arsipMore")).toHaveCount(0);

  await page.locator("#arsip .arsipItem[data-edition='2026-10-31'][data-scope='nasional']").click();

  await expect(page).toHaveURL(/#\/nasional\/2026-10-31$/);
  await expect(page.locator("#feed")).toBeVisible();
  await expect(page.locator("#dateline")).toContainText("31 Oktober");
  await expect(page.locator("#subline")).toContainText("Nasional");
});

// UI-13 — rencana 008
// Boot dulu menulis hash dengan push, jadi back pertama dari feed meninggalkan
// aplikasi (di PWA terpasang: aplikasi tertutup).
test("UI-13: boot tidak menambah entri history", async ({ page }) => {
  await openFeed(page);
  expect(await page.evaluate("history.length")).toBe(2);
  await expect(page).toHaveURL(/#\/nasional$/);
});

// UI-14 — rencana 008
// Arsip tetap tampil offline dari manifest ter-cache; edisi yang belum pernah
// dibuka ditandai, bukan dijanjikan bisa dibaca.
test("UI-14: arsip offline menandai edisi yang belum tersimpan", async ({ page, context }) => {
  await openFeed(page);

  await context.setOffline(true);
  await page.waitForFunction("navigator.onLine === false");

  await page.locator('#bottom .it[data-nav="arsip"]').click();
  await expect(page.locator("#arsip")).toBeVisible();
  await expect(page.locator("#arsip .arsipItem.off").first()).toBeVisible();
  await expect(page.locator("#arsip .arsipItem[data-edition='2026-10-31'][data-scope='nasional']"))
    .toBeDisabled();
  await expect(page.locator("#arsip .arsipItem.off").first()).toContainText("Belum tersimpan offline");

  await context.setOffline(false);
});

// UI-15 — rencana 008
// Header feed (tanggal besar, jumlah kartu, liputan) tidak ditampilkan di detail.
test("UI-15: detail menyembunyikan header feed dan menyebut tanggal di label", async ({ page }) => {
  await openFeed(page);
  await expect(page.locator("#top")).toBeVisible();

  await page.locator("#feed button.card").first().click();
  await expect(page.locator("#detail")).toBeVisible();
  await expect(page.locator("#top")).toBeHidden();
  await expect(page.locator("#navlabel")).toContainText("kartu 1 dari 8");
  await expect(page.locator("#navlabel")).toContainText("Nov");

  await page.goBack();
  await expect(page.locator("#top")).toBeVisible();
  await expect(page.locator("#dateline")).toContainText("11 November");
});
