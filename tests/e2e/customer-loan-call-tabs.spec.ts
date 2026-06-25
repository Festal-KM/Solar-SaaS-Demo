import { expect, test, type Page } from "@playwright/test";

// 顧客詳細「コール状況」タブ + 「ローン情報」タブ（専用タブ集約 / docs/02 §16）.
//
// 検証対象（今回の変更）:
//   1. コール状況タブ: 完工/ローン完了コール状況・希望日時・汎用希望時間帯・
//      マエカク希望電話・マエカクステータスを表示。EditCallStatusDialog で
//      完工コールステータスを変更保存 → 再描画後に反映される。
//   2. ローン情報タブ: 顧客に紐づく全契約のローン・団信（loanReviewStatus 含む）を
//      契約ごとに一覧表示。EditContractDialog で「審査中」に変更保存 → 反映される。
//      契約が無い顧客は空状態メッセージ（loanTab.empty）を表示する。
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
// コール状況（完工/ローン完了）の 3 値ラベル（callPhaseStatusLabels）。
const CALL_PHASE_LABELS = ["実施前", "実施済", "不要"] as const;

async function signInAsDemo(page: Page): Promise<void> {
  await page.goto("/login", { timeout: 120_000 });
  await page.getByLabel("メールアドレス").fill(DEMO_EMAIL);
  await page.getByLabel("パスワード").fill(DEMO_PASSWORD);
  const submit = page.getByRole("button", { name: "サインイン" });
  await expect(submit).toBeVisible();
  await submit.click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 });
}

// 契約済み顧客（ローン情報タブに契約が出る顧客）を開く。
async function openContractedCustomer(page: Page): Promise<void> {
  await page.goto("/customers?contractStatus=contracted");
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

// 1 つの「ラベル → 値」(MetaItem) について、ラベルに隣接する dd 値テキストを取得。
async function metaValue(
  scope: ReturnType<Page["getByRole"]>,
  label: string,
): Promise<string> {
  const dt = scope.locator("dt", { hasText: label }).first();
  await expect(dt, `MetaItem ラベル「${label}」が存在する`).toBeVisible();
  const dd = dt.locator("xpath=following-sibling::dd[1]");
  return ((await dd.textContent()) ?? "").trim();
}

test.describe("コール状況タブ（専用タブ・Customer 列）", () => {
  test.describe.configure({ timeout: 120_000 });

  test("コール状況の各項目が表示され、完工コールステータスを変更保存 → 反映される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openSeededCustomer(page);

    // コール状況タブへ切り替え。
    await page.getByRole("tab", { name: "コール" }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // 「コール状況」セクション見出し + 主要フィールドのラベルが描画される。
    await expect(
      panel.getByRole("heading", { name: "コール状況" }).first(),
    ).toBeVisible();
    for (const label of [
      "マエカクステータス",
      "マエカク希望電話",
      "完工コールステータス",
      "完工コール希望日時",
      "ローン完了コールステータス",
      "汎用コール希望時間帯",
    ]) {
      await expect(
        panel.locator("dt", { hasText: label }).first(),
        `コール状況フィールド「${label}」が表示される`,
      ).toBeVisible();
    }

    // 完工コールステータスの初期表示値は 3 値ラベルのいずれか（seed は s%3 で確実に設定）。
    const before = await metaValue(panel, "完工コールステータス");
    expect(
      before,
      `完工コールステータス「${before}」が 3 値ラベルのいずれか`,
    ).toMatch(/(実施前|実施済|不要)/);

    // 反映を一意に検出するため、現在値と異なるラベルへ変更する。
    const targetLabel = CALL_PHASE_LABELS.find((l) => l !== before) ?? "実施済";
    const targetValue =
      targetLabel === "実施前" ? "not_done" : targetLabel === "実施済" ? "done" : "unnecessary";

    // 編集ダイアログを開く。
    await panel.getByRole("button", { name: "コール状況を編集" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // 完工コールステータス select を変更して保存。
    const select = dialog.locator("#cl-post-status");
    await expect(select).toBeVisible();
    await select.selectOption(targetValue);
    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // 再描画後、コール状況セクションに変更後ラベルが反映される。
    await expect(async () => {
      const after = await metaValue(panel, "完工コールステータス");
      expect(after).toBe(targetLabel);
    }).toPass({ timeout: 30_000 });
  });
});

test.describe("ローン情報タブ（専用タブ・契約 1:N）", () => {
  test.describe.configure({ timeout: 120_000 });

  test("契約のローン・団信が表示され、loanReviewStatus を『審査中』に変更保存 → 反映される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    // ローン情報タブへ切り替え。
    await page.getByRole("tab", { name: "ローン審査" }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // 契約ブロック見出し（「契約 #1」）+ ローン・団信フィールドが描画される。
    await expect(panel.getByText(/契約\s*#1/).first()).toBeVisible();
    await expect(
      panel.locator("dt", { hasText: "ローン審査ステータス" }).first(),
    ).toBeVisible();
    for (const label of ["ローン審査コール日時", "ローン会社", "頭金", "団体信用生命保険"]) {
      await expect(
        panel.locator("dt", { hasText: label }).first(),
        `ローン・団信フィールド「${label}」が表示される`,
      ).toBeVisible();
    }

    // 表示値は 4 値ラベルのいずれか（seed は seq % 4 で確実に設定）。
    const before = await metaValue(panel, "ローン審査ステータス");
    expect(
      before,
      `ローン審査ステータス「${before}」が 4 値ラベルのいずれか`,
    ).toMatch(/(審査前|審査中|完了|不備在り)/);

    // 契約編集ダイアログを開く（ローン情報タブ内のトリガーに scope）。
    await panel.getByRole("button", { name: "契約・金額・ローンを編集" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // ローン審査ステータス select に 4 値が存在する。
    const select = dialog.locator("#ct-loanreview");
    await expect(select).toBeVisible();
    const optionTexts = (await select.locator("option").allTextContents()).map((t) => t.trim());
    for (const label of LOAN_REVIEW_LABELS) {
      expect(optionTexts, `プルダウンに「${label}」が含まれる`).toContain(label);
    }

    // 「審査中」(= reviewing) を選択して保存。
    await select.selectOption("reviewing");
    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // 再描画後、ローン情報タブのローン審査ステータスに「審査中」が反映される。
    await expect(async () => {
      const after = await metaValue(panel, "ローン審査ステータス");
      expect(after).toBe("審査中");
    }).toPass({ timeout: 30_000 });
  });

  test("契約が無い顧客では空状態メッセージが表示される", async ({ page }) => {
    await signInAsDemo(page);
    await openSeededCustomer(page);

    await page.getByRole("tab", { name: "ローン審査" }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // 「佐藤 一馬」は契約なし → 空状態メッセージ。契約ブロックは出ない。
    await expect(
      panel.getByText("ローン情報を表示できる契約がありません。"),
    ).toBeVisible();
    await expect(panel.getByText(/契約\s*#1/)).toHaveCount(0);
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
    for (const label of ["契約・金額", "認定・設備"]) {
      await expect(
        panel.getByText(label).first(),
        `案件情報セクション「${label}」は従来通り表示される`,
      ).toBeVisible();
    }
  });
});
