import { expect, test } from "@playwright/test";

test.describe("S-001 サインイン", () => {
  test("renders email / password form", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "サインイン" })).toBeVisible();

    const email = page.getByLabel("メールアドレス");
    const password = page.getByLabel("パスワード");
    await expect(email).toBeVisible();
    await expect(password).toBeVisible();
    await expect(email).toHaveAttribute("type", "email");
    await expect(password).toHaveAttribute("type", "password");

    await expect(page.getByRole("button", { name: "サインイン" })).toBeVisible();
  });
});
