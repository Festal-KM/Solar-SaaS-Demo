import { expect, test, type Page } from "@playwright/test";

// F-062 案件情報インライン編集 (docs/05 §16).
//
// 顧客詳細「基本情報」タブに統合された案件情報ビュー（CustomerProjectInfo embedded）の
// 各セクションを、見出し右の鉛筆トリガー → Dialog 保存で編集できることを検証する。
//
// 検証対象:
//   1. 卸業者(customer.update 権限あり): 概況 / ヒアリング / 契約 / 工事 / 認定 の各
//      セクションに編集トリガーが出て、ダイアログ保存で toast + 表示更新される。
//   2. 粗利・インセンティブ・金額サマリ等の自動算出セクションには編集 UI が無い。
//   3. 概況の保存が DB 反映され、再描画後に表示が更新される（住居種別を例に）。
//
// 認証は demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, 2FA off, seed 投入済）。
// Seed は tests/e2e/global-setup.ts で全 spec 起動前に 1 回だけ実行される。

const DEMO_EMAIL = "demo@solar-saas.demo";
const DEMO_PASSWORD = "Demo1234!";

async function signInAsDemo(page: Page): Promise<void> {
  // /login の cold-compile を吸収するため goto を長め + サインインボタン可視を待つ。
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

test.describe("F-062 案件情報インライン編集（基本情報タブ統合ビュー）", () => {
  test.describe.configure({ timeout: 120_000 });

  test("卸業者: 概況/ヒアリング/契約/設備明細 に編集トリガーが出る（工事/認定は行があれば出る）", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // 契約済み顧客で必ず存在するセクションの編集トリガー（aria-label で識別）。
    for (const label of ["概況を編集", "ヒアリングを編集", "契約・金額・ローンを編集"]) {
      await expect(
        panel.getByRole("button", { name: label }).first(),
        `編集トリガー「${label}」が表示される`,
      ).toBeVisible();
    }

    // 設備明細カードにも編集トリガーが出る（契約配下の設備行）。
    await expect(
      panel.getByRole("button", { name: /設備明細を編集/ }).first(),
      "設備明細の編集トリガー",
    ).toBeVisible();

    // 工事・完工 / 認定・設備 は行があるときのみ編集トリガーが出る（行が無い顧客では
    // プレースホルダのみ）。行がある場合に限りトリガーを検証する。
    const hasConstruction = (await panel.getByText("施工情報がありません").count()) === 0;
    if (hasConstruction) {
      await expect(panel.getByRole("button", { name: "工事・完工を編集" }).first()).toBeVisible();
    }
    const hasApplication = (await panel.getByText("認定・申請情報がありません").count()) === 0;
    if (hasApplication) {
      await expect(
        panel.getByRole("button", { name: "認定・設備（申請）を編集" }).first(),
      ).toBeVisible();
    }
  });

  test("自動算出セクション（金額サマリ）に編集 UI が無い", async ({ page }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // インセンティブ対象粗利 / インセンティブ額（自動算出）は表示のみで編集トリガーを持たない。
    await expect(panel.getByText("インセンティブ対象粗利").first()).toBeVisible();
    // 粗利・インセンティブ専用の編集トリガーは存在しない（aria-label に該当語が無い）。
    await expect(page.getByRole("button", { name: /粗利を編集|インセンティブを編集/ })).toHaveCount(0);
  });

  test("契約編集: ローン会社を保存するとローン情報タブに反映される", async ({ page }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    // ローン会社（ローン・団信ブロック）は専用「ローン情報」タブへ集約済み。
    // 編集トリガーと値表示が同居する当該タブで保存→反映を検証する。
    await page.getByRole("tab", { name: "ローン情報" }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    await panel.getByRole("button", { name: "契約・金額・ローンを編集" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const unique = `信販E2E${Date.now()}`;
    await dialog.getByLabel("ローン会社").fill(unique);
    await dialog.getByRole("button", { name: "保存" }).click();

    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(panel.getByText(unique).first()).toBeVisible({ timeout: 30_000 });
  });

  test("概況編集: 住居種別を保存すると表示が更新される", async ({ page }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // 概況の編集トリガーを開く。
    await panel.getByRole("button", { name: "概況を編集" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // 一意な値で住居種別を更新する（再描画後に検出できるようタイムスタンプ付き）。
    const unique = `戸建E2E${Date.now()}`;
    const housing = dialog.getByLabel("住居種別");
    await housing.fill(unique);
    await dialog.getByRole("button", { name: "保存" }).click();

    // ダイアログが閉じ、概況セクションに新値が描画される。
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(panel.getByText(unique).first()).toBeVisible({ timeout: 30_000 });
  });
});
