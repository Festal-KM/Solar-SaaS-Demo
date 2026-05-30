import { expect, test } from "@playwright/test";
import { signIn } from "./fixtures/auth";

// E2E spec for T-05-12 — UC-02 後半 + UC-03
// (F-038 / F-040 / F-041 / F-042 / F-044 / F-045).
//
// 商談 → 契約成立 → 契約明細（価格スナップショット）→ 粗利計算
// + スナップショット不変性検証（商品マスタ改定後も過去明細の価格は変わらない）
// + 施工レコード作成 + 補助金申請作成
//
// Steps:
//   Setup-1   wholesaler_admin   : 顧客登録 → 顧客 ID 取得
//   Setup-2   wholesaler_admin   : 商品登録 → 商品 ID 取得（スナップショット検証用）
//   Step-1    wholesaler_admin   : 商談新規登録 → 商談 ID 取得
//   Step-2    wholesaler_admin   : 商談ステータスを 6 段階遷移（VISIT_PLANNED → LIKELY_CONTRACT）
//   Step-3    wholesaler_admin   : 契約登録（LIKELY_CONTRACT → CONTRACTED）
//   Step-4    wholesaler_admin   : 契約明細登録（商品 1 件）
//   Step-5    wholesaler_admin   : 粗利計算（再計算実行）
//   Step-6    wholesaler_admin   : 商品マスタ価格改定（スナップショット不変性前提）
//   Step-7    wholesaler_admin   : 過去契約明細の価格が不変であることを確認
//   Step-8    wholesaler_admin   : 施工レコード作成
//   Step-9    wholesaler_admin   : 補助金申請作成
//
// 前提: globalSetup が pnpm db:seed を実行済み（pilotWholesaler と各ユーザーが存在）。

const RUN_ID = Date.now();

// Module-level state shared across serial steps.
let customerId = "";
let productId = "";
let productName = "";
let dealId = "";
let contractId = "";

// Prices recorded BEFORE the product revision — used in the invariance assertion.
let snapshotDealerPrice = "";
let snapshotListPrice = "";

// ---------------------------------------------------------------------------
// UC-02 + UC-03 — serial, shared state
// ---------------------------------------------------------------------------

test.describe.serial("UC-02/03 — 商談 → 契約 → 明細 → 粗利 → スナップショット不変性", () => {
  test.describe.configure({ timeout: 180_000 });

  // -------------------------------------------------------------------------
  // Setup-1: wholesaler_admin が顧客を登録
  // -------------------------------------------------------------------------

  test("setup-1: wholesaler_admin registers a customer", async ({ page }) => {
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    await page.goto("/customers/new");
    await expect(page.getByRole("heading", { name: "顧客を新規登録" })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByLabel("氏名").fill(`UC-03 テスト顧客 ${RUN_ID}`);
    await page.getByLabel("電話番号").fill(`090${String(RUN_ID).slice(-8)}`);
    await page.getByLabel("獲得チャネル").selectOption("WALK_IN");

    await page.getByRole("button", { name: "登録" }).click();

    // After redirect to /customers list, find our customer row.
    await page.waitForURL((url) => url.pathname === "/customers", {
      timeout: 60_000,
    });
    await expect(page.getByRole("heading", { name: "顧客一覧" })).toBeVisible({ timeout: 30_000 });

    // Find the customer we just created by searching.
    await page.goto(`/customers?query=UC-03+テスト顧客+${RUN_ID}`);
    await page.waitForLoadState("networkidle");

    const firstLink = page.locator("table tbody tr:first-child td:first-child a");
    await expect(firstLink).toBeVisible({ timeout: 20_000 });
    const href = await firstLink.getAttribute("href");
    const m = href?.match(/\/customers\/([A-Za-z0-9_-]+)/);
    expect(m, "顧客一覧から ID を取得できなかった").not.toBeNull();
    customerId = m![1]!;
    expect(customerId).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Setup-2: 商品を登録（スナップショット不変性検証用）
  // -------------------------------------------------------------------------

  test("setup-2: wholesaler_admin registers a product for snapshot test", async ({ page }) => {
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    productName = `UC-03 テスト商品 ${RUN_ID}`;

    await page.goto("/masters/products/new");
    await expect(page.getByRole("heading", { name: "商品を新規登録" })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByLabel("カテゴリ", { exact: false }).selectOption("PANEL");
    await page.getByLabel("メーカー", { exact: false }).fill("UC-03 メーカー");
    await page.getByLabel("商品名", { exact: false }).fill(productName);
    await page.getByLabel("単位", { exact: false }).fill("枚");
    await page.getByLabel("仕入値（円）").fill("30000");
    await page.getByLabel("二次店向け卸値（円）").fill("40000");
    await page.getByLabel("参考売価（円）").fill("55000");

    await page.getByRole("button", { name: "登録" }).click();

    // After submit, redirect to product detail.
    await page.waitForURL((url) => /\/masters\/products\/[A-Za-z0-9_-]+$/.test(url.pathname), {
      timeout: 30_000,
    });
    const match = page.url().match(/\/masters\/products\/([A-Za-z0-9_-]+)/);
    expect(match, "商品 ID が URL から取得できなかった").not.toBeNull();
    productId = match![1]!;
    expect(productId).toBeTruthy();

    // Confirm the product name is shown in the form.
    await expect(page.getByLabel("商品名", { exact: false })).toHaveValue(productName, {
      timeout: 20_000,
    });
  });

  // -------------------------------------------------------------------------
  // Step-1: 商談新規登録
  // -------------------------------------------------------------------------

  test("step-1: wholesaler_admin creates a deal for the customer", async ({ page }) => {
    expect(customerId, "Setup-1 で顧客 ID を取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    await page.goto(`/deals/new?customerId=${customerId}`);
    await expect(page.getByRole("heading", { name: "商談を新規登録" })).toBeVisible({
      timeout: 30_000,
    });

    // The customer name should be shown.
    await expect(page.getByText(`UC-03 テスト顧客 ${RUN_ID}`, { exact: false })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: "新規作成" }).click();

    // After redirect to /deals/<id>.
    await page.waitForURL(/\/deals\/[A-Za-z0-9_-]+$/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "商談詳細" })).toBeVisible({ timeout: 30_000 });

    const match = page.url().match(/\/deals\/([A-Za-z0-9_-]+)/);
    expect(match, "商談 ID が URL から取得できなかった").not.toBeNull();
    dealId = match![1]!;
    expect(dealId).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Step-2: 商談ステータスを LIKELY_CONTRACT まで 6 段階遷移
  //   VISIT_PLANNED → VISITED → PROPOSING → QUOTED → CONSIDERING → LIKELY_CONTRACT
  // -------------------------------------------------------------------------

  test("step-2: wholesaler_admin advances deal status to LIKELY_CONTRACT", async ({ page }) => {
    expect(dealId, "Step-1 で商談 ID を取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    const transitions: Array<{ button: string; label: string }> = [
      { button: "訪問済み", label: "VISITED へ遷移" },
      { button: "提案中", label: "PROPOSING へ遷移" },
      { button: "見積提出", label: "QUOTED へ遷移" },
      { button: "検討中", label: "CONSIDERING へ遷移" },
      { button: "契約見込み", label: "LIKELY_CONTRACT へ遷移" },
    ];

    for (const t of transitions) {
      await page.goto(`/deals/${dealId}`);
      await expect(page.getByRole("heading", { name: "商談詳細" })).toBeVisible({
        timeout: 30_000,
      });

      const btn = page.getByRole("button", { name: t.button });
      await expect(btn, `${t.label}: ボタン "${t.button}" が見つからない`).toBeVisible({
        timeout: 20_000,
      });
      await btn.click();
      await page.waitForLoadState("networkidle");
    }

    // Verify final status is LIKELY_CONTRACT — "契約見込み" text should appear
    // and the "契約" button (for CONTRACTED transition) should be visible.
    await page.goto(`/deals/${dealId}`);
    await expect(page.getByText("契約見込み", { exact: false }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: "契約" })).toBeVisible({ timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // Step-3: 契約登録（LIKELY_CONTRACT → CONTRACTED）
  // -------------------------------------------------------------------------

  test("step-3: wholesaler_admin registers a contract", async ({ page }) => {
    expect(dealId, "Step-1 で商談 ID を取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    await page.goto(`/contracts/new?dealId=${dealId}`);
    await expect(page.getByRole("heading", { name: "契約を登録" })).toBeVisible({
      timeout: 30_000,
    });

    // Contract date (defaults to today — leave as-is)
    // Total amount
    await page.locator("#totalAmount").fill("1500000");

    // isSelfHosted — leave unchecked (false)

    await page.getByRole("button", { name: "契約を登録" }).click();

    // After redirect to /contracts/<id>
    await page.waitForURL(/\/contracts\/[A-Za-z0-9_-]+$/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "契約詳細" })).toBeVisible({ timeout: 30_000 });

    const match = page.url().match(/\/contracts\/([A-Za-z0-9_-]+)/);
    expect(match, "契約 ID が URL から取得できなかった").not.toBeNull();
    contractId = match![1]!;
    expect(contractId).toBeTruthy();

    // Contract amount is shown.
    await expect(page.getByText("1,500,000", { exact: false })).toBeVisible({ timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // Step-4: 契約明細登録（価格スナップショット）
  // -------------------------------------------------------------------------

  test("step-4: wholesaler_admin registers contract items with price snapshot", async ({
    page,
  }) => {
    expect(contractId, "Step-3 で契約 ID を取得できていない").toBeTruthy();
    expect(productId, "Setup-2 で商品 ID を取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    await page.goto(`/contracts/${contractId}/items`);
    await expect(page.getByRole("heading", { name: "契約明細" })).toBeVisible({ timeout: 30_000 });

    // Select the product we created in setup-2.
    const productSelect = page.locator("select").first();
    await expect(productSelect).toBeVisible({ timeout: 10_000 });

    // Select our test product by its ID (productId was captured in setup-2).
    await productSelect.selectOption({ value: productId });

    // Qty defaults to 1 — leave as-is.

    // Click "追加" to add the row.
    const addBtn = page.getByRole("button", { name: "追加" });
    await expect(addBtn).toBeEnabled({ timeout: 5_000 });
    await addBtn.click();

    // Verify the item row appears in the table.
    await expect(page.getByText("UC-03 メーカー", { exact: false })).toBeVisible({
      timeout: 10_000,
    });

    // Record the snapshot prices before saving (from the displayed row).
    // Columns (0-indexed): 0=name, 1=maker, 2=qty, 3=unit, 4=purchasePrice, 5=dealerPrice, 6=listPrice, 7=subtotal
    const rows = page.locator("table tbody tr");
    const firstRow = rows.first();
    const dealerPriceCell = firstRow.locator("td").nth(5);
    const listPriceCell = firstRow.locator("td").nth(6);
    snapshotDealerPrice = (await dealerPriceCell.textContent())?.trim() ?? "";
    snapshotListPrice = (await listPriceCell.textContent())?.trim() ?? "";

    // Save items.
    const saveBtn = page.getByRole("button", { name: "明細を保存" });
    await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
    await saveBtn.click();

    // Toast: "契約明細を保存しました"
    await expect(page.getByText("契約明細を保存しました", { exact: false })).toBeVisible({
      timeout: 30_000,
    });
  });

  // -------------------------------------------------------------------------
  // Step-5: 粗利計算（再計算実行）
  // -------------------------------------------------------------------------

  test("step-5: wholesaler_admin recalculates gross profit", async ({ page }) => {
    expect(contractId, "Step-3 で契約 ID を取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    await page.goto(`/contracts/${contractId}/gross-profit`);
    await expect(page.getByRole("heading", { name: "粗利計算" })).toBeVisible({ timeout: 30_000 });

    // GrossProfitForm uses React-controlled inputs wrapped in <label> elements.
    // Playwright's getByLabel resolves the wrapped-label pattern.
    // salesPrice defaults to the contract amount (1,500,000) — no need to refill.

    // Click "再計算".
    const recalcBtn = page.getByRole("button", { name: "再計算" });
    await expect(recalcBtn).toBeVisible({ timeout: 20_000 });
    await recalcBtn.click();

    // Toast: "粗利を再計算しました"
    await expect(page.getByText("粗利を再計算しました", { exact: false })).toBeVisible({
      timeout: 30_000,
    });

    // After recalc, the summary section should show gross profit data.
    await expect(page.getByText("案件粗利", { exact: false })).toBeVisible({ timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // Step-6: 商品マスタ価格改定（スナップショット不変性の前提条件）
  // -------------------------------------------------------------------------

  test("step-6: wholesaler_admin revises product price (simulates market change)", async ({
    page,
  }) => {
    expect(productId, "Setup-2 で商品 ID を取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    // Navigate to the product revision page.
    await page.goto(`/masters/products/${productId}/revise`);
    await expect(page.getByRole("heading", { name: "価格改定" })).toBeVisible({ timeout: 30_000 });

    // Set effectiveFrom to tomorrow (must be strictly after the original effectiveFrom).
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await page.getByLabel("適用開始日", { exact: false }).fill(tomorrow);

    // New prices — significantly different from original (40000 → 99000 dealer price).
    await page.getByLabel("二次店向け卸値（円）").fill("99000");
    await page.getByLabel("参考売価（円）").fill("120000");
    await page.getByLabel("改定理由").fill(`UC-03 E2E スナップショット検証用 ${RUN_ID}`);

    await page.getByRole("button", { name: "価格改定を確定" }).click();

    // After revision, redirect to the successor product's detail.
    await page.waitForURL((url) => /\/masters\/products\/[A-Za-z0-9_-]+$/.test(url.pathname), {
      timeout: 30_000,
    });

    // Verify the new price is shown.
    await expect(page.getByLabel("二次店向け卸値（円）", { exact: false })).toHaveValue("99000", {
      timeout: 20_000,
    });
  });

  // -------------------------------------------------------------------------
  // Step-7: スナップショット不変性 — 商品マスタ改定後も過去明細の価格は変わらない
  // -------------------------------------------------------------------------

  test("step-7: contract items retain snapshot prices after product revision", async ({ page }) => {
    expect(contractId, "Step-3 で契約 ID を取得できていない").toBeTruthy();
    expect(snapshotDealerPrice).toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    await page.goto(`/contracts/${contractId}/items`);
    await expect(page.getByRole("heading", { name: "契約明細" })).toBeVisible({ timeout: 30_000 });

    // The item row should still show the ORIGINAL price (40,000), NOT the revised price (99,000).
    // We use the snapshotDealerPrice recorded before the revision.
    const rows = page.locator("table tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });

    const dealerPriceCell = rows.first().locator("td").nth(5);
    const currentDealerPrice = (await dealerPriceCell.textContent())?.trim() ?? "";

    // The displayed price should match the snapshot taken in step-4.
    // Note: the cell displays from initialItems (server-rendered with snapshotDealerPrice).
    expect(
      currentDealerPrice,
      `明細の卸値が変わった: snapshot=${snapshotDealerPrice}, current=${currentDealerPrice}`,
    ).toBe(snapshotDealerPrice);

    const listPriceCell = rows.first().locator("td").nth(6);
    const currentListPrice = (await listPriceCell.textContent())?.trim() ?? "";

    expect(
      currentListPrice,
      `明細の希望小売価格が変わった: snapshot=${snapshotListPrice}, current=${currentListPrice}`,
    ).toBe(snapshotListPrice);

    // Also verify the revised price (99,000) is NOT present in the items table.
    await expect(page.locator("table tbody").getByText("99,000", { exact: false })).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // Step-8: 施工レコード作成
  //
  // ConstructionForm renders inputs as uncontrolled React state without id
  // attributes. We locate the create panel by its heading "施工を登録" and
  // click the submit button. All construction fields are optional so no
  // filling is strictly required.
  // -------------------------------------------------------------------------

  test("step-8: wholesaler_admin creates a construction record", async ({ page }) => {
    expect(contractId, "Step-3 で契約 ID を取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    await page.goto(`/contracts/${contractId}/construction`);
    await expect(page.getByRole("heading", { name: "施工管理" })).toBeVisible({ timeout: 30_000 });

    // Locate the "新規登録" create section by its h2 heading.
    // All fields are optional so we just click create.
    const createBtn = page.getByRole("button", { name: "施工を登録" });
    await expect(createBtn).toBeVisible({ timeout: 20_000 });
    await createBtn.click();

    // Toast: "施工を登録しました"
    await expect(page.getByText("施工を登録しました", { exact: false })).toBeVisible({
      timeout: 30_000,
    });
  });

  // -------------------------------------------------------------------------
  // Step-9: 補助金申請作成
  //
  // ApplicationForm requires "申請種別" (type). The input has no id attribute
  // so we locate it as the first <input type="text"> inside the create section.
  // -------------------------------------------------------------------------

  test("step-9: wholesaler_admin creates an application record", async ({ page }) => {
    expect(contractId, "Step-3 で契約 ID を取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    await page.goto(`/contracts/${contractId}/application`);
    await expect(page.getByRole("heading", { name: "補助金申請管理" })).toBeVisible({
      timeout: 30_000,
    });

    // Locate the create section heading "申請を登録" (h2).
    // The type input is the first visible text input under that section.
    const createSection = page.locator("h2", { hasText: "申請を登録" }).locator("..").locator("..");

    // Fill in application type (required field).
    const typeInput = createSection.locator("input[type='text']").first();
    await expect(typeInput).toBeVisible({ timeout: 10_000 });
    await typeInput.fill(`省エネ補助金 ${RUN_ID}`);

    // Submit create.
    const createBtn = page.getByRole("button", { name: "申請を登録" });
    await expect(createBtn).toBeEnabled({ timeout: 5_000 });
    await createBtn.click();

    // Toast: "申請を登録しました"
    await expect(page.getByText("申請を登録しました", { exact: false })).toBeVisible({
      timeout: 30_000,
    });
  });
});
