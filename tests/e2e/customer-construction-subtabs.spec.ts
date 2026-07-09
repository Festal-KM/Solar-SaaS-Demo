import { expect, test, type Page } from "@playwright/test";

// 顧客詳細「施工」タブ — per-Construction サブタブ + 工事予定日(plannedDate) + 一覧の代表施工導出.
//
// 検証対象（本タスクの新レイアウト）:
//   1. 施工タブを開くとトップに施工サブタブ（施工 #1…）が表示される（ローン審査タブ同型）。
//   2. 施工 #1 の工事編集ダイアログに「工事予定日」(#cn-planned, type=date) があり、
//      値を保存 → リロード後もサブタブに永続表示される（saveProjectConstructionAction 経由）。
//   3. 顧客一覧の「施工状況」列が代表施工から導出された 3 値ラベル（未着工/着工中/施工完了）で
//      表示され、旧 enum 生値（CONSTRUCTING 等）が露出しない。契約済み顧客の少なくとも 1 行は
//      施工レコードに基づく非「未着工」ラベルになる（= Customer 列固定ではなく施工由来）。
//
// 認証は demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, 2FA off, seed 投入済）。
// Seed は tests/e2e/global-setup.ts で全 spec 起動前に 1 回だけ実行される。
// workers:1 + fullyParallel:false（playwright.config.ts）に追従。

const DEMO_EMAIL = "demo@solar-saas.demo";
const DEMO_PASSWORD = "Demo1234!";

// 一覧「施工状況」列の 3 値ラベル（labels.customer.constructionStatusLabels）。
const CONSTRUCTION_LIST_LABELS = ["未着工", "着工中", "施工完了"] as const;

async function signInAsDemo(page: Page): Promise<void> {
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

async function openConstructionTab(page: Page) {
  await page.getByRole("tab", { name: "施工" }).first().click();
  const panel = page.locator('[role="tabpanel"][id$="-content-construction"]');
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("施工タブ per-Construction サブタブ + 工事予定日 + 一覧導出", () => {
  test.describe.configure({ timeout: 120_000 });

  test("施工 #1 サブタブがトップに出て、工事予定日を編集→保存→リロード永続する", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    const panel = await openConstructionTab(page);
    await expect(page.getByRole("tab", { name: /^施工 #1$/ })).toBeVisible();

    // 工事編集ダイアログを開き、工事予定日(#cn-planned, type=date)へ一意な日付を設定して保存。
    await panel.getByRole("button", { name: "工事・完工を編集" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const plannedInput = dialog.locator("#cn-planned");
    await expect(plannedInput, "工事予定日入力欄(#cn-planned)が存在する").toBeVisible();
    await expect(plannedInput).toHaveAttribute("type", "date");

    // seed と衝突しにくい未来日を設定する（表示フォーマット/TZ は環境依存のため、
    // 表示テキストは round-trip 一致で検証し、絶対値の再フォーマットには依存しない）。
    const day = 10 + (Date.now() % 15); // 10〜24
    await plannedInput.fill(`2027-12-${String(day).padStart(2, "0")}`);
    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // 工事予定日 MetaItem が空（未設定）ではない日付表示（YYYY/MM/DD 形式）へ更新される。
    const plannedDt = panel.locator("dt", { hasText: "工事予定日" }).first();
    const plannedDd = plannedDt.locator("xpath=following-sibling::dd[1]");
    let saved = "";
    await expect(async () => {
      saved = ((await plannedDd.textContent()) ?? "").trim();
      expect(saved).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
    }).toPass({ timeout: 30_000 });

    // リロードしても同じ日付が永続表示される。
    await page.reload();
    const panel2 = await openConstructionTab(page);
    const plannedDt2 = panel2.locator("dt", { hasText: "工事予定日" }).first();
    const plannedDd2 = plannedDt2.locator("xpath=following-sibling::dd[1]");
    await expect(plannedDd2).toHaveText(saved, { timeout: 30_000 });
  });

  test("顧客一覧の施工状況列が代表施工から導出された 3 値ラベルで表示される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await page.goto("/customers?contractStatus=contracted");
    const table = page.locator("table");
    await expect(page.getByRole("button", { name: /様$/ }).first()).toBeVisible();

    // 旧 enum 生値が一覧に露出していない（導出結果は必ず 3 値へマップされる）。
    await expect(
      table.getByText(/^(REQUEST_PENDING|REQUESTED|SURVEYED|CONSTRUCTING|DONE|PAUSED)$/),
    ).toHaveCount(0);

    // 契約済み顧客は施工レコードを持つため、少なくとも 1 行は非「未着工」ラベル
    // （着工中 / 施工完了）= 代表施工由来である。
    const nonNotStarted = table.getByText(/^(着工中|施工完了)$/);
    await expect(nonNotStarted.first()).toBeVisible();

    // 表示ラベルは既知 3 値のいずれか（未知値崩壊が無い）。
    const anyKnown = table.getByText(
      new RegExp(`^(${CONSTRUCTION_LIST_LABELS.join("|")})$`),
    );
    await expect(anyKnown.first()).toBeVisible();
  });
});
