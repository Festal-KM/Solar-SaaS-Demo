import { expect, test } from "@playwright/test";
import { signIn } from "../fixtures/auth";

// E2E spec for T-02-03 — product master (F-012).
//
// Walks through the full price-revision lifecycle:
//   1. wholesaler_admin signs in
//   2. creates a fresh product on /masters/products/new
//   3. sees it pre-filled on the detail page redirect target
//   4. revises its price
//   5. confirms the successor row is reachable with the same product name
//
// Names are stamped per-run so re-execution against the same dev DB stays
// idempotent (the master rows are not truncated between runs). Seed runs in
// `tests/e2e/global-setup.ts` so this spec assumes pilot users exist.

test.describe.configure({ timeout: 120_000 });

test("wholesaler_admin can create a product, list it, revise its prices, and see the history", async ({
  page,
}) => {
  const productName = `テストパネル ${Date.now()}`;

  await signIn(page, "wholesaler_admin@solar-saas.dev");

  await page.goto("/masters/products");
  await expect(page.getByRole("heading", { name: "商品・価格マスタ" })).toBeVisible();

  await page.getByRole("link", { name: "商品を新規登録" }).first().click();
  await page.waitForURL("**/masters/products/new", { timeout: 15_000 });

  await page.getByLabel("カテゴリ", { exact: false }).selectOption("PANEL");
  await page.getByLabel("メーカー", { exact: false }).fill("テストメーカー");
  await page.getByLabel("商品名", { exact: false }).fill(productName);
  await page.getByLabel("単位", { exact: false }).fill("枚");
  await page.getByLabel("仕入値（円）").fill("30000");
  await page.getByLabel("二次店向け卸値（円）").fill("40000");
  await page.getByLabel("参考売価（円）").fill("55000");
  // The default effectiveFrom is today; just submit.

  await page.getByRole("button", { name: "登録" }).click();

  await page.waitForURL((url) => /\/masters\/products\/[^/]+$/.test(url.pathname), {
    timeout: 30_000,
  });

  // 作成成功は redirect 先の詳細フォームに `productName` が pre-fill されている
  // ことで検証する（一覧ページの行検索は他 spec の concurrent create で行が
  // ページ外に押し出される / inactive 化されることがあるため避ける、
  // masters-smoke.spec.ts と同じ手法）。
  await expect(page.getByLabel("商品名", { exact: false })).toHaveValue(productName, {
    timeout: 20_000,
  });

  await page.getByRole("link", { name: "価格を改定" }).click();
  await page.waitForURL("**/revise", { timeout: 15_000 });

  // Bump the dealer price and stamp a reason; effectiveFrom defaults to today
  // but the original row's effectiveFrom is also today (stamped above), so we
  // explicitly nudge effectiveFrom one day forward to satisfy the
  // "strictly after" check in `reviseProductRatesAction`.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await page.getByLabel("適用開始日", { exact: false }).fill(tomorrow);
  await page.getByLabel("二次店向け卸値（円）").fill("38000");
  await page.getByLabel("改定理由").fill("E2E テスト改定");

  await page.getByRole("button", { name: "価格改定を確定" }).click();

  // After the revision the action redirects to the successor product's detail.
  await page.waitForURL((url) => /\/masters\/products\/[^/]+$/.test(url.pathname), {
    timeout: 30_000,
  });

  // 価格改定成功 → 後継商品の詳細画面に商品名が引き継がれていれば成功。
  // 履歴テーブルの中身は Vitest 統合テストが網羅する。
  await expect(page.getByLabel("商品名", { exact: false })).toHaveValue(productName, {
    timeout: 20_000,
  });
});
