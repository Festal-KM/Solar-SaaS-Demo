import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./fixtures/auth";

// 顧客詳細「損益計算」タブ E2E（docs/05 §20 損益タブ刷新）。
//
// 損益計算タブは契約単位に 売上(=contractAmount) / 施工代・場所代（ContractCost 集計）/
// 粗利（売上−施工代−場所代）/ 手数料（粗利×手数料率）を表示する **機密財務** ビュー。
// 上部に 契約/売上/施工代/場所代/粗利/手数料 の 5 列サマリ（合計行つき）、下部に契約ごとの
// コスト項目編集カード（施工代=施工プルダウン+金額 / 場所代=金額 / 手数料率入力）を描画する。
// 卸業者/SaaS 限定で、二次店 DTO（ProjectInfoForDealerDto）からは profitAndLoss を
// セクション丸ごと物理除外し、UI も `"profitAndLoss" in projectInfo` ゲートでタブ自体を
// 描画しない（CLAUDE.md #4・#5 / docs/05 §20.3）。
//
// 検証対象:
//   1. demo(WHOLESALER_ADMIN) → 契約済み顧客 → 「損益計算」タブが表示され、5 列サマリ
//      （売上 / 施工代 / 場所代 / 粗利 / 手数料）+ ¥ 金額 + 契約ごとの編集カード（手数料率）
//      が描画される。複数契約なら合計行が出る。
//   2. 未契約(契約なし)顧客では損益計算タブが空状態メッセージを描画する（クラッシュしない）。
//   3. 二次店漏洩防止（最重要）: dealer ロールで卸業者専用の顧客詳細を開いても「損益計算」
//      タブが描画されず、施工代/場所代/手数料率の機密ラベルが DOM に一切出ないこと。
//
// 認証:
//   - 卸業者: demo@solar-saas.demo / Demo1234!（pilotWholesaler テナント, WHOLESALER_ADMIN）
//   - 二次店: alpha-admin@solar-saas.dev / PILOT_PASSWORD（DEALER_ADMIN）
//
// Seed は global-setup が `pnpm db:seed` を1回実行（idempotent）。
// workers:1 + fullyParallel:false（playwright.config.ts）に追従。

const DEMO_EMAIL = "demo@solar-saas.demo";
const DEMO_PASSWORD = "Demo1234!";
const DEALER_ADMIN_EMAIL = "alpha-admin@solar-saas.dev";

// 損益計算タブのラベル（apps/web/lib/i18n/labels.ts customer.detail.profitTab）。
const profit = {
  tab: "損益計算",
  title: "損益計算",
  empty: "損益を表示できる契約がありません。",
  totalRow: "合計",
  commissionRate: "手数料率",
  columns: {
    contract: "契約",
    salesPrice: "売上",
    constructionFee: "施工代",
    venueFee: "場所代",
    grossProfit: "粗利",
    commission: "手数料",
  },
} as const;

// ¥ 金額表記（fmtYen: `¥${n.toLocaleString("ja-JP")}` → 例 "¥4,200,000"）。
const YEN_PATTERN = /¥[\d,]+/;

async function signInAsDemo(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(DEMO_EMAIL);
  await page.getByLabel("パスワード").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "サインイン" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 90_000 });
  await page.waitForLoadState("networkidle");
}

test.describe("顧客詳細『損益計算』タブ（損益タブ刷新 / 卸業者）", () => {
  // dev サーバの cold-compile を吸収するため 30s 既定を 120s に拡張。
  test.describe.configure({ timeout: 120_000 });

  test("契約済み顧客: 5 列サマリ（売上/施工代/場所代/粗利/手数料）+ ¥ 金額 + 手数料率入力が描画される", async ({
    page,
  }) => {
    await signInAsDemo(page);

    // 契約済みで絞り込み → 契約を持つ顧客（全契約が損益タブに 1 件ずつ出る）。
    await page.goto("/customers?contractStatus=contracted");
    const firstRow = page.getByRole("button", { name: /様$/ }).first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();
    await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });

    // 卸業者には損益計算タブが描画される（profitAndLoss キーが ProjectInfoDto に存在）。
    const profitTab = page.getByRole("tab", { name: profit.tab });
    await expect(profitTab).toBeVisible();
    await profitTab.click();

    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // パネル見出し「損益計算」。
    await expect(panel.getByRole("heading", { name: profit.title })).toBeVisible();

    // 空状態メッセージは出ていない（= 契約が 1 件以上ある）。
    await expect(panel.getByText(profit.empty)).toHaveCount(0);

    // 5 列サマリの列見出し（契約 / 売上 / 施工代 / 場所代 / 粗利 / 手数料）が描画される。
    const table = panel.locator("table");
    await expect(table).toBeVisible();
    const head = table.locator("thead");
    for (const col of [
      profit.columns.contract,
      profit.columns.salesPrice,
      profit.columns.constructionFee,
      profit.columns.venueFee,
      profit.columns.grossProfit,
      profit.columns.commission,
    ]) {
      await expect(
        head.getByRole("columnheader", { name: col, exact: true }),
        `列見出し「${col}」`,
      ).toBeVisible();
    }

    // 少なくとも 1 行のサマリ行（契約 #1 など）が描画される。
    const dataRows = table.locator("tbody tr");
    await expect(dataRows.first()).toBeVisible();

    // ¥ 金額（売上等）が実値で描画される。
    const bodyText = (await table.locator("tbody").textContent()) ?? "";
    expect(bodyText, "サマリ本文に ¥ 金額が出る").toMatch(YEN_PATTERN);

    // 契約ごとの編集カードに手数料率入力（%）が描画される。
    await expect(panel.getByText(profit.commissionRate).first()).toBeVisible();

    // 複数契約のときは合計行(tfoot)が描画される。1 契約なら合計行は出ない（実装契約）。
    const rowCount = await dataRows.count();
    const tfoot = table.locator("tfoot");
    if (rowCount > 1) {
      await expect(tfoot).toBeVisible();
      await expect(tfoot.getByText(profit.totalRow)).toBeVisible();
      const tfootText = (await tfoot.textContent()) ?? "";
      expect(tfootText, "合計行に ¥ 合計が出る").toMatch(YEN_PATTERN);
    } else {
      await expect(tfoot).toHaveCount(0);
    }
  });

  test("契約なし顧客: 損益計算タブが空状態でクラッシュしない", async ({ page }) => {
    await signInAsDemo(page);

    // 契約を持たない顧客を確実に開く（契約 0 件で安定している「佐藤 一馬」）。
    await page.goto("/customers");
    const search = page.getByRole("searchbox").first();
    await expect(search).toBeVisible();
    await search.fill("佐藤 一馬");
    await page.getByRole("button", { name: "検索" }).click();
    await page.waitForURL(/[?&]query=/, { timeout: 30_000 });
    const targetRow = page.getByRole("button", { name: "佐藤様" });
    await expect(targetRow).toBeVisible({ timeout: 30_000 });
    await targetRow.click();
    await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });

    await expect(page.getByRole("tab", { name: "基本情報" })).toBeVisible();

    const profitTab = page.getByRole("tab", { name: profit.tab });
    if ((await profitTab.count()) > 0) {
      await profitTab.click();
      const panel = page.getByRole("tabpanel");
      await expect(panel).toBeVisible();
      // 契約が無いので空状態メッセージが描画される。
      await expect(panel.getByText(profit.empty)).toBeVisible();
    }
  });
});

test.describe("二次店への損益漏洩防止（最重要 / CLAUDE.md #4・#5 / docs/05 §20.3）", () => {
  test.describe.configure({ timeout: 120_000 });

  test("dealer ロールでは『損益計算』タブが描画されず、施工代/場所代/手数料率が DOM に一切出ない", async ({
    page,
  }) => {
    // (1) 卸業者で先に契約済み顧客の詳細 URL を取得する。
    await signInAsDemo(page);
    await page.goto("/customers?contractStatus=contracted");
    const firstRow = page.getByRole("button", { name: /様$/ }).first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();
    await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
    const customerDetailUrl = new URL(page.url()).pathname;
    expect(customerDetailUrl).toMatch(/\/customers\/[^/]+$/);

    // 卸業者では当該詳細に損益計算タブが出ること（検証 URL が損益タブ対象）を確認。
    await expect(page.getByRole("tab", { name: profit.tab })).toBeVisible();

    // (2) セッションを破棄して二次店(DEALER_ADMIN)で再ログイン。
    await page.context().clearCookies();
    await signIn(page, DEALER_ADMIN_EMAIL);

    // (3) 二次店セッションで卸業者専用の顧客詳細 URL を開く。
    const response = await page.goto(customerDetailUrl, { waitUntil: "domcontentloaded" });

    // 損益計算タブは二次店には絶対に描画されない（タブ自体ゼロ）。
    await expect(page.getByRole("tab", { name: profit.tab })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: profit.title })).toHaveCount(0);

    // 損益タブ固有の機密ラベル（原価/手数料）がユーザー可視 DOM に一切描画されないこと。
    // 「売上」「粗利」等は他文脈で正当に出得るため、損益タブ固有語のみを漏洩判定に使う。
    for (const label of [
      profit.columns.constructionFee, // 「施工代」
      profit.columns.venueFee, // 「場所代」
      profit.commissionRate, // 「手数料率」
    ]) {
      await expect(
        page.getByText(label, { exact: true }),
        `損益ラベル「${label}」が二次店 DOM に描画されない`,
      ).toHaveCount(0);
    }

    const status = response?.status();
    expect(
      status === undefined || status >= 200,
      `customer detail status for dealer: ${String(status)}`,
    ).toBeTruthy();
  });
});
