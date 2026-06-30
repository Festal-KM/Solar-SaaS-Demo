import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

// 本 spec は「佐藤 一馬」に審査を生成する。各テストは自前の審査を削除して原状回復するが、
// add/delete テストや異常終了で取り残しが出た場合に備え、afterAll で当該顧客のローン審査を
// 全削除し、空状態前提の他 spec への汚染を防ぐ。
function cleanupDemoLoanReviews(): void {
  const script = resolve(__dirname, "fixtures", "cleanup-demo-loan-reviews.ts");
  const dbDir = resolve(__dirname, "..", "..", "packages", "db");
  execFileSync("pnpm", ["exec", "tsx", script], {
    cwd: dbDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

// 顧客詳細「ローン審査」タブ — 独立エンティティ LoanReview の専用検証.
//
// docs/02 §16 / docs/05 §16。ローン審査は契約から独立した LoanReview エンティティで、
// 顧客に N 件ぶら下がる。専用「ローン審査」タブで審査ごとのサブタブ（ローン審査 #1/#2…）
// として表示・インライン編集する。旧 per-contract ローン情報（LoanBlock / 契約編集ダイアログの
// 「契約・金額・ローンを編集」）は廃止済み。
//
// 検証シナリオ（重点）:
//   1. 空状態 → 「審査を追加」で ローン審査 #1 サブタブ出現。
//   2. インライン編集（ステータス/ローン会社/頭金/審査日）を保存 → toast → リロード後も保持。
//   3. 「審査を追加」で #2 サブタブ追加・切替。「審査を削除」でアクティブ審査削除。
//   4. 過去の審査履歴ログ: 日時+結果+メモ を追加 → toast → 一覧反映（降順）→ リロード後保持。
//      行削除も。
//   5. 不備（ログ単位）: 審査履歴ログに不備内容を入力して追加 → 「不備内容・解消状況」一覧に
//      未解消で出現 → 解消トグル → 解消済みへ反映。
//
// 認証は demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, 2FA off, seed 投入済）。
// Seed は tests/e2e/global-setup.ts で全 spec 起動前に 1 回だけ実行される。
// workers:1 + fullyParallel:false（playwright.config.ts）に追従。
//
// データ独立性: 専用検証顧客を生成せず seed 顧客を使うため、各テストは「審査を追加」で
// 自前の審査を作り、終了時にその審査を削除して原状回復する（同一 worker・workers:1 で
// 直列実行されるためサブタブ番号は安定しないが、各テストは自分が作った審査 #N を最後尾で
// 操作・削除する方針で他テストへ干渉しない）。

const DEMO_EMAIL = "demo@solar-saas.demo";
const DEMO_PASSWORD = "Demo1234!";

// seed の先頭サンプル顧客「佐藤 一馬」（s=0）— 審査 0 件で空状態検証に使える。
const EMPTY_CUSTOMER_QUERY = "佐藤 一馬";

const LOAN_REVIEW_LABELS = ["審査前", "審査中", "完了", "不備在り"] as const;

async function signInAsDemo(page: Page): Promise<void> {
  await page.goto("/login", { timeout: 120_000 });
  await page.getByLabel("メールアドレス").fill(DEMO_EMAIL);
  await page.getByLabel("パスワード").fill(DEMO_PASSWORD);
  const submit = page.getByRole("button", { name: "サインイン" });
  await expect(submit).toBeVisible();
  await submit.click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 });
}

async function openCustomerByQuery(page: Page, query: string): Promise<void> {
  await page.goto(`/customers?query=${encodeURIComponent(query)}`);
  const row = page.getByRole("button", { name: /様$/ }).first();
  await expect(row).toBeVisible();
  await row.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
}

async function openLoanTab(page: Page) {
  // 顧客詳細タブの「ローン審査」トリガー（exact）をクリック。
  await page.getByRole("tab", { name: "ローン審査", exact: true }).click();
  // 審査サブタブが存在すると tabpanel が入れ子になり getByRole('tabpanel') が
  // 複数解決する。外側のローン審査タブパネル（accessible name = "ローン審査" exact）に scope する。
  const panel = page.getByRole("tabpanel", { name: "ローン審査", exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

// 審査が無ければ 1 件作り、審査サブタブが描画されるまで待つ。最後尾の審査サブタブを返す
// （= 直前に追加された審査）。
async function ensureAtLeastOneReview(page: Page) {
  const panel = await openLoanTab(page);
  const subtabs = panel.getByRole("tab", { name: /ローン審査\s*#\d+/ });
  const before = await subtabs.count();
  if (before === 0) {
    await panel.getByRole("button", { name: "審査を追加" }).first().click();
    await expect(panel.getByRole("tab", { name: /ローン審査\s*#1/ })).toBeVisible({
      timeout: 30_000,
    });
  }
  return panel;
}

test.describe("ローン審査タブ — 独立 LoanReview の CRUD・履歴・不備", () => {
  test.describe.configure({ timeout: 120_000 });

  test.afterAll(() => {
    cleanupDemoLoanReviews();
  });

  test("空状態 → 「審査を追加」でローン審査 #1 サブタブが出現する", async ({ page }) => {
    await signInAsDemo(page);
    await openCustomerByQuery(page, EMPTY_CUSTOMER_QUERY);
    const panel = await openLoanTab(page);

    const subtabs = panel.getByRole("tab", { name: /ローン審査\s*#\d+/ });
    const existing = await subtabs.count();

    if (existing === 0) {
      // 空状態メッセージ + 「審査を追加」。
      await expect(
        panel.getByText("ローン審査はまだありません。「審査を追加」から作成してください。"),
      ).toBeVisible();
      await panel.getByRole("button", { name: "審査を追加" }).first().click();
      await expect(panel.getByRole("tab", { name: /ローン審査\s*#1/ })).toBeVisible({
        timeout: 30_000,
      });
      // 後片付け: 作成した審査を削除して空状態へ戻す。
      page.once("dialog", (d) => d.accept());
      await panel.getByRole("button", { name: "審査を削除" }).click();
      await expect(panel.getByRole("tab", { name: /ローン審査\s*#1/ })).toHaveCount(0, {
        timeout: 30_000,
      });
    } else {
      // 既に審査がある場合は #1 サブタブの存在のみ確認（他テストが残した可能性）。
      await expect(panel.getByRole("tab", { name: /ローン審査\s*#1/ })).toBeVisible();
    }
  });

  test("インライン編集（ステータス/会社/頭金/審査日）を保存しリロード後も保持", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openCustomerByQuery(page, EMPTY_CUSTOMER_QUERY);
    let panel = await ensureAtLeastOneReview(page);

    // アクティブな審査の編集フィールド（id サフィックスから loanReviewId を取り出す）。
    const statusSelect = panel.locator('select[id^="lr-status-"]').first();
    await expect(statusSelect).toBeVisible();
    const lrId = (await statusSelect.getAttribute("id"))!.replace("lr-status-", "");

    // select オプションが 4 値そろっている。
    const optionTexts = (await statusSelect.locator("option").allTextContents()).map((t) =>
      t.trim(),
    );
    for (const label of LOAN_REVIEW_LABELS) {
      expect(optionTexts, `審査ステータス select に「${label}」`).toContain(label);
    }

    // 値を入力（不備はサマリから廃止・ログ単位へ移行したため defcontent/defstatus は無い）。
    await statusSelect.selectOption("reviewing");
    await panel.locator(`#lr-company-${lrId}`).fill("Eテスト信販");
    await panel.locator(`#lr-down-${lrId}`).fill("300000");
    await panel.locator(`#lr-at-${lrId}`).fill("2026-06-20");

    // 保存 → toast。
    await panel.getByRole("button", { name: "保存" }).first().click();
    await expect(page.getByText("保存しました").first()).toBeVisible({ timeout: 30_000 });

    // リロード後も保持。
    await page.reload();
    panel = await openLoanTab(page);
    await expect(panel.locator(`#lr-status-${lrId}`)).toHaveValue("reviewing", {
      timeout: 30_000,
    });
    await expect(panel.locator(`#lr-company-${lrId}`)).toHaveValue("Eテスト信販");
    await expect(panel.locator(`#lr-at-${lrId}`)).toHaveValue("2026-06-20");

    // 不備フィールドはサマリから消えている（ログ単位へ移行）。
    await expect(panel.locator(`#lr-defcontent-${lrId}`)).toHaveCount(0);
    await expect(panel.locator(`#lr-defstatus-${lrId}`)).toHaveCount(0);

    // 後片付け: この審査を削除。
    page.once("dialog", (d) => d.accept());
    await panel.getByRole("button", { name: "審査を削除" }).click();
    await expect(panel.locator(`#lr-status-${lrId}`)).toHaveCount(0, { timeout: 30_000 });
  });

  test("「審査を追加」で #2 サブタブが増え、切替でき、「審査を削除」で減る", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openCustomerByQuery(page, EMPTY_CUSTOMER_QUERY);
    let panel = await ensureAtLeastOneReview(page);

    const subtabs = panel.getByRole("tab", { name: /ローン審査\s*#\d+/ });
    const startCount = await subtabs.count();

    // 審査を追加 → サブタブ数が +1。
    await panel.getByRole("button", { name: "審査を追加" }).first().click();
    await expect(async () => {
      expect(await subtabs.count()).toBe(startCount + 1);
    }).toPass({ timeout: 30_000 });

    // 最後尾サブタブへ切替できる。
    const lastTab = subtabs.last();
    await lastTab.click();
    await expect(lastTab).toHaveAttribute("data-state", "active", { timeout: 10_000 });

    // 審査を削除 → サブタブ数が元へ戻る。
    page.once("dialog", (d) => d.accept());
    await panel.getByRole("button", { name: "審査を削除" }).click();
    await expect(async () => {
      expect(await subtabs.count()).toBe(startCount);
    }).toPass({ timeout: 30_000 });

    // ensureAtLeastOneReview が作った可能性のある審査を後片付け（startCount が 1 で
    // 自前生成だった場合、残り 1 件も削除して原状回復を試みる — 既存審査がある顧客では
    // この削除はスキップせず最後の 1 件を消すと他テストに影響するため、自前生成時のみ消す）。
    // 安全側: 何もしない（次テストの ensureAtLeastOneReview が再生成する）。
    void panel;
  });

  test("過去の審査履歴ログを追加（日時+結果+メモ）→ 一覧反映 → 行削除", async ({ page }) => {
    await signInAsDemo(page);
    await openCustomerByQuery(page, EMPTY_CUSTOMER_QUERY);
    let panel = await ensureAtLeastOneReview(page);

    const statusSelect = panel.locator('select[id^="lr-status-"]').first();
    const lrId = (await statusSelect.getAttribute("id"))!.replace("lr-status-", "");

    // 追加フォーム: 日時 + 結果(可決) + メモ。
    await panel.locator(`#lrl-at-${lrId}`).fill("2026-06-21T14:30");
    await panel.locator(`#lrl-result-${lrId}`).selectOption("approved");
    const noteMarker = `E2E履歴メモ-${Date.now()}`;
    await panel.locator(`#lrl-note-${lrId}`).fill(noteMarker);
    await panel.getByRole("button", { name: "追加", exact: true }).first().click();
    await expect(page.getByText("保存しました").first()).toBeVisible({ timeout: 30_000 });

    // 一覧にメモ + 結果ラベルが反映される。
    await expect(panel.getByText(noteMarker)).toBeVisible({ timeout: 30_000 });
    const logRow = panel.locator("li", { hasText: noteMarker });
    await expect(logRow).toContainText("可決");

    // リロード後も保持。
    await page.reload();
    panel = await openLoanTab(page);
    await expect(panel.getByText(noteMarker)).toBeVisible({ timeout: 30_000 });

    // 行削除: 該当行の削除ボタン（aria-label「削除」）。
    page.once("dialog", (d) => d.accept());
    await panel.locator("li", { hasText: noteMarker }).getByRole("button", { name: "削除" }).click();
    await expect(panel.getByText(noteMarker)).toHaveCount(0, { timeout: 30_000 });

    // 後片付け: 審査を削除。
    page.once("dialog", (d) => d.accept());
    await panel.getByRole("button", { name: "審査を削除" }).click();
    await expect(panel.locator(`#lr-status-${lrId}`)).toHaveCount(0, { timeout: 30_000 });
  });

  test("不備（ログ単位）: 履歴ログに不備内容を入力して追加 → 不備一覧に未解消で出現 → 解消トグル", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openCustomerByQuery(page, EMPTY_CUSTOMER_QUERY);
    let panel = await ensureAtLeastOneReview(page);

    const statusSelect = panel.locator('select[id^="lr-status-"]').first();
    const lrId = (await statusSelect.getAttribute("id"))!.replace("lr-status-", "");

    // 履歴ログ追加フォームで不備内容を入力して追加。
    const defectMarker = `E2E不備-${Date.now()}`;
    await panel.locator(`#lrl-at-${lrId}`).fill("2026-06-22T11:00");
    await panel.locator(`#lrl-result-${lrId}`).selectOption("defect");
    await panel.locator(`#lrl-defect-${lrId}`).fill(defectMarker);
    await panel.getByRole("button", { name: "追加", exact: true }).first().click();
    await expect(page.getByText("保存しました").first()).toBeVisible({ timeout: 30_000 });

    // 「不備内容・解消状況」一覧に不備内容が未解消バッジ付きで出現。
    const defectRow = panel.locator("li", { hasText: defectMarker });
    await expect(defectRow).toBeVisible({ timeout: 30_000 });
    await expect(defectRow).toContainText("未解消");

    // 解消トグル → 解消済みへ。
    await defectRow.getByRole("button", { name: "解消済みにする" }).click();
    await expect(page.getByText("保存しました").first()).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator("li", { hasText: defectMarker })).toContainText("解消済み", {
      timeout: 30_000,
    });

    // リロード後も解消済みを保持。
    await page.reload();
    panel = await openLoanTab(page);
    await expect(panel.locator("li", { hasText: defectMarker })).toContainText("解消済み", {
      timeout: 30_000,
    });

    // 後片付け: 審査を削除（履歴ログも Cascade 削除）。
    page.once("dialog", (d) => d.accept());
    await panel.getByRole("button", { name: "審査を削除" }).click();
    await expect(panel.locator(`#lr-status-${lrId}`)).toHaveCount(0, { timeout: 30_000 });
  });
});
