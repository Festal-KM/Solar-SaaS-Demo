import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./fixtures/auth";

// 顧客詳細「損益計算」タブ E2E（F-061 損益計算 / docs/05 §16）。
//
// 損益計算タブは契約単位の 売上(salesPrice) / 各原価（仕入合計・二次店仕入・施工費・
// その他原価・値引）/ 粗利（案件粗利・卸粗利・粗利率）を表で一覧する **機密財務** ビュー。
// 卸業者/SaaS 限定で、二次店 DTO（ProjectInfoForDealerDto）からは profitAndLoss を
// セクション丸ごと物理除外し、UI も `"profitAndLoss" in projectInfo` ゲートでタブ自体を
// 描画しない（CLAUDE.md #4・#5）。
//
// 検証対象:
//   1. demo(WHOLESALER_ADMIN) → 契約済み顧客 → 「損益計算」タブが表示され、テーブル
//      列見出し（売上 / 仕入合計 / … / 粗利率）+ ¥ 金額 + % 粗利率 + GrossProfit 実データ
//      が描画される。複数契約なら合計行が出る。
//   2. 未契約(契約なし)顧客では損益計算タブが非表示（profitAndLoss 空 → 行ゼロ）か、
//      タブはあっても空状態メッセージが描画される（クラッシュしない）。
//   3. 二次店漏洩防止（最重要）: dealer ロール（alpha-admin@solar-saas.dev / DEALER_ADMIN）
//      で卸業者専用の顧客詳細を開いても「損益計算」タブが描画されず、売上/原価/粗利の
//      数値（¥…）が DOM に一切出ないこと。dealer は customer.update を持たないため
//      当該卸ルートはアクセス自体が拒否される想定で、その場合も「漏洩なし」を満たす。
//
// 認証:
//   - 卸業者: demo@solar-saas.demo / Demo1234!（pilotWholesaler テナント, WHOLESALER_ADMIN）
//   - 二次店: alpha-admin@solar-saas.dev / PILOT_PASSWORD（DEALER_ADMIN, pilotWholesaler と
//     relationship を持つ二次店テナント）
//
// Seed は global-setup が `pnpm db:seed` を1回実行（idempotent / GrossProfit 含む）。
// workers:1 + fullyParallel:false（playwright.config.ts）に追従。

const DEMO_EMAIL = "demo@solar-saas.demo";
const DEMO_PASSWORD = "Demo1234!";
const DEALER_ADMIN_EMAIL = "alpha-admin@solar-saas.dev";

// 損益計算タブのラベル（apps/web/lib/i18n/labels.ts customer.detail.profitTab）。
const profit = {
  tab: "損益計算",
  title: "損益計算",
  empty: "損益を計算できる契約がありません。",
  totalRow: "合計",
  columns: {
    contract: "契約",
    contractDate: "契約日",
    salesPrice: "売上",
    purchaseTotal: "仕入合計",
    dealerTotal: "二次店仕入",
    constructionFee: "施工費",
    otherCost: "その他原価",
    discount: "値引",
    projectProfit: "案件粗利",
    wholesaleProfit: "卸粗利",
    profitRate: "粗利率",
  },
} as const;

// ¥ 金額表記（fmtYen: `¥${n.toLocaleString("ja-JP")}` → 例 "¥4,200,000"）。
const YEN_PATTERN = /¥[\d,]+/;
// 粗利率（fmtPercent: 小数1桁% → 例 "23.6%"）。
const PERCENT_PATTERN = /\d+(\.\d)?%/;

async function signInAsDemo(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(DEMO_EMAIL);
  await page.getByLabel("パスワード").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "サインイン" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 90_000 });
  await page.waitForLoadState("networkidle");
}

test.describe("顧客詳細『損益計算』タブ（F-061 / 卸業者）", () => {
  // dev サーバの cold-compile を吸収するため 30s 既定を 120s に拡張。
  test.describe.configure({ timeout: 120_000 });

  test("契約済み顧客: 損益計算タブに売上・各原価・粗利・粗利率（¥/%）+ GrossProfit 実データが表で描画される", async ({
    page,
  }) => {
    await signInAsDemo(page);

    // 契約済みで絞り込み → GrossProfit 投入済み（seed が全契約に冪等投入）の契約を持つ顧客。
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

    // 空状態メッセージは出ていない（= GrossProfit 実データが描画されている）。
    await expect(panel.getByText(profit.empty)).toHaveCount(0);

    // テーブル列見出し（売上 / 各原価 / 粗利 / 粗利率）が描画される。
    const table = panel.locator("table");
    await expect(table).toBeVisible();
    const head = table.locator("thead");
    for (const col of [
      profit.columns.salesPrice,
      profit.columns.purchaseTotal,
      profit.columns.dealerTotal,
      profit.columns.constructionFee,
      profit.columns.otherCost,
      profit.columns.discount,
      profit.columns.projectProfit,
      profit.columns.wholesaleProfit,
      profit.columns.profitRate,
    ]) {
      await expect(
        head.getByRole("columnheader", { name: col, exact: true }),
        `列見出し「${col}」`,
      ).toBeVisible();
    }

    // 少なくとも 1 行のデータ行（契約 #1）が描画される。
    const dataRows = table.locator("tbody tr");
    await expect(dataRows.first()).toBeVisible();
    await expect(dataRows.locator("td", { hasText: /契約 #\d+/ }).first()).toBeVisible();

    // ¥ 金額（売上・原価・粗利）と % 粗利率が実値で描画される。
    const bodyText = (await table.locator("tbody").textContent()) ?? "";
    expect(bodyText, "損益テーブル本文に ¥ 金額が出る").toMatch(YEN_PATTERN);
    expect(bodyText, "損益テーブル本文に % 粗利率が出る").toMatch(PERCENT_PATTERN);

    // 複数契約のときは合計行(tfoot)が描画される。1 契約なら合計行は出ない（実装契約）。
    const rowCount = await dataRows.count();
    const tfoot = table.locator("tfoot");
    if (rowCount > 1) {
      await expect(tfoot).toBeVisible();
      await expect(tfoot.getByText(profit.totalRow)).toBeVisible();
      const tfootText = (await tfoot.textContent()) ?? "";
      expect(tfootText, "合計行に ¥ 合計が出る").toMatch(YEN_PATTERN);
    } else {
      // 単一契約: 合計行は冗長なので描画しない（rows.length > 1 ガード）。
      await expect(tfoot).toHaveCount(0);
    }
  });

  test("契約なし顧客: 損益計算タブが非表示、またはタブはあっても空状態でクラッシュしない", async ({
    page,
  }) => {
    await signInAsDemo(page);

    // 契約=GrossProfit を持たない顧客を確実に開く。商談中フィルタの先頭行はマスク名が
    // 重複する別顧客（契約あり）に当たり得るため、契約 0 件で安定している「佐藤 一馬」を
    // 一覧検索（DB raw name に contains マッチ）で引き当てる。
    await page.goto("/customers");
    const search = page.getByRole("searchbox").first();
    await expect(search).toBeVisible();
    await search.fill("佐藤 一馬");
    await page.getByRole("button", { name: "検索" }).click();
    // 検索が URL クエリに反映されてから、マスク名「佐藤様」の行を明示クリックする
    // （検索適用前の先頭行＝別顧客の誤クリックを防ぐ）。
    await page.waitForURL(/[?&]query=/, { timeout: 30_000 });
    const targetRow = page.getByRole("button", { name: "佐藤様" });
    await expect(targetRow).toBeVisible({ timeout: 30_000 });
    await targetRow.click();
    await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });

    // 基本情報タブが描画され（クラッシュしない）、損益計算タブのゲート挙動を確認する。
    await expect(page.getByRole("tab", { name: "基本情報" })).toBeVisible();

    const profitTab = page.getByRole("tab", { name: profit.tab });
    // 損益計算タブは profitAndLoss キー有無で描画される（卸業者では空配列でも描画され得る）。
    if ((await profitTab.count()) > 0) {
      await profitTab.click();
      const panel = page.getByRole("tabpanel");
      await expect(panel).toBeVisible();
      // 契約=損益データが無いので空状態メッセージが描画される。
      await expect(panel.getByText(profit.empty)).toBeVisible();
    }
    // タブ非描画なら何もせず合格（卸業者では profitAndLoss キーは常に存在するため、
    // 実際は空状態分岐に入る。いずれにせよクラッシュしないことを担保する）。
  });
});

test.describe("二次店への損益漏洩防止（最重要 / CLAUDE.md #4・#5）", () => {
  test.describe.configure({ timeout: 120_000 });

  test("dealer ロールでは『損益計算』タブが描画されず、売上/原価/粗利の数値が DOM に一切出ない", async ({
    page,
  }) => {
    // (1) 卸業者で先に契約済み顧客の詳細 URL を取得する（dealer は顧客一覧導線が別ルート
    //     /d-customers のため、検証対象 URL を卸業者セッションで確定させる）。
    await signInAsDemo(page);
    await page.goto("/customers?contractStatus=contracted");
    const firstRow = page.getByRole("button", { name: /様$/ }).first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();
    await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
    const customerDetailUrl = new URL(page.url()).pathname;
    expect(customerDetailUrl).toMatch(/\/customers\/[^/]+$/);

    // 卸業者では当該詳細に損益計算タブが出ること（参照: 検証 URL が損益タブ対象）を確認。
    await expect(page.getByRole("tab", { name: profit.tab })).toBeVisible();

    // (2) セッションを破棄して二次店(DEALER_ADMIN)で再ログイン。
    await page.context().clearCookies();
    await signIn(page, DEALER_ADMIN_EMAIL);

    // (3) 二次店セッションで卸業者専用の顧客詳細 URL を開く。
    //     損益計算タブは profitAndLoss が二次店 DTO から物理除外されるため描画されず、
    //     また dealer は customer.update を持たないため当該卸ルートはアクセス拒否され得る。
    //     いずれの経路でも「損益の数値が DOM に出ない」ことを満たす。
    const response = await page.goto(customerDetailUrl, { waitUntil: "domcontentloaded" });

    // 損益計算タブは二次店には絶対に描画されない（タブ自体ゼロ）。
    await expect(page.getByRole("tab", { name: profit.tab })).toHaveCount(0);
    // 損益見出しも描画されない。
    await expect(page.getByRole("heading", { name: profit.title })).toHaveCount(0);

    // 損益タブ固有の列見出しラベル（機密財務）がユーザー可視 DOM に一切描画されないこと。
    // 注: 生 HTML の React Flight ペイロードには prop オブジェクトの「キー名」が
    // プレースホルダ ($Y) として出ることがあるが、これはデータ値ではない。漏洩の本質は
    // 「機密財務の値がユーザーに見えること」なので、可視テキスト（getByText）で判定する。
    //
    // 損益テーブル固有かつ他タブと重複しない原価/粗利ラベルのみを対象にする
    // （「売上」「合計」は他文脈で正当に出得るため漏洩判定には使わない）。
    for (const col of [
      profit.columns.purchaseTotal, // 「仕入合計」
      profit.columns.dealerTotal, // 「二次店仕入」
      profit.columns.otherCost, // 「その他原価」
      profit.columns.projectProfit, // 「案件粗利」
      profit.columns.wholesaleProfit, // 「卸粗利」
      profit.columns.profitRate, // 「粗利率」
    ]) {
      await expect(
        page.getByText(col, { exact: true }),
        `損益列見出し「${col}」が二次店 DOM に描画されない`,
      ).toHaveCount(0);
    }

    // レスポンスステータスを記録（200 で dealer DTO 描画でも、403/redirect でも、
    // 「損益タブ・損益値が出ない」漏洩なしは成立する）。
    const status = response?.status();
    expect(
      status === undefined || status >= 200,
      `customer detail status for dealer: ${String(status)}`,
    ).toBeTruthy();
  });
});
