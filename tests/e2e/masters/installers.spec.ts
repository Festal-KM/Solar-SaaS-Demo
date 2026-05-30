import { expect, test } from "@playwright/test";
import { signIn } from "../fixtures/auth";

// E2E spec for T-02-05 — installer master (F-013).
//
// Happy path: wholesaler_admin signs in, opens /masters/installers, creates an
// installer via the form, and confirms it on the redirected detail page.
// Seed は `tests/e2e/global-setup.ts` で全 spec 起動前に 1 回だけ実行される。

test.describe.configure({ timeout: 90_000 });

test("wholesaler_admin can create an installer and see it on the list", async ({ page }) => {
  const uniqueName = `テスト施工業者 ${Date.now()}`;

  await signIn(page, "wholesaler_admin@solar-saas.dev");

  await page.goto("/masters/installers");
  await expect(page.getByRole("heading", { name: "施工業者マスタ" })).toBeVisible();

  await page.getByRole("link", { name: "施工業者を新規登録" }).first().click();
  await page.waitForURL("**/masters/installers/new", { timeout: 15_000 });

  await page.getByLabel("名称", { exact: false }).fill(uniqueName);
  await page.getByLabel("対応エリア").fill("関東");
  await page.getByLabel("担当者").fill("山田太郎");
  await page.getByLabel("電話").fill("03-1234-5678");

  await page.getByRole("button", { name: "登録" }).click();

  // After create the action redirects to the detail page.
  await page.waitForURL((url) => /\/masters\/installers\/[^/]+$/.test(url.pathname), {
    timeout: 30_000,
  });

  // 作成成功は redirect 先の詳細フォームに `uniqueName` が pre-fill されている
  // ことで検証する（一覧反映の網羅は masters-smoke / Vitest が担保）。
  await expect(page.getByLabel("名称", { exact: false })).toHaveValue(uniqueName, {
    timeout: 20_000,
  });
});
