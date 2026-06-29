import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

// 本 spec のローン審査テストは「佐藤 一馬」に新規審査を作る。各テストは自前の審査を削除するが、
// 取り残しに備え afterAll で当該顧客のローン審査を全削除し、空状態前提の他 spec への汚染を防ぐ。
function cleanupDemoLoanReviews(): void {
  const script = resolve(__dirname, "fixtures", "cleanup-demo-loan-reviews.ts");
  const dbDir = resolve(__dirname, "..", "..", "packages", "db");
  execFileSync("pnpm", ["exec", "tsx", script], {
    cwd: dbDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

// バッチ C ローン審査ステータス + PV設置図面（カテゴリ分離）.
//
// 検証対象:
//   1. ローン審査ステータス: 専用「ローン審査」タブの審査サブタブで独立 LoanReview の
//      審査ステータスをインライン編集（#lr-status-<id> select）し、4 値
//      （審査前/審査中/完了/不備在り）から選択・保存 → 値が保持される。
//      （旧構成では Contract.loanReviewStatus を契約編集ダイアログで編集していたが、
//       独立 LoanReview とローン審査タブのインライン編集へ移行済み。）
//   2. PV設置図面: 施工状況タブに「PV設置図面」アップロードセクションが表示され、
//      seed 投入の PV_DRAWING ファイルがそのスロットに描画される。
//   3. カテゴリ相互排他: PV_DRAWING は施工状況タブのみ。関連ファイルタブ（GENERAL）/
//      設置申請状況タブの申請関連ドキュメント（APPLICATION）には出ない。逆も成立。
//
// R2 は本環境では placeholder 認証のため実 PUT は通らない。よって既存
// customer-application-files.spec と同方針で、seed が投入したメタデータ行
// （一覧描画は DB 行だけで成立）のカテゴリ別描画でカテゴリ分離を検証する。
// seed（seedCustomerActivities, i===0）は先頭サンプル顧客「佐藤 一馬」に
//   GENERAL: 見積書サンプル.pdf / APPLICATION: 設置申請書サンプル.pdf /
//   PV_DRAWING: PV設置図面サンプル.pdf
// を冪等投入する。
//
// 認証は demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, 2FA off, seed 投入済）。
// Seed は tests/e2e/global-setup.ts で全 spec 起動前に 1 回だけ実行される。
// workers:1 + fullyParallel:false（playwright.config.ts）に追従。

const DEMO_EMAIL = "demo@solar-saas.demo";
const DEMO_PASSWORD = "Demo1234!";

// seed の先頭サンプル顧客「佐藤 一馬」を生 name の contains 検索で一意に絞る。
const SEEDED_CUSTOMER_QUERY = "佐藤 一馬";
const GENERAL_FILE = "見積書サンプル.pdf";
const APPLICATION_FILE = "設置申請書サンプル.pdf";
const PV_DRAWING_FILE = "PV設置図面サンプル.pdf";

// ローン審査ステータスの 4 値ラベル（loanReviewStatusLabels / LOAN_REVIEW_STATUS_VALUES）。
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

async function gotoSeededCustomerDetail(page: Page): Promise<void> {
  await page.goto(`/customers?query=${encodeURIComponent(SEEDED_CUSTOMER_QUERY)}`);
  const row = page.getByRole("button", { name: /様$/ }).first();
  await expect(row).toBeVisible();
  await row.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
}

test.describe("バッチ C ローン審査ステータス（独立 LoanReview・審査サブタブ）", () => {
  test.describe.configure({ timeout: 120_000 });

  test.afterAll(() => {
    cleanupDemoLoanReviews();
  });

  test("審査サブタブの審査ステータスを『審査中』に変更保存 → 値が保持される", async ({
    page,
  }) => {
    // 既存審査の status が既に "reviewing" だとインライン編集が dirty にならず保存ボタンが
    // disabled のままになり click がハングする。新規追加した審査は既定 "not_reviewed" なので
    // 「審査中」への変更が必ず dirty になる。空顧客「佐藤 一馬」に新規審査を作って検証する。
    await signInAsDemo(page);
    await gotoSeededCustomerDetail(page);

    // 専用「ローン審査」タブへ切り替え。審査サブタブが active のとき tabpanel が入れ子になり
    // getByRole('tabpanel') が複数解決するため、外側のローン審査タブパネル（accessible name =
    // "ローン審査" exact）へ scope する。
    await page.getByRole("tab", { name: "ローン審査", exact: true }).click();
    const panel = page.getByRole("tabpanel", { name: "ローン審査", exact: true });
    await expect(panel).toBeVisible();

    // 「審査を追加」で新規審査（既定 not_reviewed）を作り、その審査サブタブを対象にする。
    await panel.getByRole("button", { name: "審査を追加" }).first().click();
    await expect(panel.getByRole("tab", { name: /ローン審査\s*#1/ })).toBeVisible({
      timeout: 30_000,
    });

    // 審査サマリのインライン編集 select（#lr-status-<id>）に 4 値が存在する。
    const select = panel.locator('select[id^="lr-status-"]').first();
    await expect(select).toBeVisible();
    const lrId = (await select.getAttribute("id"))!.replace("lr-status-", "");
    const optionTexts = (await select.locator("option").allTextContents()).map((t) => t.trim());
    for (const label of LOAN_REVIEW_LABELS) {
      expect(optionTexts, `審査ステータス select に「${label}」が含まれる`).toContain(label);
    }

    // 「審査中」(= reviewing) を選択して保存する（新規審査は not_reviewed なので必ず dirty）。
    await select.selectOption("reviewing");
    await expect(panel.getByRole("button", { name: "保存" }).first()).toBeEnabled();
    await panel.getByRole("button", { name: "保存" }).first().click();

    // 保存後の再描画でも当該審査の審査ステータス select が「審査中」(reviewing) を保持する。
    await expect(panel.locator(`#lr-status-${lrId}`)).toHaveValue("reviewing", { timeout: 30_000 });

    // 後片付け: 追加した審査を削除して原状回復（佐藤 一馬 = 審査 0 件の不変条件）。
    page.once("dialog", (d) => d.accept());
    await panel.getByRole("button", { name: "審査を削除" }).click();
    await expect(panel.locator(`#lr-status-${lrId}`)).toHaveCount(0, { timeout: 30_000 });
  });
});

test.describe("バッチ C PV設置図面（施工状況タブ + カテゴリ相互排他）", () => {
  test.describe.configure({ timeout: 120_000 });

  test("施工状況タブに『PV設置図面』セクションが表示され PV_DRAWING ファイルが描画される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await gotoSeededCustomerDetail(page);

    // 施工状況タブへ切り替え。
    await page.getByRole("tab", { name: "施工" }).click();
    const constructionPanel = page.getByRole("tabpanel");
    await expect(constructionPanel).toBeVisible();

    // 「PV設置図面」見出し + PV_DRAWING ファイルが描画される。
    await expect(
      constructionPanel.getByRole("heading", { name: "PV設置図面" }),
    ).toBeVisible();
    await expect(constructionPanel.getByText(PV_DRAWING_FILE)).toBeVisible();

    // 他カテゴリのファイルは施工状況タブには出ない。
    await expect(constructionPanel.getByText(GENERAL_FILE)).toHaveCount(0);
    await expect(constructionPanel.getByText(APPLICATION_FILE)).toHaveCount(0);
  });

  test("PV設置図面は関連ファイルタブ・設置申請タブには出ない（カテゴリ相互排他）", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await gotoSeededCustomerDetail(page);

    // 関連ファイルタブ（GENERAL）に PV_DRAWING / APPLICATION は出ない。
    await page.getByRole("tab", { name: "関連ファイル" }).click();
    const filesPanel = page.getByRole("tabpanel");
    await expect(filesPanel).toBeVisible();
    await expect(filesPanel.getByText(GENERAL_FILE)).toBeVisible();
    await expect(filesPanel.getByText(PV_DRAWING_FILE)).toHaveCount(0);
    await expect(filesPanel.getByText(APPLICATION_FILE)).toHaveCount(0);

    // 設置申請状況タブ（申請関連ドキュメント = APPLICATION）に PV_DRAWING は出ない。
    await page.getByRole("tab", { name: "設置申請" }).click();
    const subsidyPanel = page.getByRole("tabpanel");
    await expect(subsidyPanel).toBeVisible();
    await expect(
      subsidyPanel.getByRole("heading", { name: "申請関連ドキュメント" }),
    ).toBeVisible();
    await expect(subsidyPanel.getByText(APPLICATION_FILE)).toBeVisible();
    await expect(subsidyPanel.getByText(PV_DRAWING_FILE)).toHaveCount(0);
    await expect(subsidyPanel.getByText(GENERAL_FILE)).toHaveCount(0);
  });
});
