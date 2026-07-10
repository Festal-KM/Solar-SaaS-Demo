import { expect, test, type Locator, type Page } from "@playwright/test";

// 顧客詳細「設置申請」タブ（value="subsidy"） — 施工/ローン審査タブと同型のサブタブ化.
//
// 検証対象（本タスクの新レイアウト）:
//   1. 設置申請タブを開くとトップに申請サブタブ（申請 #1…）が表示される（施工/ローン審査と同型）。
//   2. 申請 #1 のインライン編集で 設置申請ステータス(select 4値)/申請日 を編集 → 保存 →
//      リロード後もサブタブに永続表示される（saveProjectApplicationAction 経由。交付額は UI 撤去）。
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

// 設置申請ステータス select を目的値へ変更し、保存ボタンが有効化される（React の dirty 判定が
// 反映される）まで待つ。dev サーバーのハイドレーション競合で onChange 未装着のまま selectOption
// すると DOM 値だけ変わり React state が更新されない事象があるため、別値を経由して確実に change を
// 発火させ、toPass で有効化を待つ（test.retry は使わない方針に沿った内部リトライ）。
async function setStatusUntilDirty(region: Locator, value: string): Promise<void> {
  const select = region.getByLabel("設置申請ステータス");
  const save = region.getByRole("button", { name: "保存" });
  await expect(select).toBeVisible();
  await expect(async () => {
    const options = await select
      .locator("option")
      .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    const other = options.find((o) => o !== value) ?? value;
    await select.selectOption(other);
    await select.selectOption(value);
    await expect(select).toHaveValue(value);
    await expect(save).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
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

  test("申請 #1 サブタブがトップに出て、ステータス/申請日を編集→保存→リロード永続し一覧チップに反映", async ({
    page,
  }) => {
    await signInAsDemo(page);
    // SUBMITTED（=申請済）な application を持つ顧客を選ぶ。APPROVED へ変更して一覧チップが
    // 申請済→完了 に変わることで write-on-save を決定的に検証する。
    const rowName = await openCustomerWithSubsidyChip(page, "申請済");
    // 原状回復ナビゲーションを一覧の再描画に依存させないため詳細 URL を控える。
    const customerUrl = page.url();

    const panel = await openSubsidyTab(page);
    await expect(page.getByRole("tab", { name: /^申請 #1$/ })).toBeVisible();

    const region = activeApplicationRegion(panel);
    const statusSelect = region.getByLabel("設置申請ステータス");
    const submittedInput = region.getByLabel("申請日", { exact: true });
    await expect(statusSelect).toBeVisible();
    await expect(submittedInput).toHaveAttribute("type", "date");

    const saveButton = region.getByRole("button", { name: "保存" });

    // 「申請済」チップ顧客の app#1 は本来 SUBMITTED。共有 dev DB に旧テスト由来のドリフト
    // （chip=申請済 だが app=完了 等）が残っていると SUBMITTED→APPROVED 遷移が no-op になり
    // 得るため、まず SUBMITTED へ正規化してから検証する（非破壊: チップと整合する値へ揃える）。
    const startStatus = await statusSelect.inputValue();
    if (startStatus !== "SUBMITTED") {
      await setStatusUntilDirty(region, "SUBMITTED");
      await saveButton.click();
      await expect(saveButton).toBeDisabled({ timeout: 30_000 });
    }
    // 原状回復のターゲットは「申請済」チップと整合する SUBMITTED / 申請日クリア。
    const restoreStatus = "SUBMITTED";
    const restoreSubmitted = "";

    // 一意な値を書き込む。ステータスは APPROVED（代表→完了）に変更して一覧チップを決定的にする。
    const day = 10 + (Date.now() % 15); // 10〜24
    const submittedDate = `2027-11-${String(day).padStart(2, "0")}`;

    await setStatusUntilDirty(region, "APPROVED");
    await submittedInput.fill(submittedDate);

    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // 保存 → router.refresh でサーバー再描画。initial が更新され dirty=false に戻り保存ボタンが無効化。
    await expect(saveButton).toBeDisabled({ timeout: 30_000 });

    // リロードしても永続表示される。
    await page.reload();
    const panel2 = await openSubsidyTab(page);
    const region2 = activeApplicationRegion(panel2);
    await expect(region2.getByLabel("設置申請ステータス")).toHaveValue("APPROVED", {
      timeout: 30_000,
    });
    await expect(region2.getByLabel("申請日", { exact: true })).toHaveValue(submittedDate);

    // 顧客一覧の「設置申請」チップが代表申請（APPROVED→完了）から再計算されて反映される。
    await page.goto("/customers?contractStatus=contracted");
    const row = page.getByRole("button", { name: rowName, exact: true }).first();
    await expect(row).toBeVisible();
    // 設置申請チップは「完了」（施工列の「施工完了」とは別ラベルなので完全一致で衝突しない）。
    await expect(row.getByText("完了", { exact: true })).toBeVisible({ timeout: 30_000 });

    // 原状回復: ステータス/申請日を元に戻す（一覧チップの初期分布・他 spec の不変条件を保つ）。
    // 控えた詳細 URL へ直接遷移して確定的に同一顧客を開く（再ドリフトを生まない）。
    await page.goto(customerUrl);
    await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
    const panel3 = await openSubsidyTab(page);
    const region3 = activeApplicationRegion(panel3);
    await setStatusUntilDirty(region3, restoreStatus);
    await region3.getByLabel("申請日", { exact: true }).fill(restoreSubmitted);
    const restoreSave = region3.getByRole("button", { name: "保存" });
    await expect(restoreSave).toBeEnabled();
    await restoreSave.click();
    await expect(restoreSave).toBeDisabled({ timeout: 30_000 });
  });

  test("インライン編集は 4値ステータス select のみで交付額入力が無く、関連ドキュメントsectionが申請サブタブ内に描画される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openCustomerWithSubsidyChip(page, "申請済");

    const panel = await openSubsidyTab(page);
    await expect(page.getByRole("tab", { name: /^申請 #1$/ })).toBeVisible();
    const region = activeApplicationRegion(panel);

    // 設置申請ステータスは業務 4 値のみ（申請前 / 申請済み / 修正対応中 / 完了 →
    // DRAFT / SUBMITTED / REJECTED / APPROVED）。交付額の select 値・オプションは存在しない。
    const statusSelect = region.getByLabel("設置申請ステータス");
    await expect(statusSelect).toBeVisible();
    const options = statusSelect.locator("option");
    await expect(options).toHaveCount(4);
    await expect(options).toHaveText(["申請前", "申請済み", "修正対応中", "完了"]);
    const optionValues = await options.evaluateAll((els) =>
      els.map((e) => (e as HTMLOptionElement).value),
    );
    expect(optionValues).toEqual(["DRAFT", "SUBMITTED", "REJECTED", "APPROVED"]);

    // インライン編集項目は 申請種別 / 申請日 / 承認日 のみ。交付額入力は撤去済み。
    await expect(region.getByLabel("申請種別")).toBeVisible();
    await expect(region.getByLabel("申請日", { exact: true })).toBeVisible();
    await expect(region.getByLabel("承認日", { exact: true })).toBeVisible();
    await expect(region.getByLabel("交付額")).toHaveCount(0);
    await expect(region.getByText("交付額", { exact: true })).toHaveCount(0);

    // 関連ドキュメント section（この申請に紐づくアップロード）がサブタブ内に描画される。
    // 見出し + 隠しファイル input（FileDropzone）を確認する（R2 は placeholder のため
    // 実 PUT は環境依存。ここでは section の描画までを決定的に検証する）。
    await expect(region.getByRole("heading", { name: "関連ドキュメント" })).toBeVisible();
    // FileDropzone: 隠しファイル input + ドロップゾーン（role=button）が申請サブタブ内に描画される。
    await expect(region.locator('input[type="file"]')).toHaveCount(1);
    await expect(region.getByRole("button", { name: "ファイルをドラッグ&ドロップ" }).first()).toBeVisible();
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
