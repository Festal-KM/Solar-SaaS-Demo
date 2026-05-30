import { expect, test } from "@playwright/test";
import { PILOT_PASSWORD } from "../fixtures/auth";

// Post-seed login smoke (T-01-12).
//
// Drives the real Auth.js v5 credentials flow against the dev database after
// running `pnpm db:seed`. We exercise two of the twelve seeded users:
//   - `saas_admin@solar-saas.dev`  (SAAS_ADMIN, twoFactorRequired=true)
//   - `alpha-admin@solar-saas.dev` (DEALER_ADMIN, twoFactorRequired=false)
// so both the 2FA-required and the standard-user branches are covered.
//
// The middleware does not yet enforce MFA gating (lands in T-01-08 / SP-02),
// so on success both users navigate away from /login. We assert exactly that
// — the URL leaves /login — without making claims about the post-login page
// content because /dashboard does not exist until SP-02. The seeded password
// `Pilot!2026` is hard-coded here intentionally; it is the documented pilot
// credential and is NEVER persisted as plaintext on the DB side (verified by
// `packages/db/__tests__/seed.test.ts`).
//
// Seed は `tests/e2e/global-setup.ts` で全 spec 起動前に 1 回だけ実行される。

test.describe("post-seed login", () => {
  // Override the 30s global timeout — login involves an argon2 verify (~80ms)
  // on top of cold-start route compilation in dev mode, which together can
  // exceed 30s on a freshly-started dev server. With `workers: 1` (set in
  // playwright.config.ts) there is no parallel compile competition; the
  // generous 90s budget covers Next.js first-route compile spikes.
  test.describe.configure({ timeout: 90_000 });

  test("saas_admin can sign in with the pilot password", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("メールアドレス").fill("saas_admin@solar-saas.dev");
    await page.getByLabel("パスワード").fill(PILOT_PASSWORD);
    await page.getByRole("button", { name: "サインイン" }).click();

    // Successful credentials → router.push('/dashboard'). The page may 404
    // because /dashboard is wired in SP-02, but the URL change off /login is
    // the load-bearing assertion: it proves Auth.js accepted the credentials
    // (an INVALID_CREDENTIALS result would have kept us on /login with an
    // inline error). We wait for the URL transition with a generous timeout
    // because argon2 verify costs ~80ms on top of the network round trip.
    // 30s timeout: the Next.js dev server compiles route bundles lazily and a
    // cold compile of /dashboard (the post-login redirect target) can take
    // 10–20s under parallel test load on the operator workstation. The dev
    // overhead vanishes once SP-02 introduces `next build` for the test
    // pipeline; until then 15s is too tight when the suite runs alongside
    // login.spec.ts / mfa.spec.ts / locked.spec.ts.
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
    expect(page.url()).not.toContain("/login");
  });

  test("alpha-admin (DEALER_ADMIN) can sign in with the pilot password", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("メールアドレス").fill("alpha-admin@solar-saas.dev");
    await page.getByLabel("パスワード").fill(PILOT_PASSWORD);
    await page.getByRole("button", { name: "サインイン" }).click();

    // 30s timeout: the Next.js dev server compiles route bundles lazily and a
    // cold compile of /dashboard (the post-login redirect target) can take
    // 10–20s under parallel test load on the operator workstation. The dev
    // overhead vanishes once SP-02 introduces `next build` for the test
    // pipeline; until then 15s is too tight when the suite runs alongside
    // login.spec.ts / mfa.spec.ts / locked.spec.ts.
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
    expect(page.url()).not.toContain("/login");
  });
});
