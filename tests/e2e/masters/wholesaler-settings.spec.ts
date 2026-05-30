import { expect, test } from "@playwright/test";
import { signIn } from "../fixtures/auth";

// E2E spec for T-02-07 — wholesaler-settings (F-015 / F-016).
//
// Happy path: wholesaler_admin signs in, opens /masters/wholesaler-settings,
// edits the three fields, saves, and sees the new values persisted after a
// page reload.

test.describe.configure({ timeout: 90_000 });

// Seed は `tests/e2e/global-setup.ts` で 1 回だけ実行される。

test("wholesaler_admin can edit wholesaler settings and see them persisted", async ({ page }) => {
  await signIn(page, "wholesaler_admin@solar-saas.dev");

  await page.goto("/masters/wholesaler-settings");
  await expect(page.getByRole("heading", { name: "卸業者設定" })).toBeVisible();

  // Edit all three fields to non-default values.
  const cancelInput = page.getByLabel("キャンセル期限（日数）", { exact: false });
  await cancelInput.fill("14");

  const fiscalSelect = page.getByLabel("年度開始月", { exact: false });
  await fiscalSelect.selectOption("1");

  const piiSelect = page.getByLabel("PII マスキングモード", { exact: false });
  await piiSelect.selectOption("PARTIAL");

  await page.getByRole("button", { name: "保存" }).click();

  // After save router.refresh() re-renders the RSC; assert the new values are
  // still set by reloading and re-reading the form values.
  await page.waitForLoadState("networkidle");
  await page.reload();

  await expect(page.getByLabel("キャンセル期限（日数）", { exact: false })).toHaveValue("14");
  await expect(page.getByLabel("年度開始月", { exact: false })).toHaveValue("1");
  await expect(page.getByLabel("PII マスキングモード", { exact: false })).toHaveValue("PARTIAL");

  // Restore defaults so subsequent test runs see a clean baseline.
  await page.getByLabel("キャンセル期限（日数）", { exact: false }).fill("8");
  await page.getByLabel("年度開始月", { exact: false }).selectOption("4");
  await page.getByLabel("PII マスキングモード", { exact: false }).selectOption("MASKED");
  await page.getByRole("button", { name: "保存" }).click();
  await page.waitForLoadState("networkidle");
});
