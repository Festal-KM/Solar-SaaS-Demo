import { expect, test, type Page } from "@playwright/test";

// F-061 顧客詳細「案件情報」統合ビュー (UC-06 / docs/05 §16).
//
// 案件情報は独立タブを廃し「基本情報」タブ内に統合表示する。上段の編集カード
// （担当者 / 顧客基本情報 / メモ）と重複する 基本情報・体制・備考 セクションは
// embedded で抑制し、案件固有（契約・金額 / 契約明細 / 工事・完工 / 認定・設備 /
// 概況）のみを「案件情報」見出しの下に表示する。
//
// 検証対象:
//   1. ハッピーパス: demo(卸業者) ログイン → 契約済み顧客一覧 → 行クリックで詳細遷移
//      → 既定の「基本情報」タブ内に「案件情報」見出し + 案件固有カテゴリ見出し +
//      契約済み顧客の設備カード / 支払い情報が描画される。
//   2. エッジ: 未契約(案件データなし)顧客でも基本情報タブがクラッシュせず、
//      「契約情報がありません」等のプレースホルダで描画される。
//   3. 既存の顧客一覧 → 詳細遷移(行クリックナビゲーション)が壊れていない。
//      案件情報は独立タブとして存在しない（基本情報タブに統合済み）。
//
// 認証は demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, 2FA off, seed 投入済）。
// 行は role="button" + aria-label="<名前>様"。
// contractStatus クエリで契約済み / 未契約を絞り込み、マスク後の名前に依存しない。
//
// Seed は tests/e2e/global-setup.ts で全 spec 起動前に 1 回だけ実行される。
// workers:1 + fullyParallel:false（playwright.config.ts）に追従。

const DEMO_EMAIL = "demo@solar-saas.demo";
const DEMO_PASSWORD = "Demo1234!";

// Auth.js credentials フローを demo パスワードで実行する。共有ヘルパ(fixtures/auth.ts)は
// PILOT_PASSWORD 固定なので、本 spec 専用にローカル定義する。
async function signInAsDemo(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(DEMO_EMAIL);
  await page.getByLabel("パスワード").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "サインイン" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 90_000 });
  await page.waitForLoadState("networkidle");
}

// 「基本情報」タブに統合された案件情報の案件固有カテゴリ見出し。
// embedded で 基本情報・体制・備考 は抑制されるため、案件固有のみを検証する。
const PROJECT_INFO_SECTION_HEADINGS = ["契約・金額", "工事・完工", "認定・設備", "概況"];

test.describe("F-061 顧客詳細『案件情報』統合ビュー", () => {
  // dev サーバの cold-compile（/login → /customers → /customers/[id]）を吸収するため
  // 30s 既定を 120s に拡張。workers:1 なので並列 compile competition は無い。
  test.describe.configure({ timeout: 120_000 });

  test("契約済み顧客: 基本情報タブの案件情報セクションに全カテゴリ見出し + 設備カード + 支払い情報が表示される", async ({
    page,
  }) => {
    await signInAsDemo(page);

    // 契約済みで絞り込み → 必ず案件データ(契約/設備/支払い)を持つ顧客行が出る。
    await page.goto("/customers?contractStatus=contracted");
    const firstRow = page.getByRole("button", { name: /様$/ }).first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();

    // 詳細へ遷移。既定で「基本情報」タブが選択状態。案件情報タブは存在しない。
    await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
    await expect(page.getByRole("tab", { name: "案件情報" })).toHaveCount(0);

    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // 案件情報セクションの区切り見出しが基本情報タブ内に描画される。
    await expect(panel.getByRole("heading", { name: "案件情報", exact: true })).toBeVisible();

    // 案件固有カテゴリの見出しが描画される。
    for (const heading of PROJECT_INFO_SECTION_HEADINGS) {
      // exact:true — 契約済みでは「契約・金額」サマリ見出しと「契約・金額 #1」契約別
      // 見出しが併存するため、サマリ側に厳密一致させる。
      await expect(
        panel.getByRole("heading", { name: heading, exact: true }).first(),
        `カテゴリ見出し「${heading}」が表示される`,
      ).toBeVisible();
    }

    // 契約済み顧客 → 設備明細セクション + 設備カード(PV/BT)が表示される。
    await expect(panel.getByRole("heading", { name: "設備明細" })).toBeVisible();
    await expect(panel.getByText("PV（太陽光）")).toBeVisible();
    await expect(panel.getByText("BT（蓄電池）")).toBeVisible();

    // 支払い情報(契約タブの金額/支払いステータス)が描画される。
    await expect(panel.getByText("ご契約金額（税込）").first()).toBeVisible();
    await expect(panel.getByText("支払いステータス").first()).toBeVisible();

    // プレースホルダ「契約情報がありません」が出ていない（= 実契約が描画されている）。
    await expect(panel.getByText("契約情報がありません")).toHaveCount(0);
  });

  test("未契約顧客: 基本情報タブの案件情報セクションがクラッシュせずプレースホルダで描画される", async ({
    page,
  }) => {
    await signInAsDemo(page);

    // 商談中(未契約)で絞り込み → 契約/設備/支払いデータを持たない顧客行が出る。
    await page.goto("/customers?contractStatus=negotiating");
    const firstRow = page.getByRole("button", { name: /様$/ }).first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();

    await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });

    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // クラッシュせず案件情報の区切り見出しと案件固有カテゴリ見出しが出る。
    await expect(panel.getByRole("heading", { name: "案件情報", exact: true })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "概況" })).toBeVisible();

    // 契約が無いので「契約情報がありません」プレースホルダが表示される。
    await expect(panel.getByText("契約情報がありません")).toBeVisible();
  });

  test("既存の顧客一覧 → 詳細遷移(行クリックナビゲーション)が壊れていない", async ({ page }) => {
    await signInAsDemo(page);

    await page.goto("/customers");
    const firstRow = page.getByRole("button", { name: /様$/ }).first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();

    // 行クリックで顧客詳細ページへ遷移し、既定の「基本情報」タブが選択状態になる。
    await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
    await expect(page.getByRole("tab", { name: "基本情報" })).toHaveAttribute(
      "data-state",
      "active",
    );
    // 案件情報は独立タブとしては存在しない（基本情報タブに統合済み）。
    await expect(page.getByRole("tab", { name: "案件情報" })).toHaveCount(0);
    // 既存の他タブ（商談履歴）は引き続き共存している（タブ群を壊していない）。
    await expect(page.getByRole("tab", { name: "商談履歴" })).toBeVisible();
  });
});
