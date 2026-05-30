import { expect, test } from "@playwright/test";

// MFA flows require an authenticated session (the actions redirect to /login
// otherwise — see `apps/web/app/(auth)/mfa/actions.ts`). For this SP-01 smoke
// pass we assert that the routes resolve and the auth Server Action gate
// kicks in. Full happy-path E2E lands once T-01-12 seeds + the credentials
// fixture is wired.

test.describe("S-002 / S-003 MFA", () => {
  test("/mfa renders the challenge form for an unauthenticated visit", async ({ page }) => {
    await page.goto("/mfa");
    await expect(page.getByRole("heading", { name: "2 段階認証コードを入力" })).toBeVisible();
    await expect(page.getByLabel("認証コード")).toBeVisible();
  });

  test("/mfa/setup renders the loading state for an unauthenticated visit", async ({ page }) => {
    await page.goto("/mfa/setup");
    await expect(page.getByRole("heading", { name: "2 段階認証の初回セットアップ" })).toBeVisible();
  });
});
