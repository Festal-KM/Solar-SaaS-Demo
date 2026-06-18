import { expect, test, type Page } from "@playwright/test";

// 設置申請状況タブ「申請関連ドキュメント」ファイルアップロード機能 (F-031 拡張 / docs/05).
//
// 既存の関連ファイル基盤（CustomerFile + R2 pre-signed URL）を流用し、ファイルを用途で
// 2 カテゴリに分離する:
//   - GENERAL     = 「関連ファイル」タブ
//   - APPLICATION = 「設置申請状況」タブの「申請関連ドキュメント」
//
// 検証対象:
//   1. 設置申請状況タブに「申請関連ドキュメント」見出しと APPLICATION ファイルが表示される。
//      その APPLICATION ファイルは「関連ファイル」タブには出ない。
//   2. 関連ファイルタブに GENERAL ファイルが表示される。その GENERAL ファイルは
//      設置申請状況タブの申請関連ドキュメントには出ない（相互排他）。
//
// R2 は本環境では placeholder 認証のため実 PUT は通らない。よって E2E では seed が
// 投入したメタデータのみのファイル行（一覧描画は DB 行だけで成立）でカテゴリ分離を検証する。
// seed（seedCustomerActivities, i===0）は先頭サンプル顧客「サンプル佐藤 一郎」に
//   GENERAL: 見積書サンプル.pdf / APPLICATION: 設置申請書サンプル.pdf
// を冪等投入する。一覧の表示名は MASKED（"***様"）だが検索クエリは DB の生 name を
// contains マッチするため、query=佐藤 で該当顧客 1 行を決定的に取得できる。
//
// 認証は demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, 2FA off, seed 投入済）。
// Seed は tests/e2e/global-setup.ts で全 spec 起動前に 1 回だけ実行される。

const DEMO_EMAIL = "demo@solar-saas.demo";
const DEMO_PASSWORD = "Demo1234!";

// seed の先頭サンプル顧客「サンプル佐藤 一郎」を生 name の contains 検索で一意に絞る
// （イベントデモ顧客にも「佐藤」が居るため、サンプル接頭辞込みで一意化する）。
const SEEDED_CUSTOMER_QUERY = "サンプル佐藤";
const GENERAL_FILE = "見積書サンプル.pdf";
const APPLICATION_FILE = "設置申請書サンプル.pdf";

async function signInAsDemo(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(DEMO_EMAIL);
  await page.getByLabel("パスワード").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "サインイン" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 90_000 });
  await page.waitForLoadState("networkidle");
}

// seed 済みファイルを持つ先頭サンプル顧客の詳細ページへ遷移する（生 name 検索で一意に絞る）。
async function gotoSeededCustomerDetail(page: Page): Promise<void> {
  await page.goto(`/customers?query=${encodeURIComponent(SEEDED_CUSTOMER_QUERY)}`);
  const row = page.getByRole("button", { name: /様$/ }).first();
  await expect(row).toBeVisible();
  await row.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
}

test.describe("設置申請状況タブ 申請関連ドキュメント（カテゴリ分離）", () => {
  // dev サーバの cold-compile を吸収するため 30s → 120s に拡張。
  test.describe.configure({ timeout: 120_000 });

  test("設置申請タブに APPLICATION ファイルが表示され、関連ファイルタブには出ない", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await gotoSeededCustomerDetail(page);

    // 設置申請状況タブへ切り替え。
    await page.getByRole("tab", { name: "設置申請状況" }).click();
    const subsidyPanel = page.getByRole("tabpanel");
    await expect(subsidyPanel).toBeVisible();

    // 「申請関連ドキュメント」見出し + APPLICATION ファイルが描画される。
    await expect(
      subsidyPanel.getByRole("heading", { name: "申請関連ドキュメント" }),
    ).toBeVisible();
    await expect(subsidyPanel.getByText(APPLICATION_FILE)).toBeVisible();
    // GENERAL ファイルは設置申請タブには出ない。
    await expect(subsidyPanel.getByText(GENERAL_FILE)).toHaveCount(0);

    // 関連ファイルタブへ切り替え。
    await page.getByRole("tab", { name: "関連ファイル" }).click();
    const filesPanel = page.getByRole("tabpanel");
    await expect(filesPanel).toBeVisible();

    // 関連ファイルタブには GENERAL ファイルのみ。APPLICATION ファイルは出ない。
    await expect(filesPanel.getByText(GENERAL_FILE)).toBeVisible();
    await expect(filesPanel.getByText(APPLICATION_FILE)).toHaveCount(0);
  });
});
