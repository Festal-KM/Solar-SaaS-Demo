import { expect, test } from "@playwright/test";
import { signIn } from "../fixtures/auth";

// E2E spec for T-02-08 — SaaS-admin tenant management (F-004).
//
// Happy path: saas_admin signs in with the pilot password, opens /tenants,
// creates a new wholesaler tenant via the new-tenant form, and confirms the
// detail page heading matches the new tenant name.
//
// Seed は `tests/e2e/global-setup.ts` で全 spec 起動前に 1 回だけ実行される。
// We stamp a unique name + admin email per run so the User.email UNIQUE
// constraint is not violated when the test is rerun against a non-truncated
// dev database.

test.describe.configure({ timeout: 90_000 });

test("saas_admin can create a wholesaler tenant and see it on the list", async ({ page }) => {
  const stamp = Date.now();
  const uniqueName = `テスト卸業者 ${stamp}`;
  const uniqueAdminEmail = `pilot-admin-${stamp}@example.com`;

  await signIn(page, "saas_admin@solar-saas.dev");

  // List page
  await page.goto("/tenants");
  await expect(page.getByRole("heading", { name: "卸業者テナント一覧" })).toBeVisible();

  // Open the new-tenant form
  await page.getByRole("link", { name: "卸業者テナントを新規作成" }).first().click();
  await page.waitForURL("**/tenants/new", { timeout: 15_000 });

  await page.getByLabel("テナント名", { exact: false }).fill(uniqueName);
  await page.getByLabel("プラン", { exact: false }).selectOption("MEDIUM");
  await page.getByLabel("全体管理者メール", { exact: false }).fill(uniqueAdminEmail);
  await page.getByLabel("全体管理者氏名", { exact: false }).fill("テスト管理者");

  await page.getByRole("button", { name: "テナントを作成" }).click();

  // After create the action navigates to the detail page.
  await page.waitForURL((url) => /\/tenants\/[^/]+$/.test(url.pathname), {
    timeout: 30_000,
  });

  // 作成成功は redirect 先の詳細画面 (S-015) のヘディングが新テナント名と
  // 一致することで検証する（list page の visible check は他 spec の
  // concurrent create でページ外に押し出される可能性がある）。
  await expect(page.getByRole("heading", { name: uniqueName, level: 1 })).toBeVisible({
    timeout: 20_000,
  });
});
