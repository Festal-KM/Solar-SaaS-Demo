import { expect, test } from "@playwright/test";
import { signIn } from "../fixtures/auth";

// E2E spec for T-02-06 — incentive-rate master (F-014).
//
// Happy path: wholesaler_admin signs in, opens /masters/incentive-rates,
// creates a rate via the form (PROJECT_PROFIT / rate / effectiveFrom against
// the first available dealer relationship), and confirms the rate value on
// the redirected detail page form.
// Seed は `tests/e2e/global-setup.ts` で全 spec 起動前に 1 回だけ実行される。

test.describe.configure({ timeout: 90_000 });

test("wholesaler_admin can create an incentive rate and see it on the list", async ({ page }) => {
  // Stamp a unique rate value (string-formatted, two decimals) so re-runs don't
  // collide with previously-seeded data.
  const stamp = (Date.now() % 9000) / 100; // 0.00 .. 89.99
  const uniqueRate = stamp.toFixed(2);

  await signIn(page, "wholesaler_admin@solar-saas.dev");

  await page.goto("/masters/incentive-rates");
  await expect(page.getByRole("heading", { name: "インセンティブ率マスタ" })).toBeVisible();

  await page.getByRole("link", { name: "インセンティブ率を新規登録" }).first().click();
  await page.waitForURL("**/masters/incentive-rates/new", { timeout: 15_000 });

  // Pick the first available relationship (the select is rendered with all
  // active relationships from the pilot wholesaler seed).
  // The default option is already the first relationship — no explicit
  // selection needed. We do explicitly pick PROJECT_PROFIT for stability.
  await page.getByLabel("対象粗利種別").selectOption("PROJECT_PROFIT");
  await page.getByLabel("率（%）", { exact: false }).fill(uniqueRate);
  // effectiveFrom — pick today + 30 days so we don't clash with any seeded
  // open row's effectiveFrom (relevant when overlap-close kicks in).
  const today = new Date();
  const future = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const iso = future.toISOString().slice(0, 10);
  await page.getByLabel("適用開始日").fill(iso);

  await page.getByRole("button", { name: "登録" }).click();

  // After create the action redirects to the detail page.
  await page.waitForURL((url) => /\/masters\/incentive-rates\/[^/]+$/.test(url.pathname), {
    timeout: 30_000,
  });

  // 作成成功は redirect 先の詳細フォームの「率（%）」input が `uniqueRate` で
  // pre-fill されていることで検証する（一覧の dealer-grouped table は他 spec の
  // concurrent create で行の位置がずれることがあるため）。
  await expect(page.getByLabel("率（%）", { exact: false })).toHaveValue(uniqueRate, {
    timeout: 20_000,
  });
});
