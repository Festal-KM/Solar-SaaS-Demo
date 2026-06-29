import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

// 本 spec は「佐藤 一馬」に「審査を追加」で独立 LoanReview を生成しうるため、afterAll で
// その顧客のローン審査を全削除し、空状態前提の他 spec（同顧客の空状態検証）への汚染を防ぐ。
function cleanupDemoLoanReviews(): void {
  const script = resolve(__dirname, "fixtures", "cleanup-demo-loan-reviews.ts");
  const dbDir = resolve(__dirname, "..", "..", "packages", "db");
  execFileSync("pnpm", ["exec", "tsx", script], {
    cwd: dbDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

// 顧客詳細「コール状況」タブ + 「ローン情報」タブ（専用タブ集約 / docs/02 §16）.
//
// 検証対象（今回の変更）:
//   1. コール状況タブ: 完工/ローン完了コール状況・希望日時・汎用希望時間帯・
//      マエカク希望電話・マエカクステータスを表示。EditCallStatusDialog で
//      完工コールステータスを変更保存 → 再描画後に反映される。
//   2. ローン審査タブ: 顧客に紐づく独立 LoanReview を審査ごとのサブタブ
//      （ローン審査 #1/#2…）で表示・インライン編集。LoanReviewInlineEdit の
//      審査ステータス select（#lr-status-<id>）を「審査中」に変更保存 → 反映される。
//      「審査を追加」で審査サブタブが増え、過去の審査履歴ログを追加できる。
//      審査 0 件の顧客は空状態メッセージ（loanTab.empty）を表示する。
//   3. 重複排除: 基本情報タブ内「案件情報」埋め込みビューに コール状況 /
//      ローン・団信 が重複表示されないこと（専用タブへ集約済み）。他セクションは従来通り。
//
// 認証は demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, 2FA off, seed 投入済）。
// Seed は tests/e2e/global-setup.ts で全 spec 起動前に 1 回だけ実行される。
// workers:1 + fullyParallel:false（playwright.config.ts）に追従。

const DEMO_EMAIL = "demo@solar-saas.demo";
const DEMO_PASSWORD = "Demo1234!";

// seed の先頭サンプル顧客「佐藤 一馬」（s=0）— 提案中・契約なし。
// → コール状況タブは Customer 列なので全顧客で表示可。ローン情報タブは契約が
//   無いため空状態の検証に使う。生 name の contains 検索で一意に絞れる。
const SEEDED_CUSTOMER_QUERY = "佐藤 一馬";

// ローン審査ステータスの 4 値ラベル（loanReviewStatusLabels）。
const LOAN_REVIEW_LABELS = ["審査前", "審査中", "完了", "不備在り"] as const;

async function signInAsDemo(page: Page): Promise<void> {
  await page.goto("/login", { timeout: 120_000 });
  await page.getByLabel("メールアドレス").fill(DEMO_EMAIL);
  await page.getByLabel("パスワード").fill(DEMO_PASSWORD);
  const submit = page.getByRole("button", { name: "サインイン" });
  await expect(submit).toBeVisible();
  await submit.click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 });
}

// 契約済み顧客（基本情報タブの重複排除検証で契約情報が出る顧客）を開く。
async function openContractedCustomer(page: Page): Promise<void> {
  await page.goto("/customers?contractStatus=contracted");
  const firstRow = page.getByRole("button", { name: /様$/ }).first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
}

// 任意の顧客を開く（ローン審査は独立エンティティで契約と無関係なため、
// 先頭顧客を開いて審査が無ければ「審査を追加」で 1 件作る）。
async function openFirstCustomer(page: Page): Promise<void> {
  await page.goto("/customers");
  const firstRow = page.getByRole("button", { name: /様$/ }).first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
}

// 先頭サンプル顧客「佐藤 一馬」（契約なし）を開く。
async function openSeededCustomer(page: Page): Promise<void> {
  await page.goto(`/customers?query=${encodeURIComponent(SEEDED_CUSTOMER_QUERY)}`);
  const row = page.getByRole("button", { name: /様$/ }).first();
  await expect(row).toBeVisible();
  await row.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
}

// コールタブ（4 セクション・インライン編集）の表面検証は専用 spec
// tests/e2e/customer-call-tab.spec.ts（5/5 PASS）が網羅する。旧 EditCallStatusDialog
// （`コール状況を編集` / `#cl-post-status` / 単一「コール状況」見出し）依存の describe は
// 再設計で削除済みのため、本ファイルからは撤去した。

test.describe("ローン審査タブ（独立 LoanReview・審査サブタブ）", () => {
  test.describe.configure({ timeout: 120_000 });

  // 本 describe の #1/#2 は「佐藤 一馬」に審査を生成しうる。空状態検証（#3）の前提を守るため
  // 全テスト終了後に佐藤 一馬のローン審査を全削除して原状回復する。
  test.afterAll(() => {
    cleanupDemoLoanReviews();
  });

  test("審査サブタブのインライン編集で審査ステータスを『審査中』に変更保存 → 反映される", async ({
    page,
  }) => {
    // 既存審査の status が既に "reviewing" だとインライン編集が dirty にならず保存ボタンが
    // disabled のままになる（誤検出を招く）。新規追加した審査は既定 "not_reviewed" なので
    // 「審査中」への変更が必ず dirty になる。空顧客「佐藤 一馬」に新規審査を作って検証する。
    cleanupDemoLoanReviews();

    await signInAsDemo(page);
    await openSeededCustomer(page);

    // ローン審査タブへ切り替え。
    await page.getByRole("tab", { name: "ローン審査", exact: true }).click();
    // 審査サブタブが active のとき tabpanel が入れ子になり getByRole('tabpanel') が複数
    // 解決するため、外側のローン審査タブパネル（accessible name = "ローン審査" exact）へ scope。
    const panel = page.getByRole("tabpanel", { name: "ローン審査", exact: true });
    await expect(panel).toBeVisible();

    // 「審査を追加」で新規審査（既定 not_reviewed）を 1 件作る。
    await panel.getByRole("button", { name: "審査を追加" }).first().click();
    const subtabHeading = panel.getByRole("tab", { name: /ローン審査\s*#1/ });
    await expect(subtabHeading).toBeVisible({ timeout: 30_000 });

    // 審査サマリのインライン編集 select（#lr-status-<id>）。状態 select は審査ステータスの
    // 4 値（statusLabels）を持つ。新規審査サブタブがアクティブ。
    const statusSelect = panel.locator('select[id^="lr-status-"]').first();
    await expect(statusSelect).toBeVisible();
    const optionTexts = (await statusSelect.locator("option").allTextContents()).map((t) => t.trim());
    for (const label of LOAN_REVIEW_LABELS) {
      expect(optionTexts, `審査ステータス select に「${label}」が含まれる`).toContain(label);
    }

    // ローン会社・頭金・団信のインライン編集フィールドも存在する。
    for (const label of ["ローン会社", "頭金", "団信"]) {
      await expect(
        panel.locator("label", { hasText: label }).first(),
        `インライン編集フィールド「${label}」が表示される`,
      ).toBeVisible();
    }

    // 「審査中」(= reviewing) を選択して保存（新規審査は not_reviewed なので必ず dirty）。
    await statusSelect.selectOption("reviewing");
    await expect(panel.getByRole("button", { name: "保存" }).first()).toBeEnabled();
    await panel.getByRole("button", { name: "保存" }).first().click();

    // 再描画後も審査ステータス select の値が「審査中」(reviewing) を保持する。
    await expect(async () => {
      const select = panel.locator('select[id^="lr-status-"]').first();
      await expect(select).toHaveValue("reviewing");
    }).toPass({ timeout: 30_000 });
  });

  test("審査履歴ログを追加できる（過去の審査履歴）", async ({ page }) => {
    await signInAsDemo(page);
    await openFirstCustomer(page);

    await page.getByRole("tab", { name: "ローン審査", exact: true }).click();
    // 審査サブタブが active のとき tabpanel が入れ子になり getByRole('tabpanel') が複数
    // 解決するため、外側のローン審査タブパネル（accessible name = "ローン審査" exact）へ scope。
    const panel = page.getByRole("tabpanel", { name: "ローン審査", exact: true });
    await expect(panel).toBeVisible();

    const subtabHeading = panel.getByRole("tab", { name: /ローン審査\s*#1/ });
    if ((await subtabHeading.count()) === 0) {
      await panel.getByRole("button", { name: "審査を追加" }).first().click();
      await expect(subtabHeading).toBeVisible({ timeout: 30_000 });
    }

    // 過去の審査履歴の追加フォーム（日時 + 結果 select + メモ）。日時を入れて「追加」。
    const atInput = panel.locator('input[id^="lrl-at-"]').first();
    await expect(atInput).toBeVisible();
    await atInput.fill("2026-06-20T10:00");
    await panel.getByRole("button", { name: "追加", exact: true }).first().click();

    // 追加後、履歴一覧に結果ラベル（可決等）が現れる。
    await expect(async () => {
      const results = panel.locator("li", { hasText: /(可決|否決|不備|その他)/ });
      expect(await results.count()).toBeGreaterThan(0);
    }).toPass({ timeout: 30_000 });
  });

  test("審査が無い顧客では空状態メッセージが表示される", async ({ page }) => {
    // 同 describe の先行テスト（#1/#2）が「佐藤 一馬」に審査を残しうるため、空状態前提を
    // 担保すべく当該顧客のローン審査を削除してから検証する。
    cleanupDemoLoanReviews();

    await signInAsDemo(page);
    await openSeededCustomer(page);

    await page.getByRole("tab", { name: "ローン審査", exact: true }).click();
    // 審査サブタブが active のとき tabpanel が入れ子になり getByRole('tabpanel') が複数
    // 解決するため、外側のローン審査タブパネル（accessible name = "ローン審査" exact）へ scope。
    const panel = page.getByRole("tabpanel", { name: "ローン審査", exact: true });
    await expect(panel).toBeVisible();

    // 「佐藤 一馬」(seed s=0) は審査 0 件 → 空状態メッセージ。審査サブタブは出ない。
    await expect(
      panel.getByText("ローン審査はまだありません。「審査を追加」から作成してください。"),
    ).toBeVisible();
    await expect(panel.getByRole("tab", { name: /ローン審査\s*#1/ })).toHaveCount(0);
  });
});

test.describe("重複排除（基本情報タブの案件情報埋め込みビュー）", () => {
  test.describe.configure({ timeout: 120_000 });

  test("基本情報タブの案件情報に コール状況 / ローン・団信 が重複表示されない", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    // 既定タブ = 基本情報。タブパネル（案件情報埋め込み含む）を scope する。
    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // 案件情報セクション見出しが基本情報タブ内に統合表示されている
    // （基本情報タブ再設計で「案件情報」→「契約情報」へ改称）。
    await expect(panel.getByText("契約情報").first()).toBeVisible();

    // 専用タブへ集約したセクションは embedded ビューに出ない。
    //  - コール状況セクション見出し（h3）は基本情報タブには無い。
    await expect(panel.getByRole("heading", { name: "コール状況" })).toHaveCount(0);
    //  - ローン・団信セクション見出し（h4）も基本情報タブには無い。
    await expect(panel.getByRole("heading", { name: "ローン・団信" })).toHaveCount(0);
    //  - コール状況専用フィールドラベルも出ない（完工コールステータス等）。
    await expect(panel.locator("dt", { hasText: "完工コールステータス" })).toHaveCount(0);
    await expect(panel.locator("dt", { hasText: "ローン審査ステータス" })).toHaveCount(0);

    // 一方、契約予定情報の案件固有セクションは従来通り表示される。
    // 「工事・完工」(施工コスト含む) は専用「施工状況」タブへ集約されたため embedded には出ない。
    // 概況は現状情報側へ移設されたため契約情報側の検証対象から外す。
    for (const label of ["契約・金額", "特記事項"]) {
      await expect(
        panel.getByText(label).first(),
        `案件情報セクション「${label}」は従来通り表示される`,
      ).toBeVisible();
    }
  });
});
