import { expect, test, type Page } from "@playwright/test";

// 顧客詳細「商談履歴」タブ 3 点改修の E2E 検証 (docs/02 F-031 系 / docs/05 §16).
//
// 検証対象（今回の変更）:
//   1. マエカク希望日時: 商談状況パネル(NegotiationStatusPanel)に datetime-local 入力
//      (#neg-maekaku-preferred) が追加され、値変更 → 保存 → 再描画後に反映される
//      (updateCustomerAction の maekakuPreferredAt)。seed は全顧客に maekakuPreferredAt
//      を投入済なので初期値が描画される。
//   2. 担当者選択: 商談履歴登録ダイアログ(NewActivityDialog)に担当者 select
//      (#activity-assignee) が追加される。既定はこの顧客のクロージング担当
//      （seed では大半の顧客で未設定なので「未設定」が既定。設定済みの顧客では当該担当が
//      自動選択される）。明示的に担当者を選択して登録 → 履歴一覧(CustomerHistory)に
//      「担当：<名前>」表示。作成者(createdByUserId)とは別概念。
//   3. 見積書ファイル: 見積セクションで「見積を記録」(category="quote") → 当該見積
//      アクティビティに紐づく見積書ファイル UI(quote-files.tsx, #quote-file-input-<id> /
//      「見積書ファイル」/「添付ファイルはありません」/「見積書を添付」)が描画される。
//      R2 実 PUT は placeholder で通らないため、アップロード UI とカテゴリ別描画の存在で
//      検証する（既存 application-files / PV図面 / 契約ファイルと同方針）。
//
// 認証は demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, 2FA off, seed 投入済）。
// 行は role="button" + aria-label="<姓>様"。Seed は global-setup で 1 回だけ db:seed 実行。
// workers:1 + fullyParallel:false（playwright.config.ts）に追従。
//
// 対象顧客はマスク名が重複し得るため、一覧をフィルタして先頭行（/様$/）を辿る方式で
// 安定して詳細へ遷移する。履歴は対象顧客で空でも構わない（テスト内で自前に登録して反映を見る）。

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

// 契約済みでフィルタした一覧の先頭行から顧客詳細へ遷移する（マスク名の重複に依存しない）。
async function openContractedDetail(page: Page): Promise<void> {
  await page.goto("/customers?contractStatus=contracted");
  const row = page.getByRole("button", { name: /様$/ }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
}

// 「商談履歴」タブへ切り替える。
async function gotoHistoryTab(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "商談履歴" }).click();
  await expect(page.getByRole("tab", { name: "商談履歴" })).toHaveAttribute("data-state", "active");
}

test.describe("顧客詳細『商談履歴』タブ 3 点改修", () => {
  // dev サーバの cold-compile（/login → /customers → /customers/[id]）を吸収するため拡張。
  test.describe.configure({ timeout: 120_000 });

  test("1. マエカク希望日時: datetime-local 入力欄があり、保存 → 再描画後に反映される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedDetail(page);
    await gotoHistoryTab(page);

    const panel = page.getByRole("tabpanel");
    // 商談状況パネルに「マエカク希望日時」ラベル + datetime-local 入力欄が存在する。
    await expect(panel.getByText("マエカク希望日時", { exact: true }).first()).toBeVisible();
    const input = page.locator("#neg-maekaku-preferred");
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute("type", "datetime-local");
    // seed が maekakuPreferredAt を投入済なので初期値が datetime-local 形式で入っている。
    const before = await input.inputValue();
    expect(before, "初期値が seed から描画される（datetime-local 形式）").toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
    );

    // 一意な新しい値（翌年 03/14 09:30 固定）に書き換える。
    const next = `${new Date().getFullYear() + 1}-03-14T09:30`;
    expect(next, "テスト値は初期値と異なる").not.toBe(before);
    await input.fill(next);

    // 商談状況パネルの「保存」ボタン（パネル内に 1 つ）。
    await panel.getByRole("button", { name: "保存", exact: true }).first().click();

    // 保存後の router.refresh() を待ち、再取得した入力欄に新しい値が反映されている。
    await expect
      .poll(async () => page.locator("#neg-maekaku-preferred").inputValue(), { timeout: 30_000 })
      .toBe(next);

    // フルリロードしても永続化されている（DB 反映の確証）。
    await page.reload();
    await gotoHistoryTab(page);
    await expect(page.locator("#neg-maekaku-preferred")).toHaveValue(next, { timeout: 30_000 });
  });

  test("2. 担当者選択: 登録ダイアログに担当者 select があり、選択して登録 → 履歴に担当者名が表示される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedDetail(page);
    await gotoHistoryTab(page);

    const panel = page.getByRole("tabpanel");

    // 商談履歴カードの「新規記録」ダイアログを開く。
    await panel.getByRole("button", { name: "新規記録" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // 担当者 select が存在する。既定はクロージング担当（未設定の顧客では「未設定」）。
    const assignee = dialog.locator("#activity-assignee");
    await expect(assignee).toBeVisible();
    const defaultLabel = (await assignee.locator("option:checked").textContent())?.trim();
    // クロージング担当が設定済みならその名前、未設定なら「未設定」。いずれも許容（要件）。
    expect(defaultLabel, "既定は『未設定』またはクロージング担当名").toBeTruthy();

    // 実在する自社社員（先頭の実ユーザー option, index 1）を明示選択し、その名前を控える。
    const realOption = assignee.locator("option").nth(1);
    const assigneeName = (await realOption.textContent())?.trim() ?? "";
    expect(assigneeName.length, "担当者候補（自社社員）が 1 件以上ある").toBeGreaterThan(0);
    const assigneeValue = (await realOption.getAttribute("value")) ?? "";
    await assignee.selectOption(assigneeValue);

    // 種別はコール、詳細に一意なマーカーを入力して登録する。
    await dialog.locator("#activity-category").selectOption("phone");
    const marker = `E2E担当者テスト${Date.now() % 1000000}`;
    await dialog.locator("#activity-detail").fill(marker);

    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // 履歴一覧に登録した詳細が表示され、選択した担当者名が「担当：<名前>」で出る。
    await expect(panel.getByText(marker)).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText(`担当：${assigneeName}`).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("2b. 担当者の既定値: クロージング担当が設定済みの顧客では当該担当が自動選択される", async ({
    page,
  }) => {
    await signInAsDemo(page);

    // seed でクロージング担当が設定済みの契約済み顧客「吉田 美穂」（担当=鈴木 大輔）を
    // 一覧検索で引き当てる。同姓が複数いるため、検索 + 行クリック後、商談履歴タブの
    // 登録ダイアログで「未設定以外（=クロージング担当名）」が既定選択かを順に検査し、
    // 設定済みの顧客に当たるまで先頭数件を辿る。
    await page.goto("/customers?contractStatus=contracted");
    const rows = page.getByRole("button", { name: /様$/ });
    const count = Math.min(await rows.count(), 12);
    expect(count, "契約済み顧客が 1 件以上ある").toBeGreaterThan(0);

    let foundClosingDefault = false;
    for (let i = 0; i < count; i += 1) {
      await page.goto("/customers?contractStatus=contracted");
      const row = page.getByRole("button", { name: /様$/ }).nth(i);
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.click();
      await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
      await gotoHistoryTab(page);

      const panel = page.getByRole("tabpanel");
      await panel.getByRole("button", { name: "新規記録" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const checked = (
        await dialog.locator("#activity-assignee option:checked").textContent()
      )?.trim();
      // 既定が「未設定」以外 = クロージング担当が自動選択されている。
      if (checked && checked !== "未設定") {
        // その値が候補一覧の実ユーザー option のいずれかと一致する（=有効な自社社員）。
        const optionTexts = await dialog.locator("#activity-assignee option").allTextContents();
        expect(optionTexts.map((t) => t.trim())).toContain(checked);
        foundClosingDefault = true;
        break;
      }
      // 閉じて次の顧客へ。
      await page.keyboard.press("Escape");
    }

    expect(
      foundClosingDefault,
      "クロージング担当が設定済みの顧客で、登録ダイアログの担当者既定がクロージング担当になる",
    ).toBe(true);
  });

  test("3. 見積書ファイル: 見積を記録 → 当該見積に見積書ファイルのアップロード/一覧 UI が描画される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedDetail(page);
    await gotoHistoryTab(page);

    const panel = page.getByRole("tabpanel");

    // 見積セクション見出し（「見積」）が存在する。
    await expect(panel.getByRole("heading", { name: "見積", exact: true })).toBeVisible();

    // 「見積を記録」ダイアログを開く（defaultCategory="quote"）。
    await panel.getByRole("button", { name: "見積を記録" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // 見積モードでは金額入力欄が表示される（quote 専用）。
    await expect(dialog.locator("#activity-amount")).toBeVisible();
    await dialog.locator("#activity-amount").fill("3500000");
    const marker = `E2E見積記録${Date.now() % 1000000}`;
    await dialog.locator("#activity-detail").fill(marker);

    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // 見積セクションに登録した見積（金額 + 詳細）が描画される。
    await expect(panel.getByText(marker)).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText("¥3,500,000").first()).toBeVisible({ timeout: 30_000 });

    // 当該見積アクティビティに見積書ファイル UI(quote-files.tsx) が描画される。
    // R2 実 PUT は走らせない。UI 存在 + カテゴリ別描画（未添付プレースホルダ）で検証する。
    await expect(panel.getByText("見積書ファイル").first()).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText("添付ファイルはありません").first()).toBeVisible();
    // 見積書添付用の file input（aria-label「見積書を添付」）が存在する。
    await expect(panel.getByLabel("見積書を添付").first()).toBeVisible();
  });
});
