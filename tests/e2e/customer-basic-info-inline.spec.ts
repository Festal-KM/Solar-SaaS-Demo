import { expect, test, type Page } from "@playwright/test";

// 顧客詳細「基本情報」タブ 再設計 (F-031 / docs/02 UC-06 / docs/05 §16).
//
// ポップアップ（EditBasicInfoDialog / EditMemoDialog）を廃止し、顧客情報カードと
// メモカードを「カード内インライン編集」へ再設計した変更の E2E 検証。
//
// 検証対象:
//   1. 顧客情報がインライン編集できる: 入力欄(#basic-*)がカード内に直接描画され、
//      ポップアップを開く操作なしで値を変更 → Save → router.refresh 後に反映される。
//      dirty でない初期状態では Save/キャンセルが非活性（status-panels idiom）。
//   2. メモがインライン textarea(#basic-memo) で編集でき、変更 → Save → 反映される。
//   3. レイアウト: 「現状情報」「契約予定情報」の区分見出しが描画され、既存設備
//      （エコキュート / ガス給湯器 / 太陽光）が現状情報側、契約予定（契約・金額）が
//      契約予定情報側に出る。
//   4. ポップアップ（dialog）が顧客情報/メモ編集で開かない（インライン化の確認）。
//
// 認証は demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, seed 投入済）。
// 行は role="button" + aria-label="<名前>様"。
// 入力欄は安定した id(#basic-name / #basic-phone / #basic-memo) をセレクタに用いる
// （ラベル「電話番号」等が現状情報/ヒアリングで重複するため id で一意化する）。
//
// Seed は tests/e2e/global-setup.ts で全 spec 起動前に 1 回だけ実行される。
// workers:1 + fullyParallel:false（playwright.config.ts）に追従。

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

// 一覧 → 先頭顧客行クリック → 顧客詳細（既定で「基本情報」タブ）へ遷移。
async function openFirstCustomerDetail(page: Page): Promise<void> {
  await page.goto("/customers");
  const firstRow = page.getByRole("button", { name: /様$/ }).first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
  await expect(page.getByRole("tab", { name: "基本情報" })).toHaveAttribute("data-state", "active");
}

test.describe("F-031 顧客詳細『基本情報』タブ インライン編集再設計", () => {
  // dev サーバの cold-compile（/login → /customers → /customers/[id]）を吸収するため
  // 30s 既定を 120s に拡張。workers:1 なので並列 compile competition は無い。
  test.describe.configure({ timeout: 120_000 });

  test("レイアウト: 現状情報 / 契約予定情報 の区分見出しと既存設備・契約予定が正しい側に描画される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openFirstCustomerDetail(page);

    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // 区分見出し（SectionHeading）が両方描画される（契約側は再設計で「契約情報」へ改称）。
    await expect(panel.getByRole("heading", { name: "現状情報", exact: true })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "契約情報", exact: true })).toBeVisible();

    // 既設設備（現況）が現状情報側のヒアリングセクション内に描画され、3 カテゴリの有無が見える
    // （再設計で独立「既存設備」カードはヒアリングの「既設設備（現況）」へ統合された）。
    await expect(panel.getByRole("heading", { name: "既設設備（現況）" })).toBeVisible();
    await expect(panel.getByText("エコキュート（EQ）", { exact: true }).first()).toBeVisible();
    await expect(panel.getByText("ガス給湯器", { exact: true }).first()).toBeVisible();
    await expect(panel.getByText("太陽光（既設）", { exact: true }).first()).toBeVisible();

    // 契約予定情報側に案件情報 embedded（契約・金額カテゴリ）が描画される。
    await expect(
      panel.getByRole("heading", { name: "契約・金額", exact: true }).first(),
    ).toBeVisible();
  });

  test("顧客情報: カード内インライン入力欄が直接描画され（ポップアップ無し）、変更→Save→再描画で反映される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openFirstCustomerDetail(page);

    const panel = page.getByRole("tabpanel");

    // 入力欄がカード内に直接描画されている（ポップアップを開く操作なし）。
    const nameInput = panel.locator("#basic-name");
    const phoneInput = panel.locator("#basic-phone");
    await expect(nameInput).toBeVisible();
    await expect(phoneInput).toBeVisible();

    // 顧客情報カードのインライン編集 Save/キャンセル行。複数カード（顧客情報・メモ）に
    // SaveCancelRow が存在するため、顧客情報カードのスコープ内に限定する。
    const infoCard = panel.locator("div.space-y-5", { has: page.locator("#basic-name") });
    const saveBtn = infoCard.getByRole("button", { name: "保存" });
    const cancelBtn = infoCard.getByRole("button", { name: "キャンセル" });

    // dirty でない初期状態では Save/キャンセルが非活性。
    await expect(saveBtn).toBeDisabled();
    await expect(cancelBtn).toBeDisabled();

    // 電話番号を一意な値へ変更 → dirty になり Save が活性化する。
    const stampPhone = `090-0000-${String(Date.now() % 10000).padStart(4, "0")}`;
    await phoneInput.fill(stampPhone);
    await expect(saveBtn).toBeEnabled();

    // 保存 → トースト → router.refresh 後に再描画。
    await saveBtn.click();
    await expect(page.getByText("保存しました").first()).toBeVisible({ timeout: 30_000 });

    // 再描画後（refresh）に入力欄へ生値（マスク前）が反映されている。
    await expect(panel.locator("#basic-phone")).toHaveValue(stampPhone, { timeout: 30_000 });

    // 再描画後は再び dirty=false（Save 非活性）に戻る。
    const infoCardAfter = panel.locator("div.space-y-5", { has: page.locator("#basic-name") });
    await expect(infoCardAfter.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  test("メモ: インライン textarea で編集でき、変更→Save→再描画で反映される", async ({ page }) => {
    await signInAsDemo(page);
    await openFirstCustomerDetail(page);

    const panel = page.getByRole("tabpanel");

    const memo = panel.locator("#basic-memo");
    await expect(memo).toBeVisible();

    // メモカードの SaveCancelRow（textarea を含む space-y-3 スコープ）。
    const memoCard = panel.locator("div.space-y-3", { has: page.locator("#basic-memo") });
    const memoSave = memoCard.getByRole("button", { name: "保存" });

    // 初期は dirty=false で Save 非活性。
    await expect(memoSave).toBeDisabled();

    const stampMemo = `E2Eメモ ${Date.now()}`;
    await memo.fill(stampMemo);
    await expect(memoSave).toBeEnabled();

    await memoSave.click();
    await expect(page.getByText("保存しました").first()).toBeVisible({ timeout: 30_000 });

    // 再描画後、textarea に保存値が反映される。
    await expect(panel.locator("#basic-memo")).toHaveValue(stampMemo, { timeout: 30_000 });
  });

  test("インライン化の確認: 顧客情報/メモ編集でポップアップ（dialog）が開かない", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openFirstCustomerDetail(page);

    const panel = page.getByRole("tabpanel");

    // 基本情報タブに「基本情報を編集」「メモを編集」というダイアログトリガが存在しない。
    await expect(panel.getByRole("button", { name: "基本情報を編集" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "メモを編集" })).toHaveCount(0);

    // 入力欄を操作してもモーダル dialog は開かない（インライン編集のため）。
    await panel.locator("#basic-name").click();
    await panel.locator("#basic-memo").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
