import { expect, test, type Page } from "@playwright/test";

// 顧客詳細「契約状況」タブ拡充 + 基本情報タブ「契約予定情報」読み取り専用 pull +
// 顧客情報インライン編集からの住所(フルテキスト)欄削除 を検証する
// (F-031 / F-062 / docs/02 顧客詳細・契約予定情報ユースケース)。
//
// 今回の変更点（検証対象）:
//   1. 契約状況タブ(value="contract"): 「概況（ContractStatusPanel: 契約プラン/金額/
//      予定日）」+「契約予定情報（案件詳細）（ProjectContractList editable: 契約概要・
//      金額・契約予定日・契約番号・設備明細・認定 を per-contract で表示・編集）」の
//      単一面に拡充。EditContractDialog 等で編集→保存→反映できる。
//   2. 基本情報タブの「契約予定情報」: 契約状況タブと同じ内容を読み取り専用 pull
//      (contractReadOnly)。契約系の編集トリガー（契約・金額・ローンを編集 / 設備明細を
//      編集 / 認定・設備（申請）を編集）が一切描画されない。
//   3. 住所欄削除: 基本情報の顧客情報インライン編集に「住所」フルテキスト入力が無く、
//      郵便番号/都道府県/市区町村/番地の入力は残存している。
//
// 認証は demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, 2FA off, seed 投入済）。
// 行は role="button" + aria-label="<名前>様"。contractStatus クエリで契約済みを絞り込む。
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

async function openContractedCustomer(page: Page): Promise<void> {
  await page.goto("/customers?contractStatus=contracted");
  const firstRow = page.getByRole("button", { name: /様$/ }).first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
}

// 契約系の編集トリガー（aria-label）。契約状況タブには出て、基本情報タブの読み取り
// 専用 pull には一切出ない、というのが本変更の核心の契約。
const CONTRACT_EDIT_TRIGGERS = [
  "契約・金額・ローンを編集",
  "認定・設備（申請）を編集",
] as const;

test.describe("顧客詳細『契約状況』タブ拡充 + 基本情報『契約予定情報』読み取り専用 pull", () => {
  // dev サーバの cold-compile（/login → /customers → /customers/[id]）を吸収するため
  // 30s 既定を 120s に拡張。workers:1 なので並列 compile competition は無い。
  test.describe.configure({ timeout: 120_000 });

  test("契約状況タブ: 概況（プラン/金額/予定日）+ 案件詳細（per-contract 契約・金額・設備明細・認定）が表示・編集できる", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    // 「契約状況」タブへ切替。
    await page.getByRole("tab", { name: "契約状況" }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // 概況セクション（ContractStatusPanel）: 契約プラン / 契約金額 / 契約予定日 の入力。
    await expect(
      panel.getByRole("heading", { name: "契約状況（概況）" }),
    ).toBeVisible();
    await expect(panel.locator("#contract-plan")).toBeVisible();
    await expect(panel.locator("#contract-amount")).toBeVisible();
    await expect(panel.locator("#contract-date")).toBeVisible();

    // 案件詳細セクション（ProjectContractList editable）: 契約・金額サマリ + per-contract。
    await expect(
      panel.getByRole("heading", { name: "契約予定情報（案件詳細）" }),
    ).toBeVisible();
    // 契約・金額サマリ見出し + per-contract「契約・金額 #1」見出しが併存する。
    await expect(panel.getByRole("heading", { name: "契約・金額", exact: true }).first()).toBeVisible();
    await expect(panel.getByRole("heading", { name: /契約・金額 #1/ })).toBeVisible();

    // per-contract の主要項目（契約日 / ご契約金額 / 設備明細 / 認定・設備）が描画される。
    await expect(panel.locator("dt", { hasText: "契約日" }).first()).toBeVisible();
    await expect(panel.getByText("ご契約金額（税込）").first()).toBeVisible();
    await expect(panel.getByRole("heading", { name: "設備明細" })).toBeVisible();
    await expect(panel.getByText("PV（太陽光）")).toBeVisible();
    await expect(panel.getByRole("heading", { name: "認定・設備" }).first()).toBeVisible();

    // 契約系の編集トリガー（鉛筆）が描画される（= 編集面が契約状況タブに集約されている）。
    await expect(
      panel.getByRole("button", { name: "契約・金額・ローンを編集" }).first(),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: /設備明細を編集/ }).first(),
    ).toBeVisible();

    // 概況の編集→保存→反映: 契約プランを一意な値に書き換えて保存。
    const planStamp = `E2Eプラン${Date.now() % 100000}`;
    await panel.locator("#contract-plan").fill(planStamp);
    await panel.getByRole("button", { name: "保存" }).first().click();
    // 保存後 router.refresh で再描画され、入力値が維持される。
    await expect(panel.locator("#contract-plan")).toHaveValue(planStamp, { timeout: 30_000 });

    // 案件詳細の per-contract 契約編集→保存→反映: ローン会社を一意な値に書き換える。
    await panel.getByRole("button", { name: "契約・金額・ローンを編集" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const loanStamp = `信販E2E${Date.now() % 100000}`;
    await dialog.getByLabel("ローン会社").fill(loanStamp);
    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    // 編集後の値はローン情報タブ側で表示されるため、保存が成功し dialog が閉じたことを
    // もって反映完了とみなす（contract タブには loanCompany 値表示が無い設計）。
  });

  test("基本情報タブ『契約予定情報』: 契約予定情報が読み取り専用で表示され、契約系の編集トリガーが描画されない", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    // 既定は「基本情報」タブ。
    await expect(page.getByRole("tab", { name: "基本情報" })).toHaveAttribute(
      "data-state",
      "active",
    );
    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // 「契約情報」区分見出しの下に契約予定情報が pull 表示される（再設計で改称）。
    await expect(
      panel.getByRole("heading", { name: "契約情報", exact: true }),
    ).toBeVisible();
    // 契約・金額サマリ + per-contract 設備明細が読み取り専用で描画される。
    await expect(panel.getByRole("heading", { name: "契約・金額", exact: true }).first()).toBeVisible();
    await expect(panel.getByRole("heading", { name: "設備明細" })).toBeVisible();
    await expect(panel.getByText("PV（太陽光）")).toBeVisible();

    // 契約系の編集トリガーは基本情報タブの pull 表示には一切描画されない
    // （編集面は契約状況タブに集約）。
    for (const label of CONTRACT_EDIT_TRIGGERS) {
      await expect(
        panel.getByRole("button", { name: label }),
        `基本情報タブの読み取り専用 pull に「${label}」が描画されないこと`,
      ).toHaveCount(0);
    }
    // 設備明細の編集トリガーも基本情報タブには出ない。
    await expect(
      panel.getByRole("button", { name: /設備明細を編集/ }),
      "基本情報タブの読み取り専用 pull に設備明細編集トリガーが描画されないこと",
    ).toHaveCount(0);

    // 一方で、現状情報側の編集（顧客情報インライン編集 / ヒアリングのインライン編集）は
    // 引き続き基本情報タブに残る（契約系のみが契約状況タブへ移動した）。ヒアリングは
    // 再設計でカード内インライン編集化されたため、家族属性の入力欄で確認する。
    await expect(panel.locator("#hr-husband")).toBeVisible();
  });

  test("住所欄削除: 顧客情報インライン編集に住所フルテキスト欄が無く、郵便番号/都道府県/市区町村/番地は残存する", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // 顧客情報インライン編集が描画されている（WHOLESALER_ADMIN は編集権限あり）。
    await expect(panel.locator("#basic-name")).toBeVisible();

    // 残存すべき住所系入力（郵便番号 / 都道府県 / 市区町村 / 番地）。
    await expect(panel.locator("#basic-postal"), "郵便番号入力").toBeVisible();
    await expect(panel.locator("#basic-prefecture"), "都道府県入力").toBeVisible();
    await expect(panel.locator("#basic-city"), "市区町村入力").toBeVisible();
    await expect(panel.locator("#basic-address-line"), "番地入力").toBeVisible();

    // 削除された「住所」フルテキスト入力（旧 id="basic-address"）が無いこと。
    await expect(
      panel.locator("#basic-address"),
      "住所フルテキスト入力(#basic-address)が削除されていること",
    ).toHaveCount(0);
    // 「住所」というラベルを持つ入力フィールドが存在しないこと（郵便番号/都道府県/
    // 市区町村/番地 は別ラベルなので誤検出しない）。
    await expect(
      panel.getByLabel("住所", { exact: true }),
      "「住所」ラベルのフルテキスト入力が無いこと",
    ).toHaveCount(0);
  });
});
