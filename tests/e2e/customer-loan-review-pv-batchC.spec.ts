import { expect, test, type Page } from "@playwright/test";

// バッチ C ローン審査ステータス + PV設置図面（カテゴリ分離）.
//
// 検証対象:
//   1. ローン審査ステータス: 案件情報「契約・金額・ローン」の「ローン・団信」ブロックに
//      ContractPayment.loanReviewStatus が表示される。F-062 契約編集ダイアログで
//      4 値（審査前/審査中/完了/不備在り）から選択・保存 → 表示反映。
//   2. PV設置図面: 施工状況タブに「PV設置図面」アップロードセクションが表示され、
//      seed 投入の PV_DRAWING ファイルがそのスロットに描画される。
//   3. カテゴリ相互排他: PV_DRAWING は施工状況タブのみ。関連ファイルタブ（GENERAL）/
//      設置申請状況タブの申請関連ドキュメント（APPLICATION）には出ない。逆も成立。
//
// R2 は本環境では placeholder 認証のため実 PUT は通らない。よって既存
// customer-application-files.spec と同方針で、seed が投入したメタデータ行
// （一覧描画は DB 行だけで成立）のカテゴリ別描画でカテゴリ分離を検証する。
// seed（seedCustomerActivities, i===0）は先頭サンプル顧客「サンプル佐藤 一郎」に
//   GENERAL: 見積書サンプル.pdf / APPLICATION: 設置申請書サンプル.pdf /
//   PV_DRAWING: PV設置図面サンプル.pdf
// を冪等投入する。
//
// 認証は demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, 2FA off, seed 投入済）。
// Seed は tests/e2e/global-setup.ts で全 spec 起動前に 1 回だけ実行される。
// workers:1 + fullyParallel:false（playwright.config.ts）に追従。

const DEMO_EMAIL = "demo@solar-saas.demo";
const DEMO_PASSWORD = "Demo1234!";

// seed の先頭サンプル顧客「サンプル佐藤 一郎」を生 name の contains 検索で一意に絞る。
const SEEDED_CUSTOMER_QUERY = "サンプル佐藤";
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

async function openContractedCustomer(page: Page): Promise<void> {
  await page.goto("/customers?contractStatus=contracted");
  const firstRow = page.getByRole("button", { name: /様$/ }).first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
}

async function gotoSeededCustomerDetail(page: Page): Promise<void> {
  await page.goto(`/customers?query=${encodeURIComponent(SEEDED_CUSTOMER_QUERY)}`);
  const row = page.getByRole("button", { name: /様$/ }).first();
  await expect(row).toBeVisible();
  await row.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
}

// 1 つの「ラベル → 値」(MetaItem) について、ラベルに隣接する dd 値テキストを取得。
async function metaValue(panelLocator: ReturnType<Page["getByRole"]>, label: string): Promise<string> {
  const dt = panelLocator.locator("dt", { hasText: label }).first();
  await expect(dt, `MetaItem ラベル「${label}」が存在する`).toBeVisible();
  const dd = dt.locator("xpath=following-sibling::dd[1]");
  return ((await dd.textContent()) ?? "").trim();
}

test.describe("バッチ C ローン審査ステータス（案件情報ローン・団信ブロック）", () => {
  test.describe.configure({ timeout: 120_000 });

  test("ローン審査ステータスが表示され、契約編集ダイアログで『審査中』に変更保存 → 反映される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // ローン・団信ブロック見出し + ローン審査ステータスラベルが描画される。
    await expect(panel.getByRole("heading", { name: "ローン・団信" }).first()).toBeVisible();
    await expect(panel.locator("dt", { hasText: "ローン審査ステータス" }).first()).toBeVisible();

    // 表示値は 4 値ラベルのいずれか（seed は seq % 4 で確実に設定）。
    const before = await metaValue(panel, "ローン審査ステータス");
    expect(
      before,
      `ローン審査ステータス「${before}」が 4 値ラベルのいずれか`,
    ).toMatch(/(審査前|審査中|完了|不備在り)/);

    // 契約編集ダイアログを開く。
    await panel.getByRole("button", { name: "契約・金額・ローンを編集" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // ローン審査ステータスの select に 4 値 + 未設定が存在する。
    const select = dialog.locator("#ct-loanreview");
    await expect(select).toBeVisible();
    const optionTexts = (await select.locator("option").allTextContents()).map((t) => t.trim());
    for (const label of LOAN_REVIEW_LABELS) {
      expect(optionTexts, `プルダウンに「${label}」が含まれる`).toContain(label);
    }

    // 「審査中」(= reviewing) を選択して保存する。
    await select.selectOption("reviewing");
    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // 保存後、ローン・団信ブロックに「審査中」が反映される。
    await expect(async () => {
      const after = await metaValue(panel, "ローン審査ステータス");
      expect(after).toBe("審査中");
    }).toPass({ timeout: 30_000 });
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
    await page.getByRole("tab", { name: "施工状況" }).click();
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
    await page.getByRole("tab", { name: "設置申請状況" }).click();
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
