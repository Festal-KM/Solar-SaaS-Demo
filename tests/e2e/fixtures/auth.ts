import type { Page } from "@playwright/test";

// Shared authentication helpers for all E2E specs.
//
// Import pattern:
//   import { signIn, PILOT_PASSWORD } from "../fixtures/auth";
//   import { signIn, PILOT_PASSWORD } from "../../fixtures/auth";  // from subdirs

/** Pilot seed password — matches `packages/db/prisma/seed.ts`. */
export const PILOT_PASSWORD = "Pilot!2026";

/**
 * Sign in via the credentials form and wait until the browser has fully left /login
 * and the post-login page has settled (networkidle ensures the session JWT cookie
 * is fully committed before subsequent page.goto() calls).
 */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(PILOT_PASSWORD);
  await page.getByRole("button", { name: "サインイン" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 90_000,
  });
  await page.waitForLoadState("networkidle");
}
