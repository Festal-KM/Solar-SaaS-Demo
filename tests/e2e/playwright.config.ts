import { defineConfig, devices } from "@playwright/test";

// Smoke-test config for SP-01 T-01-09 → SP-02 T-02-12 を含む全 E2E スイート.
//
// `pnpm -F @solar/web dev` を spawn し、認証から各マスタ CRUD までを通す。
// Port defaults to 3100 (3000 collides with Grafana on the operator workstation);
// override with `PLAYWRIGHT_PORT` if needed.
//
// **Worker 並列化は明示的に無効化している**（`workers: 1` + `fullyParallel: false`）。
// 経緯: SP-02 完了確認時に並列実行で 7 spec が間欠失敗（Next.js dev server の
// cold-compile 飽和、`pnpm db:seed` の spawn race、shared masters tables への
// 同時書き込み competition）。意思決定ログ (docs/dev-plan.md §6, 2026-05-25) で
// 「並列 worker を 1 に固定」と確定済。SP-03 以降の追加 spec も本ポリシーを継承する。
// シードは worker spawn ではなく `globalSetup` で 1 回だけ実行する。

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  globalSetup: require.resolve("./global-setup"),

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: `pnpm -F @solar/web dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
