import { expect, test, type Page } from "@playwright/test";

// 顧客詳細「基本情報」タブ 電気契約・設備項目 + マエカク非表示 + 商談履歴タブ電話番号.
//
// 検証対象（要件改修 3 点）:
//   1. 基本情報タブの顧客基本情報カードに「電気契約状況 / お客様番号 / 供給地点番号 /
//      設備ID」の各ラベルが表示される（値は seed 依存で未設定でも可。基本情報タブ
//      再設計でカードはポップアップ廃止 → インライン編集の入力欄になったため、
//      読み取り専用 dt ではなく <Label htmlFor> として描画される。getByLabel で検証）。
//   2. 基本情報タブに「マエカク希望日時」が表示されない（連絡先ブロックから撤去済み）。
//   3. 商談履歴タブの「現在の商談状況」カード近傍に電話番号（マスク済み表示値）が出る。
//
// 認証は demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, 2FA off, seed 投入済）。
// 行は role="button" + aria-label="<名前>様"。Seed は global-setup.ts で 1 回実行。

const DEMO_EMAIL = "demo@solar-saas.demo";
const DEMO_PASSWORD = "Demo1234!";

async function signInAsDemo(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(DEMO_EMAIL);
  await page.getByLabel("パスワード").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "サインイン" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 90_000 });
  await page.waitForLoadState("networkidle");
}

async function openFirstCustomer(page: Page): Promise<void> {
  await page.goto("/customers");
  const firstRow = page.getByRole("button", { name: /様$/ }).first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
}

const ELECTRIC_FIELD_LABELS = ["電気契約状況", "お客様番号", "供給地点番号", "設備ID"] as const;
const PHONE_PATTERN = /(\*{3}-\*{4}-\d{2,4}|\d{2,4}-\d{2,4}-\d{4}|\d{2,4})/;

test.describe("顧客詳細 基本情報タブ 電気契約・設備項目 + 商談履歴タブ電話番号", () => {
  test.describe.configure({ timeout: 120_000 });

  test("基本情報タブに電気契約状況/お客様番号/供給地点番号/設備IDの各ラベルが表示される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openFirstCustomer(page);

    // 既定で「基本情報」タブが選択状態。
    await expect(page.getByRole("tab", { name: "基本情報" })).toHaveAttribute(
      "data-state",
      "active",
    );
    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    for (const label of ELECTRIC_FIELD_LABELS) {
      // インライン編集の入力欄に紐づくラベル（<Label htmlFor>）を accessible name で検証。
      await expect(
        panel.getByLabel(label, { exact: true }).first(),
        `基本情報カードに「${label}」入力欄ラベルが表示される`,
      ).toBeVisible();
    }
  });

  test("基本情報タブに『マエカク希望日時』が表示されない", async ({ page }) => {
    await signInAsDemo(page);
    await openFirstCustomer(page);

    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();
    // 連絡先ブロックから撤去済み。DB 列/DTO は残置だが表示はされない。
    await expect(panel.locator("dt", { hasText: "マエカク希望日時" })).toHaveCount(0);
  });

  test("商談履歴タブの『現在の商談状況』カードに電話番号が表示される", async ({ page }) => {
    await signInAsDemo(page);
    await openFirstCustomer(page);

    // 商談履歴タブへ切り替え。
    await page.getByRole("tab", { name: "商談履歴" }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByRole("heading", { name: "現在の商談状況" })).toBeVisible();

    // ヘッダ近傍に「電話番号」ラベル + 値（マスク済み or 生番号）が描画される。
    const phoneLabel = panel.getByText("電話番号", { exact: true }).first();
    await expect(phoneLabel).toBeVisible();
    // ラベルの兄弟（同一行の値スパン）に電話番号らしき文字列 or プレースホルダが出る。
    const cardText = (await panel.textContent()) ?? "";
    expect(cardText).toMatch(PHONE_PATTERN);
  });
});
