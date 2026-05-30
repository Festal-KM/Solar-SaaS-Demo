import { expect, test } from "@playwright/test";

test.describe("S-006 ロック画面", () => {
  test("renders the lockout notice", async ({ page }) => {
    await page.goto("/locked");
    await expect(
      page.getByText("アカウントは一時的にロックされています", { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "サインインへ戻る" })).toBeVisible();
  });

  test("shows remaining time when ?until is set", async ({ page }) => {
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await page.goto(`/locked?until=${encodeURIComponent(future)}`);
    await expect(page.getByText("再試行可能まで残り", { exact: false })).toBeVisible();
  });
});
