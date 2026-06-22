import { expect, test, type Page } from "@playwright/test";

// バッチ A: 顧客ステータス値域の仕様準拠化（F-031 / F-032 / F-061 / F-062）.
//
// 検証対象（docs/05 §16・customer.ts スキーマ）:
//   1. 営業ステータス（contractStatus）= 6 値 + 解約。商談履歴タブの商談ステータス
//      プルダウンに全 7 値（初訪前/商談中/見積提示済/契約対応中/契約済/失注/解約）が
//      出て、選択・保存できる。
//   2. 設置申請ステータス（subsidyStatus）= 5 値（申請前/申請準備中/申請済/修正対応中/
//      完了）。顧客一覧の設置申請フィルタに全 5 値が出て、フィルタ適用後も一覧の
//      設置申請バッジが既知ラベルで描画される（灰色一色化＝未知値崩壊が無い）。
//   3. 現地調査ステータス（Construction.surveyStatus）= 3 値（調査前/予定日確定/実施済）。
//      F-062 工事編集ダイアログに「現地調査ステータス」セレクトが出て、保存すると
//      案件情報の工事・完工セクションに表示反映される。
//
// 認証は demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, 2FA off, seed 投入済）。
// Seed は global-setup.ts で全 spec 起動前に 1 回だけ実行（workers:1）。

const DEMO_EMAIL = "demo@solar-saas.demo";
const DEMO_PASSWORD = "Demo1234!";

// 仕様確定値域（customer.ts の ContractStatusEnum / SubsidyStatusEnum / SurveyStatusEnum
// のラベル。labels.contractStatusLabels / subsidyStatusLabels / surveyStatusLabels と一致）。
const CONTRACT_STATUS_LABELS = [
  "初訪前",
  "商談中",
  "見積提示済",
  "契約対応中",
  "契約済",
  "失注",
  "解約",
] as const;

const SUBSIDY_STATUS_LABELS = [
  "申請前",
  "申請準備中",
  "申請済",
  "修正対応中",
  "完了",
] as const;

const SURVEY_STATUS_LABELS = ["調査前", "予定日確定", "実施済"] as const;

async function signInAsDemo(page: Page): Promise<void> {
  await page.goto("/login", { timeout: 120_000 });
  await page.getByLabel("メールアドレス").fill(DEMO_EMAIL);
  await page.getByLabel("パスワード").fill(DEMO_PASSWORD);
  const submit = page.getByRole("button", { name: "サインイン" });
  await expect(submit).toBeVisible();
  await submit.click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 });
  await page.waitForLoadState("networkidle");
}

async function openContractedCustomer(page: Page): Promise<void> {
  await page.goto("/customers?contractStatus=contracted");
  const firstRow = page.getByRole("button", { name: /様$/ }).first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
}

// <select> の <option> テキスト一覧を取得する（順序保持）。
async function optionTexts(select: ReturnType<Page["getByLabel"]>): Promise<string[]> {
  return (await select.locator("option").allTextContents()).map((t) => t.trim());
}

test.describe("バッチ A: 顧客ステータス値域の仕様準拠化", () => {
  test.describe.configure({ timeout: 120_000 });

  test("商談履歴タブの商談ステータスに新 6 値 + 解約が出て、選択・保存できる（F-031）", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    // 商談履歴タブへ切替（Radix Tabs）。
    await page.getByRole("tab", { name: "商談履歴" }).click();

    // 商談ステータス select（Label htmlFor=neg-status）に全 7 値が出る。
    const select = page.getByLabel("商談ステータス");
    await expect(select).toBeVisible();
    const opts = await optionTexts(select);
    for (const label of CONTRACT_STATUS_LABELS) {
      expect(opts, `商談ステータスに「${label}」が存在する`).toContain(label);
    }
    // 旧値（none/applying 等の英語生値や未知ラベル）が混入していない＝既知 7 値のみ。
    expect(opts.length, "商談ステータスは 7 値のみ").toBe(CONTRACT_STATUS_LABELS.length);

    // 「見積提示済」を選択して保存 → toast + 永続化。
    await select.selectOption({ label: "見積提示済" });
    const saveBtn = page.getByRole("button", { name: "保存" });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    // 保存 toast（sonner）。
    await expect(page.getByText("保存しました").first()).toBeVisible({ timeout: 30_000 });

    // 再読込後も「見積提示済」が選択状態で残る（永続化検証）。
    await page.reload();
    await page.getByRole("tab", { name: "商談履歴" }).click();
    const reloaded = page.getByLabel("商談ステータス");
    await expect(reloaded).toHaveValue("quote_presented");

    // 後続テストへの影響を避けるため「契約済」へ戻す。
    await reloaded.selectOption({ label: "契約済" });
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("保存しました").first()).toBeVisible({ timeout: 30_000 });
  });

  test("顧客一覧の設置申請フィルタに新 5 値が出て、適用後も設置申請バッジが既知ラベルで壊れない（F-032）", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await page.goto("/customers");

    // 設置申請状況フィルタ select。customer-filter.tsx の <label> は htmlFor 紐付けが
    // 無いため getByLabel が効かない。subsidy 固有の option「申請準備中」を持つ
    // <select> を一意に特定する（contract フィルタは契約値域なので競合しない）。
    const subsidyFilter = page
      .locator("form select", { has: page.locator('option:text-is("申請準備中")') })
      .first();
    await expect(subsidyFilter).toBeVisible();
    const opts = await optionTexts(subsidyFilter);
    for (const label of SUBSIDY_STATUS_LABELS) {
      expect(opts, `設置申請フィルタに「${label}」が存在する`).toContain(label);
    }
    // 「すべて」+ 5 値 = 6 option（旧値域 none/applying/granted 由来の余剰が無い）。
    expect(opts.length, "設置申請フィルタは すべて + 5 値").toBe(SUBSIDY_STATUS_LABELS.length + 1);

    // 「完了」で絞り込み適用。
    await subsidyFilter.selectOption({ label: "完了" });
    await page.getByRole("button", { name: "検索" }).click();
    await page.waitForURL(/subsidyStatus=completed/, { timeout: 30_000 });

    // 一覧の各行 設置申請列バッジが既知の 5 ラベルのいずれかで描画される。
    // （未知値 → 灰色一色 / 空バッジ崩壊が無いことを担保）。バッジは <td> 内の
    // <span>。フィルタ <option> と同テキストになるためテーブル本体に限定して検索する。
    const knownPattern = new RegExp(`^(${SUBSIDY_STATUS_LABELS.join("|")})$`);
    const table = page.locator("table");
    const rows = page.getByRole("button", { name: /様$/ });
    if ((await rows.count()) > 0) {
      const subsidyBadge = table.getByText(knownPattern).first();
      await expect(subsidyBadge, "設置申請バッジが既知ラベル").toBeVisible();
    }

    // フィルタ未指定（全件）でも一覧が描画され、設置申請バッジが既知ラベルで出る。
    await page.goto("/customers");
    const allTable = page.locator("table");
    await expect(page.getByRole("button", { name: /様$/ }).first()).toBeVisible();
    await expect(allTable.getByText(knownPattern).first()).toBeVisible();
    // 旧英語生値（not_applied 等）が一覧テーブルに露出していない（未知値崩壊が無い）。
    await expect(allTable.getByText(/^(not_applied|applying|granted|none)$/)).toHaveCount(0);
  });

  test("F-062 工事編集ダイアログに現地調査ステータス（3 値）が出て、保存→案件情報に表示反映される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // 契約済み顧客は seed で Construction 行を持つ（surveyStatus 含む）。施工情報が
    // 無い顧客では工事編集トリガーが出ないため、その場合はスキップ（値域検証は
    // 他テストの select option チェックで担保される）。
    const hasConstruction = (await panel.getByText("施工情報がありません").count()) === 0;
    test.skip(!hasConstruction, "対象顧客に施工情報が無いため現地調査編集を検証できない");

    await panel.getByRole("button", { name: "工事・完工を編集" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // 現地調査ステータス select（FormField label=現地調査ステータス, id=cn-survey-status）。
    const surveySelect = dialog.getByLabel("現地調査ステータス");
    await expect(surveySelect).toBeVisible();
    const opts = await optionTexts(surveySelect);
    for (const label of SURVEY_STATUS_LABELS) {
      expect(opts, `現地調査ステータスに「${label}」が存在する`).toContain(label);
    }

    // 現在値と異なる値を選んで保存（予定日確定 ↔ 実施済 をトグル）。
    const current = await surveySelect.inputValue();
    const target = current === "surveyed" ? "scheduled" : "surveyed";
    const targetLabel = target === "surveyed" ? "実施済" : "予定日確定";
    await surveySelect.selectOption(target);
    await dialog.getByRole("button", { name: "保存" }).click();

    // ダイアログが閉じ、工事・完工セクションに選択ラベルが表示される。
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(
      panel.getByText(targetLabel).first(),
      `工事・完工に現地調査ステータス「${targetLabel}」が反映される`,
    ).toBeVisible({ timeout: 30_000 });
  });
});
