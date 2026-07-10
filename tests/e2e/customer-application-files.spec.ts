import { expect, test, type Page } from "@playwright/test";

// 顧客ファイルのカテゴリ分離 (F-031 拡張 / docs/05).
//
// 既存の関連ファイル基盤（CustomerFile + R2 pre-signed URL）を流用し、ファイルを用途で
// カテゴリ分離する:
//   - GENERAL     = 「関連ファイル」タブ
//   - APPLICATION = 「設置申請」タブの各申請サブタブ内「関連ドキュメント」（CustomerFile.applicationId
//                   で個別の Application に紐づく。顧客レベルの単一カードは撤去済み）。
//
// 検証対象（新レイアウト）:
//   1. 関連ファイルタブに GENERAL ファイルが表示される。同タブには APPLICATION カテゴリの
//      ファイルは出ない（カテゴリ分離）。
//   2. 設置申請タブは applicationId 未紐付けの APPLICATION ファイル（孤立）を顧客レベルでは
//      表示しない。申請を持たない顧客では空状態（emptyEditable）が描画され、旧「申請関連
//      ドキュメント」カードが存在しないことを確認する。
//
// R2 は本環境では placeholder 認証のため実 PUT は通らない。よって E2E では seed が
// 投入したメタデータのみのファイル行（一覧描画は DB 行だけで成立）でカテゴリ分離を検証する。
// seed（seedCustomerFiles）は先頭サンプル顧客「佐藤 一馬」に
//   GENERAL: 見積書サンプル.pdf / APPLICATION: 設置申請書サンプル.pdf（applicationId=null）
// を冪等投入する。この顧客は契約前（pre_visit）で Application を持たないため、設置申請タブは
// 空状態になる。一覧の表示名は MASKED（"***様"）だが検索クエリは DB の生 name を contains
// マッチするため、query=佐藤 一馬 で該当顧客 1 行を決定的に取得できる。
//
// 申請サブタブ内の「関連ドキュメント」section（applicationId 紐付けのアップロード UI）の
// 描画検証は customer-application-subtabs.spec.ts が担う。
//
// 認証は demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, 2FA off, seed 投入済）。
// Seed は tests/e2e/global-setup.ts で全 spec 起動前に 1 回だけ実行される。

const DEMO_EMAIL = "demo@solar-saas.demo";
const DEMO_PASSWORD = "Demo1234!";

// seed の先頭サンプル顧客「佐藤 一馬」を生 name の contains 検索で一意に絞る
// （イベントデモ顧客にも「佐藤」が居るため、固有の名「一馬」込みで一意化する）。
const SEEDED_CUSTOMER_QUERY = "佐藤 一馬";
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

test.describe("顧客ファイル カテゴリ分離（GENERAL / APPLICATION）", () => {
  // dev サーバの cold-compile を吸収するため 30s → 120s に拡張。
  test.describe.configure({ timeout: 120_000 });

  test("関連ファイルタブに GENERAL のみ表示、設置申請タブは顧客レベルの申請ファイルカードを持たない", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await gotoSeededCustomerDetail(page);

    // 設置申請タブへ切り替え。この顧客は Application を持たないため空状態（emptyEditable）。
    // 旧「申請関連ドキュメント」顧客レベルカードは撤去済み → 見出しも APPLICATION ファイルも出ない。
    await page.getByRole("tab", { name: "設置申請" }).click();
    const subsidyPanel = page.getByRole("tabpanel");
    await expect(subsidyPanel).toBeVisible();
    await expect(subsidyPanel.getByText("設置申請はまだありません。", { exact: false })).toBeVisible();
    await expect(subsidyPanel.getByRole("heading", { name: "申請関連ドキュメント" })).toHaveCount(0);
    // applicationId 未紐付けの APPLICATION ファイルは顧客レベルでは表示されない（孤立）。
    await expect(subsidyPanel.getByText(APPLICATION_FILE)).toHaveCount(0);
    await expect(subsidyPanel.getByText(GENERAL_FILE)).toHaveCount(0);

    // 関連ファイルタブへ切り替え。GENERAL ファイルのみ表示され、APPLICATION ファイルは出ない。
    await page.getByRole("tab", { name: "関連ファイル" }).click();
    const filesPanel = page.getByRole("tabpanel");
    await expect(filesPanel).toBeVisible();
    await expect(filesPanel.getByText(GENERAL_FILE)).toBeVisible();
    await expect(filesPanel.getByText(APPLICATION_FILE)).toHaveCount(0);
  });
});
