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

  test("卸業者: 基本情報タブの現状情報にヒアリングのインライン編集フォームが出る（契約系は契約状況タブへ集約され読み取り専用）", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    // 既定の「基本情報」タブ。現状情報側のヒアリング（家族属性・連絡先）は再設計で
    // カード内インライン編集（HearingInlineEdit）へ変更され、ダイアログ鉛筆トリガーでは
    // なく直接の入力欄 + 保存ボタンとして描画される。
    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // ヒアリング親見出し + 家族属性 / 連絡先 のインライン入力欄が描画される。
    await expect(panel.getByRole("heading", { name: "ヒアリング（住環境・家族）" })).toBeVisible();
    await expect(panel.locator("#hr-husband")).toBeVisible();
    await expect(panel.locator("#hr-landline")).toBeVisible();
    // 旧ダイアログ鉛筆トリガー（概況を編集 / ヒアリングを編集）は描画されない（インライン化済み）。
    await expect(panel.getByRole("button", { name: "概況を編集" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "ヒアリングを編集" })).toHaveCount(0);

    // 契約・金額/契約明細/認定の編集面は契約状況タブへ集約された（contractReadOnly）。
    // 基本情報タブの「契約予定情報」pull 表示には契約系の編集トリガーが一切出ない。
    for (const label of [
      "契約・金額・ローンを編集",
      "認定・設備（申請）を編集",
    ]) {
      await expect(
        panel.getByRole("button", { name: label }),
        `基本情報タブの読み取り専用 pull に「${label}」が出ないこと`,
      ).toHaveCount(0);
    }
    await expect(
      panel.getByRole("button", { name: /設備明細を編集/ }),
      "基本情報タブの読み取り専用 pull に設備明細編集トリガーが出ないこと",
    ).toHaveCount(0);
    // 工事・完工（施工コスト）編集は専用「施工状況」タブへ集約されたため基本情報タブには出ない。
    await expect(panel.getByRole("button", { name: "工事・完工を編集" })).toHaveCount(0);
  });

  test("卸業者: 契約状況タブに 契約・金額/商材ライン(インライン)/認定 の編集面が集約される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    // 契約系の編集面は契約状況タブに集約された。
    await page.getByRole("tab", { name: "契約状況" }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // 契約・金額・ローン編集トリガー（鉛筆ダイアログ）が描画される。
    await expect(
      panel.getByRole("button", { name: "契約・金額・ローンを編集" }).first(),
      "契約状況タブの契約編集トリガー",
    ).toBeVisible();
    // 商材ラインはポップアップ廃止 → カード内インライン編集（PV 金額欄が直接描画される）。
    // 旧「設備明細を編集」鉛筆トリガーは契約状況タブには存在しない。
    await expect(
      panel.locator("#eq-amount-PV").first(),
      "契約状況タブの商材インライン金額欄",
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: /設備明細を編集/ }),
      "インライン化により設備明細編集の鉛筆トリガーは出ない",
    ).toHaveCount(0);

    // 認定・設備 は行があるときのみ編集トリガーが出る（行が無い顧客ではプレースホルダのみ）。
    const hasApplication = (await panel.getByText("認定・申請情報がありません").count()) === 0;
    if (hasApplication) {
      await expect(
        panel.getByRole("button", { name: "認定・設備（申請）を編集" }).first(),
      ).toBeVisible();
    }
  });

  test("自動算出セクション（損益計算）に編集 UI が無い", async ({ page }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    // 損益（売上・原価・粗利・粗利率）は自動算出のため編集トリガーを持たない。
    // 旧「インセンティブ対象粗利」金額サマリは契約状況タブの金額サマリ + 損益計算タブへ
    // 再編されたため、損益計算タブで自動算出の表示のみ・編集 UI 不在を検証する。
    await page.getByRole("tab", { name: "損益計算" }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: "損益計算" })).toBeVisible();

    // 粗利・インセンティブ・損益専用の編集トリガーは存在しない（aria-label に該当語が無い）。
    await expect(
      page.getByRole("button", { name: /粗利を編集|インセンティブを編集|損益を編集/ }),
    ).toHaveCount(0);
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

  test("ヒアリング インライン編集: 家族構成を保存すると再描画後も値が維持される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // 現状情報のヒアリングはカード内インライン編集（HearingInlineEdit）。家族構成
    // （#hr-household）を一意な値に書き換えると当該フォームの保存ボタンが有効化される。
    const unique = `4人家族E2E${Date.now() % 100000}`;
    const household = panel.locator("#hr-household");
    await expect(household).toBeVisible();
    await household.fill(unique);

    // 編集により dirty となったヒアリングフォームの保存ボタン（有効状態）をクリックする。
    const saveBtn = panel.getByRole("button", { name: "保存" }).and(page.locator("button:enabled"));
    await saveBtn.first().click();

    // 保存後 router.refresh で再描画され、家族構成の入力値が維持される。
    await expect(panel.locator("#hr-household")).toHaveValue(unique, { timeout: 30_000 });
  });
});
