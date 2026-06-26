import { expect, test, type Page } from "@playwright/test";

// 顧客詳細「コール」タブの追加改修の E2E 検証（docs/02 顧客・コール管理 / docs/05 §16）。
//
// 検証対象（コールタブの追加変更）:
//   1. 電話番号トップ表示: コールタブ最上部に固定電話番号・携帯電話番号（マスク済み）を
//      read-only 表示。デモ卸の piiMaskingMode=MASKED → WHOLESALER は PARTIAL にキャップ
//      されるため「***-****-XXXX」形式で表示される。
//   2. マエカク希望電話の削除: マエカクコール section から「マエカク希望電話」入力/表示が
//      消えていること（旧 #mk-phone なし・ラベル「マエカク希望電話」なし）。
//   3. 過去コール履歴のシンプル化 + 画面追加: 過去コール履歴は「架電日時 / 対応者 / メモ」
//      のみ（CustomerCallLog 由来・calledAt 降順）。画面の追加フォーム（架電日時
//      datetime-local + 対応者 select + メモ + 追加ボタン）で履歴を追加 → toast 成功 →
//      一覧に反映。リロード後も永続化。
//   4. 次回アポ担当者・次回アクション read-only: マエカクコールに「次回アポ日程 / 次回アポ
//      担当者 / 次回アクション」が read-only 表示（コールタブに編集 UI なし）。商談履歴タブの
//      「次回アポ担当者」selector（#neg-next-assignee）+ 次回アクションを保存 → コールタブの
//      マエカクコールに反映される。
//
// 認証は demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, 2FA off, seed 投入済）。
// Seed は tests/e2e/global-setup.ts で全 spec 起動前に 1 回だけ実行。workers:1 +
// fullyParallel:false（tests/e2e/playwright.config.ts）に追従。

const DEMO_EMAIL = "demo@solar-saas.demo";
const DEMO_PASSWORD = "Demo1234!";

// seed: 「高橋 涼介」(s=2) は契約導線あり・全顧客に固定/携帯電話 + 次回アポ担当者投入済。
// 過去コール履歴の追加はテスト内で自前に行うため、seed のコールログ件数には依存しない。
const TARGET_CUSTOMER = "高橋 涼介";

async function signInAsDemo(page: Page): Promise<void> {
  await page.goto("/login", { timeout: 120_000 });
  await page.getByLabel("メールアドレス").fill(DEMO_EMAIL);
  await page.getByLabel("パスワード").fill(DEMO_PASSWORD);
  const submit = page.getByRole("button", { name: "サインイン" });
  await expect(submit).toBeVisible();
  await submit.click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 });
}

// 氏名 contains 検索で絞り、先頭顧客の詳細を開く。
async function openCustomerByName(page: Page, name: string): Promise<void> {
  await page.goto(`/customers?query=${encodeURIComponent(name)}`);
  const row = page.getByRole("button", { name: /様$/ }).first();
  await expect(row).toBeVisible({ timeout: 90_000 });
  await row.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
}

// コールタブへ切り替えてタブパネルを返す。
async function openCallTab(page: Page) {
  await page.getByRole("tab", { name: "コール" }).click();
  const panel = page.getByRole("tabpanel");
  await expect(panel).toBeVisible();
  return panel;
}

// 商談履歴タブへ切り替えてタブパネルを返す。
async function openHistoryTab(page: Page) {
  await page.getByRole("tab", { name: "商談履歴" }).click();
  const panel = page.getByRole("tabpanel");
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("顧客詳細 コールタブ 追加改修", () => {
  test.describe.configure({ timeout: 120_000 });

  test("シナリオ1: コールタブ上部に固定電話・携帯電話（マスク済み）が read-only 表示される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openCustomerByName(page, TARGET_CUSTOMER);
    const panel = await openCallTab(page);

    // 電話番号ヘッダ（見出し + 固定/携帯ラベル）が存在する。
    await expect(panel.getByText("固定電話番号", { exact: true }).first()).toBeVisible();
    await expect(panel.getByText("携帯電話番号", { exact: true }).first()).toBeVisible();

    // ラベル(dt)の直後の値(dd)がマスク形式（***-****-XXXX）で表示される。
    // demo 卸は piiMaskingMode=MASKED → WHOLESALER は PARTIAL にキャップ。
    // 構造: <div><dt>固定電話番号</dt><dd>***-****-XXXX</dd></div>。
    // dt の直後兄弟 dd を XPath で取得する（dt と dd の対応を堅牢に解決）。
    const landlineValue =
      (
        await panel
          .locator('xpath=.//dt[normalize-space()="固定電話番号"]/following-sibling::dd[1]')
          .first()
          .textContent()
      )?.trim() ?? "";
    expect(landlineValue, "固定電話番号がマスク形式（***-****-XXXX）で表示される").toMatch(
      /^\*\*\*-\*\*\*\*-\d{4}$/,
    );

    const mobileValue =
      (
        await panel
          .locator('xpath=.//dt[normalize-space()="携帯電話番号"]/following-sibling::dd[1]')
          .first()
          .textContent()
      )?.trim() ?? "";
    expect(mobileValue, "携帯電話番号がマスク形式（***-****-XXXX）で表示される").toMatch(
      /^\*\*\*-\*\*\*\*-\d{4}$/,
    );
  });

  test("シナリオ2: マエカクコールから「マエカク希望電話」が消滅している", async ({ page }) => {
    await signInAsDemo(page);
    await openCustomerByName(page, TARGET_CUSTOMER);
    const panel = await openCallTab(page);

    // マエカクコール見出しは存在する。
    await expect(panel.getByRole("heading", { name: "マエカクコール" }).first()).toBeVisible();
    // 旧「マエカク希望電話」ラベル・旧 input(#mk-phone) は存在しない（設計変更で廃止）。
    await expect(panel.getByText("マエカク希望電話")).toHaveCount(0);
    await expect(panel.locator("#mk-phone")).toHaveCount(0);
    // マエカクコールのインライン編集（ステータス/希望日時/メモ）は残る。
    await expect(panel.locator("#mk-status")).toBeVisible();
    await expect(panel.locator("#mk-at")).toBeVisible();
    await expect(panel.locator("#mk-note")).toBeVisible();
  });

  test("シナリオ3: 過去コール履歴を画面の追加フォームで追加 → toast → 一覧反映 → 永続化", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openCustomerByName(page, TARGET_CUSTOMER);
    const panel = await openCallTab(page);

    // 過去コール履歴見出し + 追加フォーム（各入力にラベル）が描画される。
    await expect(panel.getByRole("heading", { name: "過去コール履歴" }).first()).toBeVisible();
    const atInput = panel.locator("#cl-at");
    const handlerSelect = panel.locator("#cl-handler");
    const noteInput = panel.locator("#cl-note");
    await expect(atInput).toBeVisible();
    await expect(handlerSelect).toBeVisible();
    await expect(noteInput).toBeVisible();
    // アクセシビリティ: 各入力に <label htmlFor> が紐づく（label[for=id] が存在する）。
    await expect(panel.locator('label[for="cl-at"]')).toHaveText("架電日時");
    await expect(panel.locator('label[for="cl-handler"]')).toHaveText("対応者");
    await expect(panel.locator('label[for="cl-note"]')).toHaveText("メモ");

    // 旧「結果」ラベルは廃止（CustomerCallLog はシンプル 3 列）。
    await expect(panel.locator("dt", { hasText: "結果" })).toHaveCount(0);

    // 追加フォームに架電日時 + 対応者（先頭の実ユーザー）+ 一意メモを入力。
    const calledAt = "2026-09-12T15:45";
    await atInput.fill(calledAt);
    // 対応者 select の先頭実ユーザー（index 1; index 0 は「未選択」）を選ぶ。
    const realHandler = handlerSelect.locator("option").nth(1);
    const handlerName = (await realHandler.textContent())?.trim() ?? "";
    expect(handlerName.length, "対応者候補（自社社員）が 1 件以上ある").toBeGreaterThan(0);
    const handlerValue = (await realHandler.getAttribute("value")) ?? "";
    await handlerSelect.selectOption(handlerValue);

    const uniqueNote = `コールログE2E${Date.now() % 1_000_000}`;
    await noteInput.fill(uniqueNote);

    // 「追加」ボタン（追加フォーム内）押下 → toast 成功。
    const addBtn = panel.getByRole("button", { name: "追加", exact: true }).first();
    await expect(addBtn).toBeEnabled();
    await addBtn.click();
    await expect(page.getByText("保存しました").first()).toBeVisible({ timeout: 30_000 });

    // router.refresh 後、一覧に追加した行（架電日時/対応者/メモ）が表示される。
    // 追加した一意メモを含む履歴行(li)にスコープして、対応者名・架電日時を検証する。
    const newRow = panel.locator("li", { hasText: uniqueNote }).first();
    await expect(newRow).toBeVisible({ timeout: 30_000 });
    await expect(newRow.getByText(handlerName).first()).toBeVisible({ timeout: 30_000 });
    // 架電日時は YYYY/MM/DD HH:mm 形式で表示（2026/09/12 15:45）。
    await expect(newRow.getByText("2026/09/12 15:45").first()).toBeVisible({ timeout: 30_000 });

    // フルリロードで再フェッチしても永続化されている。
    await page.reload();
    const panel2 = await openCallTab(page);
    const reloadedRow = panel2.locator("li", { hasText: uniqueNote }).first();
    await expect(reloadedRow).toBeVisible({ timeout: 30_000 });
    await expect(reloadedRow.getByText("2026/09/12 15:45").first()).toBeVisible({ timeout: 30_000 });
  });

  test("シナリオ4: 商談履歴タブの次回アポ担当者・次回アクションがコールタブに read-only 反映される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openCustomerByName(page, TARGET_CUSTOMER);

    // 商談履歴タブで次回アポ担当者 select + 次回アクションを設定して保存する。
    const histPanel = await openHistoryTab(page);
    const assignee = histPanel.locator("#neg-next-assignee");
    await expect(assignee).toBeVisible();

    // 現在の選択と異なる実ユーザーを選ぶ（反映を一意に検出するため）。option[0] は「未選択」。
    const options = assignee.locator("option");
    const optCount = await options.count();
    expect(optCount, "次回アポ担当者の候補が複数ある（未選択 + 実ユーザー）").toBeGreaterThan(1);
    const currentValue = await assignee.inputValue();
    // 現在値と異なる実ユーザー option を探す。
    let targetValue = "";
    let targetName = "";
    for (let i = 1; i < optCount; i += 1) {
      const v = (await options.nth(i).getAttribute("value")) ?? "";
      if (v && v !== currentValue && !v.startsWith("__")) {
        targetValue = v;
        targetName = (await options.nth(i).textContent())?.trim() ?? "";
        break;
      }
    }
    expect(targetValue, "現在値と異なる実ユーザー候補が存在する").not.toBe("");
    await assignee.selectOption(targetValue);

    // 次回アクションに一意マーカーを入力。
    const uniqueAction = `次回アクションE2E${Date.now() % 1_000_000}`;
    await histPanel.locator("#neg-next-action").fill(uniqueAction);

    // 商談状況パネルの保存ボタン押下 → toast 成功。
    await histPanel.getByRole("button", { name: "保存", exact: true }).first().click();
    await expect(page.getByText("保存しました").first()).toBeVisible({ timeout: 30_000 });

    // 別タブ（コールタブ）はマウント済みクライアント state が router.refresh では再同期されない
    // ため、フルリロードして再マウントしてから検証する。
    await page.reload();
    const callPanel = await openCallTab(page);

    // マエカクコールの read-only 次回アポ表示に担当者名・次回アクションが反映される。
    // 2 カラム化で左カラムのコール履歴追加フォーム（#cl-handler select）に全社員 option が
    // 並ぶため、素の getByText(targetName) は hidden な <option> を先に拾い得る（strict/visible 失敗）。
    // 担当者名は read-only 表示（dt「次回アポ担当者」の直後 dd）にスコープして検証する。
    await expect(callPanel.getByText("次回アポ担当者", { exact: true }).first()).toBeVisible();
    const assigneeValue = callPanel
      .locator('xpath=.//dt[normalize-space()="次回アポ担当者"]/following-sibling::dd[1]')
      .first();
    await expect(assigneeValue).toHaveText(targetName, { timeout: 30_000 });
    // 次回アクションも read-only 表示（dt「次回アクション」の直後 dd）にスコープ。
    const nextActionValue = callPanel
      .locator('xpath=.//dt[normalize-space()="次回アクション"]/following-sibling::dd[1]')
      .first();
    await expect(nextActionValue).toHaveText(uniqueAction, { timeout: 30_000 });

    // コールタブ側には次回アポ担当者の編集 UI（select）が無い（read-only）。
    await expect(callPanel.locator("#neg-next-assignee")).toHaveCount(0);
  });
});
