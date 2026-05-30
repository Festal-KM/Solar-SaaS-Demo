import { expect, test } from "@playwright/test";
import { signIn } from "../fixtures/auth";

// E2E smoke spec for SP-02 T-02-12 — masters end-to-end regression net.
//
// 個別 spec (`venue-providers.spec.ts`, `products.spec.ts`,
// `installers.spec.ts`, `incentive-rates.spec.ts`,
// `wholesaler-settings.spec.ts`, `hub.spec.ts`) はそれぞれの CRUD 詳細を
// 検証する。本 spec は SP-02 全体の一気通貫スモークとして、wholesaler_admin
// が 5 マスタすべての登録 + ハブ + 価格改定を 1 セッション内で実行できる
// ことを担保する。タブ切替 (S-052) → 各独立画面 (S-019/S-042/S-052 内
// サブセクション) を順に踏むのでナビゲーションの整合性も同時に確認される。
//
// 作成成功の判定は「create Server Action の redirect 先（詳細画面）の
// フォーム input が当該値で pre-fill されている」ことで行う。一覧画面で
// 新規行を探すアプローチは fullyParallel:true の下で他 spec が同テナントに
// 行を頻繁に追加・close するため flaky になりやすく、各 master の一覧反映
// CRUD は対応する個別 spec が深く検証する。

// 5 マスタ + ハブ往復 + 価格改定まで踏むので個別 spec より長めに取る。
test.describe.configure({ timeout: 180_000 });

// fullyParallel:true で 6+ spec が同じ Next.js dev server を叩くため RSC
// 再レンダリングが遅延するケースがある。詳細画面の pre-fill assert には
// 長めの timeout を当てて parallel 実行の負荷を吸収する。
const DETAIL_ASSERTION_TIMEOUT = 20_000;

// Seed は `tests/e2e/global-setup.ts` で 1 回だけ実行される（旧版で各 spec の
// beforeAll に spawn を撒いていたが、Windows + pnpm の race で間欠失敗を
// 起こすため globalSetup に集約した）。

test("wholesaler_admin walks through hub + all 5 masters in one session", async ({ page }) => {
  const stamp = Date.now();
  const venueName = `スモーク場所提供元 ${stamp}`;
  const productName = `スモークパネル ${stamp}`;
  const installerName = `スモーク施工業者 ${stamp}`;
  // Stamp a unique incentive rate value (0.00 .. 89.99) per run.
  const incentiveRate = ((stamp % 9000) / 100).toFixed(2);

  await signIn(page, "wholesaler_admin@solar-saas.dev");

  // ----- a. /masters ハブ：5 タブが全部 visible -----
  await page.goto("/masters");
  await expect(page.getByRole("heading", { name: "マスタ管理", level: 1 })).toBeVisible();
  for (const label of [
    "二次店関係",
    "施工業者",
    "インセンティブ率",
    "キャンセル期限",
    "年度開始月",
  ]) {
    await expect(page.getByRole("tab", { name: label })).toBeVisible();
  }

  // ----- b. 施工業者タブクリック → パネル切替 -----
  await page.getByRole("tab", { name: "施工業者" }).click();
  await expect(page.getByRole("heading", { name: "施工業者", level: 2 })).toBeVisible();

  // ----- c. /masters/installers 独立画面 → 新規作成 → 一覧反映 -----
  await page.goto("/masters/installers");
  await expect(page.getByRole("heading", { name: "施工業者マスタ" })).toBeVisible();

  await page.getByRole("link", { name: "施工業者を新規登録" }).first().click();
  await page.waitForURL("**/masters/installers/new", { timeout: 30_000 });

  await page.getByLabel("名称", { exact: false }).fill(installerName);
  await page.getByLabel("対応エリア").fill("関東");
  await page.getByLabel("担当者").fill("スモーク担当");
  await page.getByLabel("電話").fill("03-0000-0000");
  await page.getByRole("button", { name: "登録" }).click();

  await page.waitForURL((url) => /\/masters\/installers\/[^/]+$/.test(url.pathname), {
    timeout: 30_000,
  });
  // 作成成功 → redirect 先の詳細フォームに name が pre-fill されていることを
  // 確認する。一覧画面は parallel 実行で他 spec が同テナントの行を頻繁に
  // 追加・close するため、フィルタ反映タイミングが flaky になりやすい
  // （CRUD 全体の検証は installers.spec.ts の責務）。
  await expect(page.getByLabel("名称", { exact: false })).toHaveValue(installerName, {
    timeout: DETAIL_ASSERTION_TIMEOUT,
  });

  // ----- d. /masters/products 新規作成 → 一覧反映 → 価格改定 -----
  await page.goto("/masters/products");
  await expect(page.getByRole("heading", { name: "商品・価格マスタ" })).toBeVisible();

  await page.getByRole("link", { name: "商品を新規登録" }).first().click();
  await page.waitForURL("**/masters/products/new", { timeout: 30_000 });

  await page.getByLabel("カテゴリ", { exact: false }).selectOption("PANEL");
  await page.getByLabel("メーカー", { exact: false }).fill("スモークメーカー");
  await page.getByLabel("商品名", { exact: false }).fill(productName);
  await page.getByLabel("単位", { exact: false }).fill("枚");
  await page.getByLabel("仕入値（円）").fill("31000");
  await page.getByLabel("二次店向け卸値（円）").fill("41000");
  await page.getByLabel("参考売価（円）").fill("56000");
  await page.getByRole("button", { name: "登録" }).click();

  await page.waitForURL((url) => /\/masters\/products\/[^/]+$/.test(url.pathname), {
    timeout: 30_000,
  });

  // redirect 先の詳細フォームに商品名が pre-fill されていれば作成成功。
  await expect(page.getByLabel("商品名", { exact: false })).toHaveValue(productName, {
    timeout: DETAIL_ASSERTION_TIMEOUT,
  });

  // 価格改定 — 既に詳細画面に居るのでそのまま遷移。effectiveFrom は当日と
  // 衝突しないよう翌日。
  await page.getByRole("link", { name: "価格を改定" }).click();
  await page.waitForURL("**/revise", { timeout: 30_000 });

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await page.getByLabel("適用開始日", { exact: false }).fill(tomorrow);
  await page.getByLabel("二次店向け卸値（円）").fill("39000");
  await page.getByLabel("改定理由").fill("スモーク改定");
  await page.getByRole("button", { name: "価格改定を確定" }).click();

  await page.waitForURL((url) => /\/masters\/products\/[^/]+$/.test(url.pathname), {
    timeout: 30_000,
  });
  // 価格改定成功 → 後継商品の詳細画面へ遷移。同じく商品名 input が
  // pre-fill されていることで成功を確認する（履歴 / 価格反映の論理は
  // products.spec.ts が深く検証する）。
  await expect(page.getByLabel("商品名", { exact: false })).toHaveValue(productName, {
    timeout: DETAIL_ASSERTION_TIMEOUT,
  });

  // ----- e. /masters/incentive-rates 新規作成 → 一覧反映 -----
  await page.goto("/masters/incentive-rates");
  await expect(page.getByRole("heading", { name: "インセンティブ率マスタ" })).toBeVisible();

  await page.getByRole("link", { name: "インセンティブ率を新規登録" }).first().click();
  await page.waitForURL("**/masters/incentive-rates/new", { timeout: 30_000 });

  await page.getByLabel("対象粗利種別").selectOption("PROJECT_PROFIT");
  await page.getByLabel("率（%）", { exact: false }).fill(incentiveRate);
  // effectiveFrom は seed と衝突しないよう 45 日後。
  const future = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await page.getByLabel("適用開始日").fill(future);
  await page.getByRole("button", { name: "登録" }).click();

  await page.waitForURL((url) => /\/masters\/incentive-rates\/[^/]+$/.test(url.pathname), {
    timeout: 30_000,
  });
  // 一覧画面は他 spec の concurrent create で行が closed されたり 並び替えで
  // ページ外へ流れたりするので、redirect 先の詳細画面で rate 入力が当該値で
  // pre-fill されていることを確認する（CRUD ループの完全性は
  // incentive-rates.spec.ts が担保）。
  await expect(page.getByLabel("率（%）", { exact: false })).toHaveValue(incentiveRate, {
    timeout: DETAIL_ASSERTION_TIMEOUT,
  });

  // ----- f. /masters/venue-providers 新規作成 → 一覧反映 -----
  await page.goto("/masters/venue-providers");
  await expect(page.getByRole("heading", { name: "場所提供元マスタ" })).toBeVisible();

  await page.getByRole("link", { name: "場所提供元を新規登録" }).first().click();
  await page.waitForURL("**/masters/venue-providers/new", { timeout: 30_000 });

  await page.getByLabel("名称", { exact: false }).fill(venueName);
  await page.getByLabel("エリア").fill("関東");
  await page.getByLabel("住所").fill("東京都千代田区丸の内 1-1-1");
  await page.getByLabel("契約形態").selectOption("FIXED");
  await page.getByLabel("固定費（円）").fill("60000");
  await page.getByRole("button", { name: "登録" }).click();

  await page.waitForURL((url) => /\/masters\/venue-providers\/[^/]+$/.test(url.pathname), {
    timeout: 30_000,
  });
  // redirect 先の詳細フォームに名称が pre-fill されていれば作成成功
  // （CRUD ループの完全性は venue-providers.spec.ts が担保）。
  await expect(page.getByLabel("名称", { exact: false })).toHaveValue(venueName, {
    timeout: DETAIL_ASSERTION_TIMEOUT,
  });

  // ----- g. /masters/wholesaler-settings 設定変更 → 戻す -----
  // AuditLog 確認は hub.spec.ts / wholesaler-settings.spec.ts の責務。ここでは
  // フォーム送信が 200 で返り値が反映されることだけ確認する。
  await page.goto("/masters/wholesaler-settings");
  await expect(page.getByRole("heading", { name: "卸業者設定" })).toBeVisible();

  await page.getByLabel("キャンセル期限（日数）", { exact: false }).fill("10");
  await page.getByRole("button", { name: "保存" }).click();
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.getByLabel("キャンセル期限（日数）", { exact: false })).toHaveValue("10");

  // クリーンアップ：他 spec のデフォルト前提に戻す。
  await page.getByLabel("キャンセル期限（日数）", { exact: false }).fill("8");
  await page.getByRole("button", { name: "保存" }).click();
  await page.waitForLoadState("networkidle");
});
