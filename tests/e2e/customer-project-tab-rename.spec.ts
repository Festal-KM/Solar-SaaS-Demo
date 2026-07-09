import { expect, test, type Page } from "@playwright/test";

// 顧客詳細「施工」タブ — 施工レコードごとのサブタブ（施工 #N）のタブ名を右クリックで改名し、
// DB 永続（Construction.tabLabel）される回帰検証（renameProjectTabAction）。
//
// 検証対象:
//   1. 施工状況タブに施工レコードごとのサブタブ「施工 #1」が出る（契約済み顧客）。
//   2. サブタブを右クリック → TIP 風メニュー「タブ名を編集する」→ ポップアップで改名 → 保存。
//      保存後、タブ名が新ラベルに更新される。
//   3. ページをリロードしても新ラベルが永続する（tabLabel が DB に保存されている）。
//   4. 後片付け: 空ラベルで保存するとデフォルト表記「施工 #1」へ戻る（他 spec の
//      「施工 #1」不変条件を保つため原状回復する）。
//
// 認証は demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, 2FA off, seed 投入済）。
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

// 契約済み顧客（施工付き）を開く。
async function openContractedCustomer(page: Page): Promise<void> {
  await page.goto("/customers?contractStatus=contracted");
  const firstRow = page.getByRole("button", { name: /様$/ }).first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
}

// 施工状況タブへ切り替え、施工サブタブ #1 が出るのを待つ。
async function openConstructionTab(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "施工" }).first().click();
  const panel = page.locator('[role="tabpanel"][id$="-content-construction"]');
  await expect(panel).toBeVisible();
}

// タブを右クリック → メニュー「タブ名を編集する」→ 入力欄に newLabel（空文字も可）を入れて保存。
async function renameTab(page: Page, tab: ReturnType<Page["getByRole"]>, newLabel: string): Promise<void> {
  await tab.click({ button: "right" });
  const menuItem = page.getByRole("menuitem", { name: "タブ名を編集する" });
  await expect(menuItem).toBeVisible();
  await menuItem.click();

  // ポップオーバー（data-tab-popover）にスコープする。aria-label "タブ名"（入力欄）は鉛筆
  // ボタンの "タブ名を編集する" と、保存ボタンはページ内の他セクション保存ボタンと衝突する
  // ため、ポップオーバー内に限定して一意化する。
  const popover = page.locator("[data-tab-popover]");
  const input = popover.getByLabel("タブ名", { exact: true });
  await expect(input).toBeVisible();
  await input.fill(newLabel);
  await popover.getByRole("button", { name: "保存" }).click();
}

test.describe("施工サブタブ タブ名の右クリック改名 + 永続", () => {
  test.describe.configure({ timeout: 150_000 });

  test("右クリック → タブ名を編集する → 改名 → リロード後も永続し、空ラベルで既定へ戻る", async ({
    page,
  }) => {
    const newLabel = `E2E施工${Date.now()}`;

    await signInAsDemo(page);
    await openContractedCustomer(page);
    await openConstructionTab(page);

    const defaultTab = page.getByRole("tab", { name: /^施工 #1$/ });
    await expect(defaultTab).toBeVisible();

    // 右クリック改名。
    await renameTab(page, defaultTab, newLabel);

    // 保存後、タブ名が新ラベルへ更新される。
    const renamedTab = page.getByRole("tab", { name: newLabel, exact: true });
    await expect(renamedTab).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("tab", { name: /^施工 #1$/ })).toHaveCount(0);

    // リロードしても永続する（tabLabel が DB に保存されている）。
    await page.reload();
    await openConstructionTab(page);
    await expect(page.getByRole("tab", { name: newLabel, exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // 後片付け: 空ラベルで保存 → 既定表記「施工 #1」へ戻る（原状回復）。
    await renameTab(page, page.getByRole("tab", { name: newLabel, exact: true }), "");
    await expect(page.getByRole("tab", { name: /^施工 #1$/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("tab", { name: newLabel, exact: true })).toHaveCount(0);

    // リロード後も既定へ戻ったまま（永続確認）。
    await page.reload();
    await openConstructionTab(page);
    await expect(page.getByRole("tab", { name: /^施工 #1$/ })).toBeVisible({ timeout: 30_000 });
  });
});
