import { expect, test, type Locator, type Page } from "@playwright/test";

// 顧客詳細「設置申請」タブ（value="subsidy"） — 施工/ローン審査タブと同型のサブタブ化.
//
// 検証対象（本タスクの新レイアウト）:
//   1. 設置申請タブを開くとトップに申請サブタブ（申請 #1…）が表示される（施工/ローン審査と同型）。
//   2. 申請 #1 のインライン編集で 設置申請ステータス(select 5値)/申請日/交付額 を編集 → 保存 →
//      リロード後もサブタブに永続表示される（saveProjectApplicationAction 経由）。
//   3. ステータスを保存すると Customer.subsidyStatus が代表申請から再計算され、顧客一覧の
//      「設置申請」チップに反映される（write-on-save。APPROVED→完了）。テスト後に原状回復する。
//   4. 「申請を追加」で申請名を入力 → 新しいサブタブが増える。右クリック改名 → リロード後も永続。
//      追加した申請は最後に削除して原状回復する（他 spec の申請 #1 不変条件を保つ）。
//
// 認証は demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, 2FA off, seed 投入済）。
// Seed は tests/e2e/global-setup.ts で全 spec 起動前に 1 回だけ実行される。
// workers:1 + fullyParallel:false（playwright.config.ts）に追従。

const DEMO_EMAIL = "demo@solar-saas.demo";
const DEMO_PASSWORD = "Demo1234!";

async function signInAsDemo(page: Page): Promise<void> {
  await page.goto("/login", { timeout: 120_000 });
  await page.getByLabel("メールアドレス").fill(DEMO_EMAIL);
  await page.getByLabel("パスワード").fill(DEMO_PASSWORD);
  const submit = page.getByRole("button", { name: "サインイン" });
  await expect(submit).toBeVisible();
  await submit.click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 });
}

// 設置申請チップが指定ラベル（= application を持つ）である顧客を一覧から開き、
// その一覧上のアクセシブル名を返す。chipLabel は subsidy 固有の完全一致ラベル
// （施工列の「施工完了」等とは衝突しない）。
async function openCustomerWithSubsidyChip(page: Page, chipLabel: string): Promise<string> {
  await page.goto("/customers?contractStatus=contracted");
  await expect(page.getByRole("button", { name: /様$/ }).first()).toBeVisible();
  const row = page
    .locator('tr[role="button"]')
    .filter({ has: page.getByText(chipLabel, { exact: true }) })
    .first();
  await expect(row, `設置申請チップ「${chipLabel}」を持つ顧客が一覧に存在する`).toBeVisible();
  const rowName = (await row.getAttribute("aria-label")) ?? "";
  await row.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
  return rowName;
}

// 設置申請タブへ切り替え、外側 tabpanel を返す。
async function openSubsidyTab(page: Page): Promise<Locator> {
  await page.getByRole("tab", { name: "設置申請" }).first().click();
  const panel = page.locator('[role="tabpanel"][id$="-content-subsidy"]');
  await expect(panel).toBeVisible();
  return panel;
}

// 設置申請サブタブのアクティブな申請インライン編集領域（内側 tabpanel。非 hidden）。
function activeApplicationRegion(panel: Locator): Locator {
  return panel.locator('[role="tabpanel"]:not([hidden])');
}

// タブを右クリック → メニュー「タブ名を編集する」→ 入力欄に newLabel を入れて保存。
async function renameTab(page: Page, tab: Locator, newLabel: string): Promise<void> {
  await tab.click({ button: "right" });
  const menuItem = page.getByRole("menuitem", { name: "タブ名を編集する" });
  await expect(menuItem).toBeVisible();
  await menuItem.click();

  const popover = page.locator("[data-tab-popover]");
  const input = popover.getByLabel("タブ名", { exact: true });
  await expect(input).toBeVisible();
  await input.fill(newLabel);
  await popover.getByRole("button", { name: "保存" }).click();
}

test.describe("設置申請タブ サブタブ化 + インライン編集 + 追加/改名", () => {
  test.describe.configure({ timeout: 180_000 });

  test("申請 #1 サブタブがトップに出て、ステータス/申請日/交付額を編集→保存→リロード永続し一覧チップに反映", async ({
    page,
  }) => {
    await signInAsDemo(page);
    // SUBMITTED（=申請済）な application を持つ顧客を選ぶ。APPROVED へ変更して一覧チップが
    // 申請済→完了 に変わることで write-on-save を決定的に検証する。
    const rowName = await openCustomerWithSubsidyChip(page, "申請済");

    const panel = await openSubsidyTab(page);
    await expect(page.getByRole("tab", { name: /^申請 #1$/ })).toBeVisible();

    const region = activeApplicationRegion(panel);
    const statusSelect = region.getByLabel("設置申請ステータス");
    const submittedInput = region.getByLabel("申請日", { exact: true });
    const grantedInput = region.getByLabel("交付額", { exact: true });
    await expect(statusSelect).toBeVisible();
    await expect(submittedInput).toHaveAttribute("type", "date");

    // 元のステータス（= SUBMITTED）を控えて原状回復に使う。
    const originalStatus = await statusSelect.inputValue();

    // 一意な値を書き込む。ステータスは APPROVED（代表→完了）に変更して一覧チップを決定的にする。
    const uniqueAmount = 370_000 + (Date.now() % 1_000);
    const day = 10 + (Date.now() % 15); // 10〜24
    const submittedDate = `2027-11-${String(day).padStart(2, "0")}`;

    await statusSelect.selectOption("APPROVED");
    await submittedInput.fill(submittedDate);
    await grantedInput.fill(String(uniqueAmount));

    const saveButton = region.getByRole("button", { name: "保存" });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // 保存 → router.refresh でサーバー再描画。initial が更新され dirty=false に戻り保存ボタンが無効化。
    await expect(saveButton).toBeDisabled({ timeout: 30_000 });

    const expectedGranted = `¥${uniqueAmount.toLocaleString("ja-JP")}`;
    await expect(grantedInput).toHaveValue(expectedGranted);

    // リロードしても永続表示される。
    await page.reload();
    const panel2 = await openSubsidyTab(page);
    const region2 = activeApplicationRegion(panel2);
    await expect(region2.getByLabel("設置申請ステータス")).toHaveValue("APPROVED", {
      timeout: 30_000,
    });
    await expect(region2.getByLabel("申請日", { exact: true })).toHaveValue(submittedDate);
    await expect(region2.getByLabel("交付額", { exact: true })).toHaveValue(expectedGranted);

    // 顧客一覧の「設置申請」チップが代表申請（APPROVED→完了）から再計算されて反映される。
    await page.goto("/customers?contractStatus=contracted");
    const row = page.getByRole("button", { name: rowName, exact: true }).first();
    await expect(row).toBeVisible();
    // 設置申請チップは「完了」（施工列の「施工完了」とは別ラベルなので完全一致で衝突しない）。
    await expect(row.getByText("完了", { exact: true })).toBeVisible({ timeout: 30_000 });

    // 原状回復: ステータスを元に戻す（一覧チップの初期分布を保つ）。
    await row.click();
    await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
    const panel3 = await openSubsidyTab(page);
    const region3 = activeApplicationRegion(panel3);
    await region3.getByLabel("設置申請ステータス").selectOption(originalStatus);
    const restoreSave = region3.getByRole("button", { name: "保存" });
    await expect(restoreSave).toBeEnabled();
    await restoreSave.click();
    await expect(restoreSave).toBeDisabled({ timeout: 30_000 });
  });

  test("「申請を追加」で名称入力→サブタブ増加、右クリック改名→リロード永続、削除で原状回復", async ({
    page,
  }) => {
    // window.confirm（申請削除）を自動承認する。
    page.on("dialog", (d) => void d.accept());

    const addName = `E2E申請${Date.now()}`;
    const renamed = `${addName}改`;

    await signInAsDemo(page);
    // 既存 application（申請 #1）を持つ顧客を開く。
    await openCustomerWithSubsidyChip(page, "申請済");

    const panel = await openSubsidyTab(page);
    await expect(page.getByRole("tab", { name: /^申請 #1$/ })).toBeVisible();

    // 「申請を追加」→ ダイアログで申請名入力 → 作成。
    await panel.getByRole("button", { name: "申請を追加" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("設置申請を追加")).toBeVisible();
    await dialog.getByLabel("申請名").fill(addName);
    await dialog.getByRole("button", { name: "新規作成" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // 追加した名称のサブタブが増える（申請 #1 は残る）。
    const addedTab = page.getByRole("tab", { name: addName, exact: true });
    await expect(addedTab).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("tab", { name: /^申請 #1$/ })).toBeVisible();

    // 右クリック改名 → 新ラベルへ更新。
    await renameTab(page, addedTab, renamed);
    const renamedTab = page.getByRole("tab", { name: renamed, exact: true });
    await expect(renamedTab).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("tab", { name: addName, exact: true })).toHaveCount(0);

    // リロードしても改名が永続する（Application.tabLabel が DB 保存）。
    await page.reload();
    const panel2 = await openSubsidyTab(page);
    const renamedTab2 = panel2.getByRole("tab", { name: renamed, exact: true });
    await expect(renamedTab2).toBeVisible({ timeout: 30_000 });

    // 原状回復: 追加した申請を選択して削除（confirm 自動承認）。申請 #1 のみに戻る。
    await renamedTab2.click();
    await panel2.getByRole("button", { name: "申請を削除" }).click();
    await expect(page.getByRole("tab", { name: renamed, exact: true })).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(page.getByRole("tab", { name: /^申請 #1$/ })).toBeVisible();

    // リロード後も削除が永続（追加タブが復活しない）。
    await page.reload();
    const panel3 = await openSubsidyTab(page);
    await expect(panel3.getByRole("tab", { name: renamed, exact: true })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /^申請 #1$/ })).toBeVisible();
  });
});
