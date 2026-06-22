import { expect, test } from "@playwright/test";
import { signIn } from "../fixtures/auth";

// E2E spec for T-02-09 — SaaS-admin plan management (F-005 / S-016 / S-017).
//
// Happy path: saas_admin signs in, opens /plans, drills into the pilot
// wholesaler tenant, applies a plan change, and confirms the new history
// row is visible afterwards. The seeded pilot wholesaler starts on PILOT,
// so MEDIUM is always a real change (never a no-op on a freshly-seeded DB).

test.describe.configure({ timeout: 90_000 });

// Seed は `tests/e2e/global-setup.ts` で 1 回だけ実行される。

test("saas_admin can change a tenant plan and see the new history row", async ({ page }) => {
  await signIn(page, "saas_admin@solar-saas.dev");

  // List page
  await page.goto("/plans");
  await expect(page.getByRole("heading", { name: "プラン管理" })).toBeVisible();

  // Pilot wholesaler row → detail page. The seed always creates
  // "株式会社サンライズソーラー" so we navigate via that link.
  await page.getByRole("link", { name: "株式会社サンライズソーラー" }).first().click();
  await page.waitForURL(/\/plans\/[^/]+$/, { timeout: 15_000 });

  await expect(page.getByRole("heading", { name: "新プランを適用" })).toBeVisible();

  // Pick a plan that is guaranteed to differ from the seeded "PILOT" so the
  // action takes the real-change branch and inserts a history row.
  await page.getByLabel("新プラン", { exact: false }).selectOption("LARGE");
  await page.getByRole("button", { name: "プラン変更を適用" }).click();

  // After the action `router.refresh()` re-runs the RSC loader. The new
  // history row must appear with planAfter=LARGE.
  await expect(page.getByRole("heading", { name: "変更履歴" })).toBeVisible();
  const historyTable = page.locator("table").last();
  await expect(historyTable.getByText("大")).toBeVisible({ timeout: 15_000 });

  // Billing page should also surface this tenant.
  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: "請求状況（オフライン記録）" })).toBeVisible();
  await expect(page.getByText("株式会社サンライズソーラー")).toBeVisible();
});
