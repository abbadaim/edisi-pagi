/**
 * Suite browser — lapisan atas dari `DEC-0014`.
 *
 * Annex `docs/plans/001-ui-test-harness.md` §4:
 *   UI-03 nav bawah + halaman Atur
 *   UI-04 edisi fixture ter-render
 *   UI-06 shell tetap tampil offline (SW v4)
 *   UI-07 chip "Kata yang hilang dari judul" pada kartu misread
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
