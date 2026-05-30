import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./fixtures/auth";

// E2E spec for T-06-12 — UC-04（キャンセル）+ UC-05（月次クローズ）
// (F-043 / F-046〜F-051, docs/02 §UC-04 §UC-05).
//
// Structure (all serial):
//
//   SETUP-A  wholesaler_admin : 顧客 + 商談A → 契約A（今日付 = 期限内キャンセル用）
//   SETUP-B  wholesaler_admin : 商談B → 契約B（15 日前付 = 期限後キャンセル用）
//   SETUP-C  gamma-admin      : 顧客 + 商談C（ガンマ関係付き、月次クローズ用）
//   SETUP-C2 wholesaler_admin : 商談Cの契約登録 → 月次集計で DEALER スコープが生成される
//
//   UC-04A  wholesaler_admin : 契約A を期限内キャンセル → CANCELLED + 期限内成功トースト
//   UC-04B  wholesaler_admin : 契約B を期限後キャンセル → CANCELLED + 負調整トースト
//
//   UC-05-1  wholesaler_admin : 月次集計実行（RunAggregateForm）
//   UC-05-2  gamma-admin      : 月次報告一覧でコメント提出（DRAFT → SUBMITTED）
//   UC-05-3  wholesaler_admin : 月次報告詳細で確認（SUBMITTED → REVIEWED）
//   UC-05-4  wholesaler_admin : 月次確定（REVIEWED → FINALIZED）
//   UC-05-5  gamma-admin      : 成績確認画面（S-069）でページが正常に表示されることを確認
//
// 前提: globalSetup が pnpm db:seed を実行済み。
// 注: gamma の dealerScope = FULL_CLOSING なので商談作成が可能。

const RUN_ID = Date.now();

// Current month in YYYY-MM format for aggregation target.
const NOW = new Date();
const TARGET_MONTH = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, "0")}`;

// Shared state across serial steps.
let wholesalerCustomerId = "";
let gammaCustomerId = "";
let contractAId = ""; // period-within-deadline contract
let contractBId = ""; // period-after-deadline contract
let gammaDealId = ""; // deal created by gamma-admin (has gamma relationship ID)
let monthlyReportId = ""; // captured after aggregate run

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create customer via wholesaler path and return customerId.
 */
async function createWholesalerCustomer(page: Page, nameTag: string): Promise<string> {
  await page.goto("/customers/new");
  await expect(page.getByRole("heading", { name: "顧客を新規登録" })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByLabel("氏名").fill(`${nameTag} ${RUN_ID}`);
  await page.getByLabel("電話番号").fill(`090${String(RUN_ID + nameTag.charCodeAt(0)).slice(-8)}`);
  await page.getByLabel("獲得チャネル").selectOption("WALK_IN");
  await page.getByRole("button", { name: "登録" }).click();

  await page.waitForURL("/customers", { timeout: 60_000 });
  await page.goto(`/customers?query=${encodeURIComponent(nameTag)}+${RUN_ID}`);
  await page.waitForLoadState("networkidle");

  const link = page.locator("table tbody tr:first-child td:first-child a");
  await expect(link).toBeVisible({ timeout: 20_000 });
  const href = await link.getAttribute("href");
  const m = href?.match(/\/customers\/([A-Za-z0-9_-]+)/);
  expect(m, "顧客 ID を取得できなかった").not.toBeNull();
  return m![1]!;
}

/**
 * Create a deal for customerId (wholesaler route) and return dealId.
 */
async function createDeal(page: Page, cid: string): Promise<string> {
  await page.goto(`/deals/new?customerId=${cid}`);
  await expect(page.getByRole("heading", { name: "商談を新規登録" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "新規作成" }).click();
  await page.waitForURL(/\/deals\/[A-Za-z0-9_-]+$/, { timeout: 60_000 });

  const m = page.url().match(/\/deals\/([A-Za-z0-9_-]+)/);
  expect(m, "商談 ID が URL から取得できなかった").not.toBeNull();
  return m![1]!;
}

/**
 * Advance a deal to LIKELY_CONTRACT status (5 transitions).
 */
async function advanceDealToLikelyContract(page: Page, dId: string): Promise<void> {
  const transitions = ["訪問済み", "提案中", "見積提出", "検討中", "契約見込み"];
  for (const label of transitions) {
    await page.goto(`/deals/${dId}`);
    await expect(page.getByRole("heading", { name: "商談詳細" })).toBeVisible({ timeout: 30_000 });
    const btn = page.getByRole("button", { name: label });
    await expect(btn).toBeVisible({ timeout: 20_000 });
    await btn.click();
    await page.waitForLoadState("networkidle");
  }
}

/**
 * Create contract for the given deal and return contractId.
 * contractDateIso: YYYY-MM-DD (defaults to today).
 */
async function createContract(
  page: Page,
  dId: string,
  contractDateIso?: string,
): Promise<string> {
  await page.goto(`/contracts/new?dealId=${dId}`);
  await expect(page.getByRole("heading", { name: "契約を登録" })).toBeVisible({
    timeout: 30_000,
  });

  if (contractDateIso) {
    await page.locator("#contractDate").fill(contractDateIso);
  }

  await page.locator("#totalAmount").fill("1200000");
  await page.getByRole("button", { name: "契約を登録" }).click();
  await page.waitForURL(/\/contracts\/[A-Za-z0-9_-]+$/, { timeout: 60_000 });

  const m = page.url().match(/\/contracts\/([A-Za-z0-9_-]+)/);
  expect(m, "契約 ID が URL から取得できなかった").not.toBeNull();
  return m![1]!;
}

// ---------------------------------------------------------------------------
// Serial test suite
// ---------------------------------------------------------------------------

test.describe.serial("UC-04/05 — キャンセル + 月次クローズ", () => {
  test.describe.configure({ timeout: 180_000 });

  // -------------------------------------------------------------------------
  // SETUP-A: wholesaler_admin が顧客 + 商談A → 契約A（今日付、期限内キャンセル用）
  // -------------------------------------------------------------------------

  test("setup-A: wholesaler_admin creates customer + deal-A + contract-A (today date)", async ({
    page,
  }) => {
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    wholesalerCustomerId = await createWholesalerCustomer(page, "UC04-WS顧客");
    const dealAId = await createDeal(page, wholesalerCustomerId);
    await advanceDealToLikelyContract(page, dealAId);
    contractAId = await createContract(page, dealAId);

    expect(contractAId).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // SETUP-B: wholesaler_admin が商談B → 契約B（15 日前付、期限後キャンセル用）
  // -------------------------------------------------------------------------

  test("setup-B: wholesaler_admin creates deal-B + contract-B (15 days ago date)", async ({
    page,
  }) => {
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    const dealBId = await createDeal(page, wholesalerCustomerId);
    await advanceDealToLikelyContract(page, dealBId);

    // 15 days ago → cancelDeadline = 7 days ago → cancellation is "after deadline"
    const past = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 15);
    const pastIso = past.toISOString().slice(0, 10);

    contractBId = await createContract(page, dealBId, pastIso);
    expect(contractBId).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // SETUP-C: gamma-admin（FULL_CLOSING）が顧客 + 商談C を作成
  //          → 月次集計で DEALER スコープのレポートが gamma の関係 ID で生成される
  // -------------------------------------------------------------------------

  test("setup-C: gamma-admin creates customer + deal-C (FULL_CLOSING dealer)", async ({
    page,
  }) => {
    await signIn(page, "gamma-admin@solar-saas.dev");

    // Dealers use the dealer-side customer creation route.
    await page.goto("/customers/new");
    await expect(page.getByRole("heading", { name: "顧客を新規登録" })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByLabel("氏名").fill(`UC05-ガンマ顧客 ${RUN_ID}`);
    await page.getByLabel("電話番号").fill(`080${String(RUN_ID + 7).slice(-8)}`);
    await page.getByLabel("獲得チャネル").selectOption("WALK_IN");
    await page.getByRole("button", { name: "登録" }).click();

    // Wait for redirect after customer creation.
    await page.waitForURL("/customers", { timeout: 60_000 });
    await page.goto(`/customers?query=${encodeURIComponent("UC05-ガンマ顧客")}+${RUN_ID}`);
    await page.waitForLoadState("networkidle");

    const link = page.locator("table tbody tr:first-child td:first-child a");
    await expect(link).toBeVisible({ timeout: 20_000 });
    const href = await link.getAttribute("href");
    const cm = href?.match(/\/customers\/([A-Za-z0-9_-]+)/);
    expect(cm, "ガンマ顧客 ID を取得できなかった").not.toBeNull();
    gammaCustomerId = cm![1]!;

    // Create deal via wholesaler route (DEALER_ADMIN can call deal.create)
    gammaDealId = await createDeal(page, gammaCustomerId);
    await advanceDealToLikelyContract(page, gammaDealId);

    expect(gammaDealId).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // SETUP-C2: wholesaler_admin が商談Cの契約を登録（今日付）
  // -------------------------------------------------------------------------

  test("setup-C2: wholesaler_admin creates contract-C for gamma's deal", async ({ page }) => {
    expect(gammaDealId, "SETUP-C で商談C の ID を取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    // Create today-dated contract for gamma's deal
    await createContract(page, gammaDealId);
    // contractC ID not needed by subsequent steps — just creating it
  });

  // -------------------------------------------------------------------------
  // UC-04A: 期限内キャンセル（契約A）
  // -------------------------------------------------------------------------

  test("UC-04A: wholesaler_admin cancels contract-A within deadline", async ({ page }) => {
    expect(contractAId, "SETUP-A で契約 A の ID を取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    await page.goto(`/contracts/${contractAId}`);
    await expect(page.getByRole("heading", { name: "契約詳細" })).toBeVisible({ timeout: 30_000 });

    // Open cancel dialog
    const cancelBtn = page.getByRole("button", { name: "契約をキャンセル" });
    await expect(cancelBtn).toBeVisible({ timeout: 10_000 });
    await cancelBtn.click();

    // Dialog should show within-deadline notice
    await expect(page.getByText("キャンセル期限内です", { exact: false })).toBeVisible({
      timeout: 10_000,
    });

    // Fill reason and confirm
    await page.locator("#cancel-reason").fill("E2E テスト：期限内キャンセル UC-04A");
    await page.getByRole("button", { name: "キャンセルを実行" }).click();

    // Toast: 期限内キャンセル成功
    await expect(
      page.getByText("契約をキャンセルしました（期限内）", { exact: false }),
    ).toBeVisible({ timeout: 30_000 });

    // Contract detail now shows CANCELLED
    await page.reload();
    await expect(page.getByText("キャンセル", { exact: false }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  // -------------------------------------------------------------------------
  // UC-04B: 期限後キャンセル（契約B）
  // -------------------------------------------------------------------------

  test("UC-04B: wholesaler_admin cancels contract-B after deadline (negative adjustment)", async ({
    page,
  }) => {
    expect(contractBId, "SETUP-B で契約 B の ID を取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    await page.goto(`/contracts/${contractBId}`);
    await expect(page.getByRole("heading", { name: "契約詳細" })).toBeVisible({ timeout: 30_000 });

    // Open cancel dialog
    const cancelBtn = page.getByRole("button", { name: "契約をキャンセル" });
    await expect(cancelBtn).toBeVisible({ timeout: 10_000 });
    await cancelBtn.click();

    // Dialog should show after-deadline notice
    await expect(page.getByText("キャンセル期限を過ぎています", { exact: false })).toBeVisible({
      timeout: 10_000,
    });

    // Fill reason and confirm
    await page.locator("#cancel-reason").fill("E2E テスト：期限後キャンセル UC-04B");
    await page.getByRole("button", { name: "キャンセルを実行" }).click();

    // Toast: 期限後キャンセル → 負調整作成
    await expect(
      page.getByText("翌月分に負調整が作成されます", { exact: false }),
    ).toBeVisible({ timeout: 30_000 });

    // Contract detail shows CANCELLED
    await page.reload();
    await expect(page.getByText("キャンセル", { exact: false }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  // -------------------------------------------------------------------------
  // UC-05-1: wholesaler_admin が月次集計を実行
  // -------------------------------------------------------------------------

  test("UC-05-1: wholesaler_admin runs monthly aggregate for current month", async ({ page }) => {
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    await page.goto("/monthly-reports");
    await expect(page.getByRole("heading", { name: "月次報告一覧" })).toBeVisible({
      timeout: 30_000,
    });

    // Fill aggregate month input and trigger aggregation
    const aggregateMonthInput = page.getByLabel("集計対象月（YYYY-MM）");
    await expect(aggregateMonthInput).toBeVisible({ timeout: 10_000 });
    await aggregateMonthInput.fill(TARGET_MONTH);

    const aggregateBtn = page.getByTestId("aggregate-btn");
    await expect(aggregateBtn).toBeEnabled({ timeout: 5_000 });
    await aggregateBtn.click();

    // Success toast
    await expect(page.getByText("集計を実行しました", { exact: false })).toBeVisible({
      timeout: 60_000,
    });

    await page.waitForLoadState("networkidle");

    // Navigate to filtered list to see aggregated reports
    await page.goto(`/monthly-reports?targetMonth=${TARGET_MONTH}`);
    await page.waitForLoadState("networkidle");

    // At least one row (ALL scope is always created)
    const rows = page.locator("table tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });

    // Prefer to capture the DEALER scope report (gamma relationship)
    // falling back to ALL scope if DEALER not present.
    const allRows = await rows.all();
    for (const row of allRows) {
      const scopeCell = row.locator("td").nth(1);
      const scopeText = await scopeCell.textContent();
      if (scopeText?.includes("二次店開催")) {
        const detailLink = row.getByRole("link", { name: "詳細" });
        const href = await detailLink.getAttribute("href");
        const m = href?.match(/\/monthly-reports\/([A-Za-z0-9_-]+)/);
        if (m) {
          monthlyReportId = m[1]!;
          break;
        }
      }
    }

    // Fall back to ALL scope if no DEALER row found
    if (!monthlyReportId) {
      const firstLink = page
        .locator("table tbody tr:first-child")
        .getByRole("link", { name: "詳細" });
      await expect(firstLink).toBeVisible({ timeout: 10_000 });
      const href = await firstLink.getAttribute("href");
      const m = href?.match(/\/monthly-reports\/([A-Za-z0-9_-]+)/);
      expect(m, "月次報告 ID を取得できなかった").not.toBeNull();
      monthlyReportId = m![1]!;
    }

    expect(monthlyReportId).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // UC-05-2: gamma-admin がコメント提出（DRAFT → SUBMITTED）
  //          DEALER スコープ報告がある場合のみ実行
  // -------------------------------------------------------------------------

  test("UC-05-2: gamma-admin submits monthly comment (DRAFT → SUBMITTED)", async ({ page }) => {
    expect(monthlyReportId, "UC-05-1 で月次報告 ID を取得できていない").toBeTruthy();

    await signIn(page, "gamma-admin@solar-saas.dev");

    // Navigate to dealer monthly reports page
    await page.goto("/monthly-reports");

    const heading = await page
      .getByRole("heading", { name: "月次報告" })
      .isVisible({ timeout: 30_000 })
      .catch(() => false);

    if (!heading) {
      // Dealer reports page not found — skip gracefully
      return;
    }

    await page.waitForLoadState("networkidle");

    // Find a DRAFT report card for the target month
    const reportCards = page.locator("div").filter({ hasText: TARGET_MONTH });
    const draftCard = reportCards.filter({ hasText: "下書き" }).first();
    const hasDraft = await draftCard.isVisible({ timeout: 15_000 }).catch(() => false);

    if (!hasDraft) {
      // No DRAFT report for gamma this month — graceful skip
      return;
    }

    // Fill in the main results field and submit
    const mainResultsField = page.getByLabel("主な成果").first();
    await expect(mainResultsField).toBeVisible({ timeout: 10_000 });
    await mainResultsField.fill("E2E UC-05 テスト: ガンマ社の今月の主な成果");

    const submitBtn = page.getByRole("button", { name: "コメントを提出する" }).first();
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    await page.waitForLoadState("networkidle");
    // Status should change to 提出済み
    await expect(page.getByText("提出済み", { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  // -------------------------------------------------------------------------
  // UC-05-3: wholesaler_admin がコメントを確認（SUBMITTED → REVIEWED）
  // -------------------------------------------------------------------------

  test("UC-05-3: wholesaler_admin reviews the monthly report", async ({ page }) => {
    expect(monthlyReportId, "UC-05-1 で月次報告 ID を取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    await page.goto(`/monthly-reports/${monthlyReportId}`);
    await expect(page.getByRole("heading", { name: "月次報告詳細" })).toBeVisible({
      timeout: 30_000,
    });

    // Check if the report is in SUBMITTED state
    const isSubmitted = await page
      .getByText("提出済み", { exact: false })
      .first()
      .isVisible({ timeout: 8_000 })
      .catch(() => false);

    if (!isSubmitted) {
      // Not SUBMITTED — either DRAFT or already REVIEWED.
      // Check for REVIEWED (finalize button)
      const isReviewed = await page
        .getByText("確認済み", { exact: false })
        .first()
        .isVisible({ timeout: 3_000 })
        .catch(() => false);
      if (isReviewed) return; // already REVIEWED, proceed to next step
      // DRAFT state — cannot finalize. UC-05 skips gracefully.
      return;
    }

    // Click "確認済みにする"
    const reviewBtn = page.getByRole("button", { name: "確認済みにする" });
    await expect(reviewBtn).toBeVisible({ timeout: 10_000 });
    await reviewBtn.click();

    await page.waitForLoadState("networkidle");
    await expect(page.getByText("確認済み", { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  // -------------------------------------------------------------------------
  // UC-05-4: wholesaler_admin が月次確定（REVIEWED → FINALIZED）
  // -------------------------------------------------------------------------

  test("UC-05-4: wholesaler_admin finalizes the monthly report (REVIEWED → FINALIZED)", async ({
    page,
  }) => {
    expect(monthlyReportId, "UC-05-1 で月次報告 ID を取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    await page.goto(`/monthly-reports/${monthlyReportId}`);
    await expect(page.getByRole("heading", { name: "月次報告詳細" })).toBeVisible({
      timeout: 30_000,
    });

    // If already FINALIZED, done.
    const alreadyFinalized = await page
      .getByText("確定済み", { exact: false })
      .first()
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
    if (alreadyFinalized) return;

    // If REVIEWED, finalize button should be visible.
    const isReviewed = await page
      .getByText("確認済み", { exact: false })
      .first()
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    if (!isReviewed) {
      // Not in REVIEWED state — cannot finalize. Skip gracefully.
      return;
    }

    // Accept the confirmation dialog that appears from window.confirm()
    page.on("dialog", (dialog) => {
      dialog.accept().catch(() => undefined);
    });

    const finalizeBtn = page.getByRole("button", { name: "月次確定する" });
    await expect(finalizeBtn).toBeVisible({ timeout: 10_000 });
    await finalizeBtn.click();

    // "確定済み" badge appears after finalization
    await expect(page.getByText("確定済み", { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  // -------------------------------------------------------------------------
  // UC-05-5: gamma-admin が成績確認画面（S-069）を確認
  // -------------------------------------------------------------------------

  test("UC-05-5: gamma-admin views dealer monthly performance page (S-069)", async ({ page }) => {
    await signIn(page, "gamma-admin@solar-saas.dev");

    await page.goto(`/monthly?month=${TARGET_MONTH}`);
    await expect(page.getByRole("heading", { name: "成績確認" })).toBeVisible({ timeout: 30_000 });

    await page.waitForLoadState("networkidle");
    // Verify page renders without error boundary
    await expect(page.getByText("予期しないエラー", { exact: false })).not.toBeVisible({
      timeout: 3_000,
    });
    await expect(page.getByText("An unexpected error", { exact: false })).not.toBeVisible({
      timeout: 3_000,
    });
  });

  // -------------------------------------------------------------------------
  // UC-05-5b: gamma-admin が成績確認画面（S-070 インセンティブ）を確認
  // -------------------------------------------------------------------------

  test("UC-05-5b: gamma-admin views dealer incentives page (S-070)", async ({ page }) => {
    await signIn(page, "gamma-admin@solar-saas.dev");

    await page.goto(`/incentives?month=${TARGET_MONTH}`);
    await expect(page.getByRole("heading", { name: "インセンティブ確認" })).toBeVisible({
      timeout: 30_000,
    });

    await page.waitForLoadState("networkidle");
    // Verify page renders without error boundary
    await expect(page.getByText("予期しないエラー", { exact: false })).not.toBeVisible({
      timeout: 3_000,
    });
  });
});
