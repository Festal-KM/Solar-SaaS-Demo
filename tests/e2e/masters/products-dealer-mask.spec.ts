import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";
import { signIn } from "../fixtures/auth";

// E2E spec for T-02-04 — dealer-side `purchasePrice` mask on
// `GET /api/products/active` (F-012 / docs/03 §4.3 / docs/05 §6.5).
//
// The integration test (`apps/web/app/api/products/__tests__/active.test.ts`)
// exercises the masking with mocked session + DB. This spec is the live-wire
// counterpart: real Auth.js cookie, real Postgres, real Next.js handler.
//
// Flow:
//   1. Re-run `pnpm db:seed` for a deterministic dataset.
//   2. Sign in as wholesaler_admin via the UI and create one product (the
//      seed doesn't populate Product rows; the dealer-mask check is only
//      meaningful with at least one row in the catalogue).
//   3. Sign out, sign in as `alpha-admin@solar-saas.dev` (DEALER_ADMIN).
//   4. Use the same session cookie to call `/api/products/active` via
//      Playwright's `request` context so we observe the raw JSON.
//   5. Assert: every product row in the response has NO `purchasePrice`
//      key — docs/03 §4.3 forbids leaking the wholesaler's cost.

test.describe.configure({ timeout: 120_000 });

async function ensureSeedProductExists(page: Page, productName: string): Promise<void> {
  // Create one product as wholesaler_admin so the dealer's GET has at least
  // one row to inspect. The default `effectiveFrom` on the form is "today",
  // which makes the row immediately effective for any subsequent GET.
  await signIn(page, "wholesaler_admin@solar-saas.dev");
  await page.goto("/masters/products/new");
  await page.waitForURL("**/masters/products/new", { timeout: 30_000 });

  await page.getByLabel("カテゴリ", { exact: false }).selectOption("PANEL");
  await page.getByLabel("メーカー", { exact: false }).fill("マスクテスト メーカー");
  await page.getByLabel("商品名", { exact: false }).fill(productName);
  await page.getByLabel("単位", { exact: false }).fill("枚");
  await page.getByLabel("仕入値（円）").fill("31000");
  await page.getByLabel("二次店向け卸値（円）").fill("41000");
  await page.getByLabel("参考売価（円）").fill("56000");

  await page.getByRole("button", { name: "登録" }).click();

  await page.waitForURL((url) => /\/masters\/products\/[^/]+$/.test(url.pathname), {
    timeout: 30_000,
  });
}

// Seed は `tests/e2e/global-setup.ts` で 1 回だけ実行される。

test("dealer_admin sees no purchasePrice key on GET /api/products/active", async ({
  page,
  baseURL,
}) => {
  const productName = `マスクテスト商品 ${Date.now()}`;
  await ensureSeedProductExists(page, productName);

  // Sign out path: re-navigate to /login then sign in as the dealer. The
  // explicit re-login establishes the dealer session cookie cleanly without
  // relying on signOut UI surfaces that may not be wired yet.
  await page.context().clearCookies();
  await signIn(page, "alpha-admin@solar-saas.dev");

  // Reuse the page's session cookies inside a Playwright `request` context so
  // the GET goes through the same authenticated origin. We avoid `page.goto`
  // because Next emits the JSON body but the browser tries to render it.
  const cookies = await page.context().cookies();
  const requestCtx: APIRequestContext = await request.newContext({
    baseURL: baseURL!,
    extraHTTPHeaders: {
      cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    },
  });

  const res = await requestCtx.get("/api/products/active");
  expect(res.status(), `unexpected status: ${res.status()}\n${await res.text()}`).toBe(200);

  const body = (await res.json()) as {
    asOf: string;
    products: Array<Record<string, unknown>>;
  };

  expect(Array.isArray(body.products)).toBe(true);
  expect(body.products.length).toBeGreaterThan(0);

  for (const row of body.products) {
    // docs/03 §4.3: dealer-visible payloads MUST NOT carry `purchasePrice`.
    // We assert the key is physically absent (not just `undefined`).
    expect(
      Object.keys(row).includes("purchasePrice"),
      `purchasePrice leaked to dealer for product id=${String(row.id)}: ${JSON.stringify(row)}`,
    ).toBe(false);
    // The non-sensitive fields must remain so dealers can still pick from
    // the catalogue (docs/02 §F-012).
    expect(row).toHaveProperty("dealerPrice");
    expect(row).toHaveProperty("listPrice");
  }

  await requestCtx.dispose();
});
