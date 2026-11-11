import { defineConfig, devices } from "@playwright/test";

/**
 * Suite browser (`DEC-0013`, `DEC-0014`).
 *
 * Server: `scripts/serve.ts` dengan `BASE_PATH=/edisi-pagi`, yaitu subpath
 * produksi — bukan akar domain. Tanpa itu, bug path absolut tidak tereproduksi
 * dan suite bisa lulus sambil menguji konfigurasi yang salah.
 *
 * Data: `fixtures/ui/public/` hasil `scripts/prepare-ui-fixture.ts`. Tidak
 * menyentuh edisi terbit dan tidak memakai jaringan keluar.
 */
const PORT = Number(process.env.UI_TEST_PORT ?? 8099);
const BASE_PATH = "/edisi-pagi";

export default defineConfig({
  testDir: "./tests-ui",
  // Service worker dan cache bersifat global per origin. Satu worker, berurutan,
  // supaya keadaan tiap tes tidak saling menular.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}${BASE_PATH}/`,
    trace: "on-first-retry",
    viewport: { width: 390, height: 844 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/serve.ts",
    url: `http://127.0.0.1:${PORT}${BASE_PATH}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      BASE_PATH,
      ROOT: "fixtures/ui/public",
    },
  },
});
