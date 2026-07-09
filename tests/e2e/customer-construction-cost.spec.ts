import { expect, test, type Page } from "@playwright/test";

// 顧客詳細「施工」タブ — ローン審査タブと同型の per-Construction サブタブ（docs/02 §16 / docs/05 §16）.
//
// 検証対象（新レイアウト）:
//   1. 施工タブ(value="construction")のトップに施工サブタブ（ProjectConstructionList）を
//      単一 Card（見出し「施工状況」）で配置。各サブタブ（施工 #N）に完工ステータス / 対応事業者 /
//      工事予定日 / 施工コスト 等を表示し、施工コストは ¥ 金額表示。単一 ConstructionStatusPanel は撤去。
//   2. EditConstructionDialog（aria-label「工事・完工を編集」）を開き、施工コストを変更保存
//      → 再描画後に反映される（saveProjectConstructionAction 経由）。
//   3. 契約/施工が無い顧客（佐藤 一馬・編集可能）では「施工を追加」導線つき空状態を表示。
//   4. 重複排除: 基本情報タブ内「案件情報」埋め込みビューに「工事・完工」セクション/施工コスト
//      編集UIが二重に出ないこと（施工タブへ集約済み）。PV設置図面 は施工タブ最下部に残る。
//
// 認証は demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, 2FA off, seed 投入済）。
// Seed は tests/e2e/global-setup.ts で全 spec 起動前に 1 回だけ実行される。
// workers:1 + fullyParallel:false（playwright.config.ts）に追従。
//
// 今回の差分: seed は Construction.fee のサンプル値（850000 + (seq%4)*50000）を冪等投入し、
// EditConstructionDialog にも fee 入力欄（#cn-fee, MoneyInput=type=text, ラベル「施工コスト」）が
// 追加された。これに伴い、施工コストは契約済み顧客で実データ「¥金額」表示となり、
// round-trip 検証は対応事業者名(vendorName)の代替ではなく fee の数値そのものを
// 編集→保存→再描画で直接検証する。

const DEMO_EMAIL = "demo@solar-saas.demo";
const DEMO_PASSWORD = "Demo1234!";

// seed の先頭サンプル顧客「佐藤 一馬」（s=0）— 提案中・契約なし → 施工コスト空状態の検証に使う。
const NO_CONTRACT_CUSTOMER_QUERY = "佐藤 一馬";

const ct = {
  // labels.customer.detail.cards.construction / constructionTab.* / pvDrawing.title
  cardTitle: "施工状況", // トップ Card 見出し（= cards.construction）
  emptyEditable: "施工はまだありません。「施工を追加」から作成してください。",
  addConstruction: "施工を追加",
  pvDrawingTitle: "PV設置図面",
  // 工事・完工 MetaItem ラベル（projectInfo.fields.*）
  completionStatus: "完工ステータス",
  plannedDate: "工事予定日",
  vendorName: "対応事業者名",
  fee: "施工コスト",
  editTrigger: "工事・完工を編集",
} as const;

async function signInAsDemo(page: Page): Promise<void> {
  await page.goto("/login", { timeout: 120_000 });
  await page.getByLabel("メールアドレス").fill(DEMO_EMAIL);
  await page.getByLabel("パスワード").fill(DEMO_PASSWORD);
  const submit = page.getByRole("button", { name: "サインイン" });
  await expect(submit).toBeVisible();
  await submit.click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 });
}

// 契約済み顧客（施工コストタブに契約/施工が出る顧客）を開く。
async function openContractedCustomer(page: Page): Promise<void> {
  await page.goto("/customers?contractStatus=contracted");
  const firstRow = page.getByRole("button", { name: /様$/ }).first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
}

// 先頭サンプル顧客「佐藤 一馬」（契約なし）を開く。
async function openNoContractCustomer(page: Page): Promise<void> {
  await page.goto(`/customers?query=${encodeURIComponent(NO_CONTRACT_CUSTOMER_QUERY)}`);
  const row = page.getByRole("button", { name: /様$/ }).first();
  await expect(row).toBeVisible();
  await row.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
}

// 1 つの「ラベル → 値」(MetaItem) について、ラベルに隣接する dd 値テキストを取得。
async function metaValue(
  scope: ReturnType<Page["getByRole"]>,
  label: string,
): Promise<string> {
  const dt = scope.locator("dt", { hasText: label }).first();
  await expect(dt, `MetaItem ラベル「${label}」が存在する`).toBeVisible();
  const dd = dt.locator("xpath=following-sibling::dd[1]");
  return ((await dd.textContent()) ?? "").trim();
}

test.describe("施工タブ — per-Construction サブタブ（ローン審査タブ同型）", () => {
  test.describe.configure({ timeout: 120_000 });

  test("施工タブのトップに施工サブタブ + 各フィールド + PV設置図面 が表示され、施工コストが金額表示される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    // 施工タブへ切り替え。施工サブタブ（施工 #N）を内包するため、role=tabpanel が外側（施工）
    // + 内側（施工 #N）の 2 つ active になる。外側パネル（id 末尾 -content-construction）に
    // スコープして曖昧さを排除する。
    await page.getByRole("tab", { name: "施工" }).first().click();
    const panel = page.locator('[role="tabpanel"][id$="-content-construction"]');
    await expect(panel).toBeVisible();

    // トップ Card 見出し「施工状況」— 施工サブタブを内包する単一カード。
    await expect(
      panel.getByRole("heading", { name: ct.cardTitle }).first(),
    ).toBeVisible();
    // PV設置図面 セクション — 最下部に残る。
    await expect(panel.getByRole("heading", { name: ct.pvDrawingTitle })).toBeVisible();

    // 施工レコードごとのサブタブ「施工 #1」がトップに出る（契約済み顧客は施工付き契約を持つ）。
    await expect(page.getByRole("tab", { name: /^施工 #1$/ })).toBeVisible();
    // 空状態メッセージは出ない。
    await expect(panel.getByText(ct.emptyEditable)).toHaveCount(0);

    // 工事・完工 MetaItem ラベル群（完工ステータス / 工事予定日 / 対応事業者 / 施工コスト）が描画される。
    for (const label of [ct.completionStatus, ct.plannedDate, ct.vendorName, ct.fee]) {
      await expect(
        panel.locator("dt", { hasText: label }).first(),
        `工事・完工フィールド「${label}」が表示される`,
      ).toBeVisible();
    }

    // 施工コストは金額表示（¥… + toLocaleString）。seed は fee サンプル値
    // （850000 + (seq%4)*50000 → 850,000〜1,000,000）を投入するため、契約済み顧客では
    // 「¥金額」が実データ表示される（未設定にはならない）。
    const feeText = await metaValue(panel, ct.fee);
    expect(feeText, `施工コスト「${feeText}」は ¥金額 表示`).toMatch(/^¥[\d,]+$/);
  });

  test("EditConstructionDialog の施工コスト入力欄で fee を変更保存 → 再描画後に金額表示が更新される（fee round-trip）", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    await page.getByRole("tab", { name: "施工" }).first().click();
    const panel = page.locator('[role="tabpanel"][id$="-content-construction"]');
    await expect(panel).toBeVisible();

    // 施工コストセクションの施工サブタブ（施工 #1）の工事・完工ブロックの編集トリガーを開く。
    await expect(page.getByRole("tab", { name: /^施工 #1$/ })).toBeVisible();
    await panel.getByRole("button", { name: ct.editTrigger }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // 施工コスト入力欄（#cn-fee, MoneyInput=type=text）が存在することを確認し、一意な値へ書き換えて保存。
    // 末尾を固定しつつ衝突しない値を作る（seed の 850,000〜1,000,000 帯とは別の桁にする）。
    const feeValue = 1_200_000 + (Date.now() % 1000) * 100; // 1,200,000〜1,299,900
    const feeInput = dialog.locator("#cn-fee");
    await expect(feeInput, "施工コスト入力欄(#cn-fee)が存在する").toBeVisible();
    await expect(feeInput).toHaveAttribute("type", "text");
    await feeInput.fill(String(feeValue));
    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // 再描画後、施工コストセクションの「施工コスト」金額表示が新しい値（¥ + ja-JP locale）へ更新される。
    const expected = `¥${feeValue.toLocaleString("ja-JP")}`;
    await expect(async () => {
      const after = await metaValue(panel, ct.fee);
      expect(after).toBe(expected);
    }).toPass({ timeout: 30_000 });
  });

  test("契約/施工が無い顧客（佐藤 一馬・編集可能）では「施工を追加」導線つき空状態を表示する", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openNoContractCustomer(page);

    await page.getByRole("tab", { name: "施工" }).first().click();
    const panel = page.locator('[role="tabpanel"][id$="-content-construction"]');
    await expect(panel).toBeVisible();

    // トップ Card 見出しは出るが、施工 0 件のため編集可能な空状態（追加導線つき）を表示し、
    // 施工サブタブは出ない。
    await expect(panel.getByRole("heading", { name: ct.cardTitle }).first()).toBeVisible();
    await expect(panel.getByText(ct.emptyEditable)).toBeVisible();
    await expect(panel.getByRole("button", { name: ct.addConstruction })).toBeVisible();
    await expect(page.getByRole("tab", { name: /^施工 #1$/ })).toHaveCount(0);

    // PV設置図面 は契約なしでも最下部に表示される。
    await expect(panel.getByRole("heading", { name: ct.pvDrawingTitle })).toBeVisible();
  });
});

test.describe("重複排除（基本情報タブの案件情報埋め込みビュー）", () => {
  test.describe.configure({ timeout: 120_000 });

  test("基本情報タブの案件情報に「工事・完工」セクション/施工コスト編集UIが二重に出ない", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    // 既定タブ = 基本情報。タブパネル（案件情報埋め込み含む）を scope する。
    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // 案件情報セクション見出しが基本情報タブ内に統合表示されている
    // （基本情報タブ再設計で「案件情報」→「契約情報」へ改称）。
    await expect(panel.getByText("契約情報").first()).toBeVisible();

    // 施工状況タブへ集約した「工事・完工」セクション見出し（h3）は基本情報タブには無い。
    await expect(panel.getByRole("heading", { name: "工事・完工" })).toHaveCount(0);
    // 施工コスト(fee)の編集トリガー（工事・完工を編集）も embedded ビューには無い。
    await expect(panel.getByRole("button", { name: ct.editTrigger })).toHaveCount(0);
    // 施工コスト MetaItem ラベルも embedded ビューには出ない（施工コストカードは
    // 施工状況タブのみ。基本情報タブにはカード見出しの施工コストも出ない）。
    await expect(panel.getByRole("heading", { name: ct.costTitle })).toHaveCount(0);

    // 一方、契約予定情報の案件固有セクションは従来通り表示される（工事・完工 を除く）。
    // 概況は現状情報側へ移設されたため契約情報側の検証対象から外す。
    for (const label of ["契約・金額", "特記事項"]) {
      await expect(
        panel.getByText(label).first(),
        `案件情報セクション「${label}」は従来通り表示される`,
      ).toBeVisible();
    }
  });
});
