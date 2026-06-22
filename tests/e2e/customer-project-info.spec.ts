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
// embedded で 基本情報・体制・備考 は抑制され、さらに「工事・完工」(施工コスト含む) は
// 専用「施工状況」タブへ集約されたため embedded では出ない。残る案件固有のみを検証する。
const PROJECT_INFO_SECTION_HEADINGS = ["契約・金額", "認定・設備", "概況"];

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

// F-063 アポ取り顧客の住環境・家族属性ヒアリング管理 (docs/02 F-063 / docs/05 §17).
//
// 「基本情報」タブ内に統合された案件情報 (CustomerProjectInfo embedded) のうち、
// F-063 が追加した HearingSection を検証する。HearingSection は次の小見出しで構成:
//   - ヒアリング（住環境・家族）= h.title（セクションの親見出し）
//   - 既設設備（現況）= h.existingTitle（契約設備とは別カテゴリ）
//       カテゴリ: ガス給湯器 / エコキュート（EQ）/ 太陽光（既設） + 有無バッジ あり/なし/不明
//   - 家族属性 = h.familyTitle（ご主人年齢/奥様年齢/お子様年齢 = 年代マスキング表示）
//   - 連絡先 = h.contactTitle（固定電話/携帯電話 下4桁マスキング）。
//     マエカク希望日時は基本情報ページからは非表示（要件改修）。
//   - クロスセル候補 = p.crossSellTitle（既設に有 → 蓄電池提案 等のバッジ）
//
// マスキング: demo 卸業者は WholesalerSettings 既定(MASKED)→ WHOLESALER テナントで
// PARTIAL に緩和されるため、家族年齢は「N0代」(decade) / 電話は「***-****-XXXX」で表示。
// FULL 設定（"45歳" / 生番号）にも耐えるよう、年齢は /\d+代|\d+歳|未設定/、
// 電話は「下4桁が原番号と一致 or マスク記号を含む」緩いパターンで検証する。
//
// seed の seedCustomerHearing が全顧客に既設設備3カテゴリ + 家族年齢 + 分離電話 +
// マエカク希望日時を冪等投入するため、契約済み / 未契約いずれの顧客でも Hearing
// セクションが描画される。エッジは「未契約(契約データ無し)顧客でも Hearing が
// クラッシュせず描画される」で担保する。

const h = {
  title: "ヒアリング（住環境・家族）",
  existingTitle: "既設設備（現況）",
  familyTitle: "家族属性",
  contactTitle: "連絡先・希望日時",
  husbandAge: "ご主人年齢",
  wifeAge: "奥様年齢",
  childAge: "お子様年齢",
  landlinePhone: "固定電話",
  mobilePhone: "携帯電話",
  maekakuPreferredAt: "マエカク希望日時",
  // 既設設備カテゴリ見出し（categoryLabels）。
  catGas: "ガス給湯器",
  catEq: "エコキュート（EQ）",
  catPv: "太陽光（既設）",
  crossSellTitle: "クロスセル候補",
} as const;

// 年代マスキング(PARTIAL)/FULL/未設定 のいずれかに一致。
const AGE_PATTERN = /(\d+代|\d+歳|未設定)/;
// 連絡先: マスク記号入り(***-****-XXXX) または 下4桁を含む生番号 or 未設定。
const PHONE_PATTERN = /(\*{3}-\*{4}-\d{2,4}|\d{2,4}-\d{2,4}-\d{4}|未設定)/;

// 1 つの「ラベル → 値」(MetaItem) について、ラベルに隣接する dd 値テキストを取得。
// MetaItem は <dt>label</dt><dd>value</dd> 構造（同じ親 div 内）。
async function metaValue(panelLocator: ReturnType<Page["getByRole"]>, label: string): Promise<string> {
  const dt = panelLocator.locator("dt", { hasText: label }).first();
  await expect(dt, `MetaItem ラベル「${label}」が存在する`).toBeVisible();
  const dd = dt.locator("xpath=following-sibling::dd[1]");
  return ((await dd.textContent()) ?? "").trim();
}

test.describe("F-063 住環境・家族属性ヒアリング管理（基本情報タブ統合ビュー）", () => {
  test.describe.configure({ timeout: 120_000 });

  test("契約済み顧客: 既設設備（現況）+ 家族属性（年代表示）+ 連絡先（マスク）+ マエカク希望日時 + クロスセルバッジが描画される", async ({
    page,
  }) => {
    await signInAsDemo(page);

    await page.goto("/customers?contractStatus=contracted");
    const firstRow = page.getByRole("button", { name: /様$/ }).first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();
    await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });

    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // ヒアリング親見出し + 既設設備（現況）見出し（契約設備=設備明細 とは別見出し）。
    await expect(panel.getByRole("heading", { name: h.title })).toBeVisible();
    await expect(panel.getByRole("heading", { name: h.existingTitle })).toBeVisible();
    // 既設設備（現況）は「設備明細」(契約後設備) とは別カテゴリで併存している。
    await expect(panel.getByRole("heading", { name: "設備明細" })).toBeVisible();

    // 既設設備の3カテゴリ見出し（ガス給湯器 / エコキュート（EQ）/ 太陽光（既設））。
    await expect(panel.getByText(h.catGas, { exact: true })).toBeVisible();
    await expect(panel.getByText(h.catEq, { exact: true })).toBeVisible();
    await expect(panel.getByText(h.catPv, { exact: true })).toBeVisible();
    // 有無バッジ（あり/なし/不明 のいずれか）が既設カードに描画される。
    await expect(
      panel.getByText(/^(あり|なし|不明)$/).first(),
      "既設設備の有無バッジが描画される",
    ).toBeVisible();

    // 家族属性: ご主人年齢/奥様年齢/お子様年齢 が「年代マスキング」表示で描画される。
    await expect(panel.getByRole("heading", { name: h.familyTitle })).toBeVisible();
    const husband = await metaValue(panel, h.husbandAge);
    const wife = await metaValue(panel, h.wifeAge);
    const child = await metaValue(panel, h.childAge);
    expect(husband, `ご主人年齢「${husband}」が年代/年齢/未設定`).toMatch(AGE_PATTERN);
    expect(wife, `奥様年齢「${wife}」が年代/年齢/未設定`).toMatch(AGE_PATTERN);
    expect(child, `お子様年齢「${child}」が年代/年齢/未設定`).toMatch(AGE_PATTERN);

    // 連絡先: 固定/携帯電話（下4桁マスキング）。マエカク希望日時は基本情報ページでは非表示。
    await expect(panel.getByRole("heading", { name: h.contactTitle })).toBeVisible();
    const landline = await metaValue(panel, h.landlinePhone);
    const mobile = await metaValue(panel, h.mobilePhone);
    expect(landline, `固定電話「${landline}」がマスク/番号/未設定`).toMatch(PHONE_PATTERN);
    expect(mobile, `携帯電話「${mobile}」がマスク/番号/未設定`).toMatch(PHONE_PATTERN);
    // マエカク希望日時は基本情報ページに表示されない（連絡先ブロックから撤去済み）。
    await expect(panel.locator("dt", { hasText: h.maekakuPreferredAt })).toHaveCount(0);

    // クロスセル候補: 既設に「有」があれば判定材料バッジ（蓄電池提案 等）が表示される。
    // seed は全顧客に YES を含む既設設備を投入するため、本ラベルは描画されるはず。
    await expect(
      panel.getByText(h.crossSellTitle, { exact: false }).first(),
      "クロスセル候補ラベル",
    ).toBeVisible();
    await expect(
      panel.getByText(/(蓄電池提案|エコキュート提案|太陽光増設提案)/).first(),
      "クロスセル候補バッジ",
    ).toBeVisible();
  });

  test("未契約顧客: 契約データが無くてもヒアリング（既設設備・家族属性・連絡先）がクラッシュせず描画される", async ({
    page,
  }) => {
    await signInAsDemo(page);

    await page.goto("/customers?contractStatus=negotiating");
    const firstRow = page.getByRole("button", { name: /様$/ }).first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();
    await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });

    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // 契約が無いプレースホルダが出ていても Hearing セクションは独立して描画される。
    await expect(panel.getByText("契約情報がありません")).toBeVisible();

    // ヒアリング親見出し + F-063 サブ見出し群がクラッシュせず描画される。
    await expect(panel.getByRole("heading", { name: h.title })).toBeVisible();
    await expect(panel.getByRole("heading", { name: h.existingTitle })).toBeVisible();
    await expect(panel.getByRole("heading", { name: h.familyTitle })).toBeVisible();
    await expect(panel.getByRole("heading", { name: h.contactTitle })).toBeVisible();

    // 家族年齢・連絡先の各 MetaItem が（未設定含め）描画される。
    const husband = await metaValue(panel, h.husbandAge);
    const landline = await metaValue(panel, h.landlinePhone);
    expect(husband, `ご主人年齢「${husband}」`).toMatch(AGE_PATTERN);
    expect(landline, `固定電話「${landline}」`).toMatch(PHONE_PATTERN);
    // マエカク希望日時は基本情報ページに表示されない。
    await expect(panel.locator("dt", { hasText: h.maekakuPreferredAt })).toHaveCount(0);
  });
});

// バッチ B コール状況（案件情報「コール状況」セクション）.
//
// 「基本情報」タブ内の案件情報ビュー (CustomerProjectInfo embedded) に新設した
// 「コール状況」セクション（Section/MetaItem）を検証する。構成:
//   - 親見出し = sections.calls = "コール状況"
//   - 表示: マエカクステータス / マエカク希望電話 / 完工コールステータス + 希望日時 /
//     ローン完了コールステータス + 希望日時 / 汎用コール希望時間帯
//   - 編集: 鉛筆 → Dialog → 完工コールステータス・希望日時・汎用時間帯等を保存 → 反映
//
// マエカク希望「日時」(maekakuPreferredAt) は基本情報ページに表示されない（リグレッション）。
// seed の seedCustomerHearing が全顧客にコール状況を冪等投入する。

const cl = {
  title: "コール状況",
  maekakuStatus: "マエカクステータス",
  maekakuPreferredPhone: "マエカク希望電話",
  postStatus: "完工コールステータス",
  postAt: "完工コール希望日時",
  loanStatus: "ローン完了コールステータス",
  loanAt: "ローン完了コール希望日時",
  generalTime: "汎用コール希望時間帯",
  editTrigger: "コール状況を編集",
} as const;

test.describe("バッチ B コール状況（専用コール状況タブ）", () => {
  test.describe.configure({ timeout: 120_000 });

  test("コール状況セクションが表示され、編集ダイアログで保存→反映される", async ({ page }) => {
    await signInAsDemo(page);

    await page.goto("/customers?contractStatus=contracted");
    const firstRow = page.getByRole("button", { name: /様$/ }).first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();
    await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });

    // コール状況は基本情報タブの案件情報埋め込みビューから専用「コール状況」タブへ
    // 集約済み。当該タブへ切り替えてから検証する。
    await page.getByRole("tab", { name: "コール状況" }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // 親見出し + 主要ラベルが描画される。
    await expect(panel.getByRole("heading", { name: cl.title }).first()).toBeVisible();
    await expect(panel.locator("dt", { hasText: cl.maekakuStatus }).first()).toBeVisible();
    await expect(panel.locator("dt", { hasText: cl.postStatus }).first()).toBeVisible();
    await expect(panel.locator("dt", { hasText: cl.loanStatus }).first()).toBeVisible();
    await expect(panel.locator("dt", { hasText: cl.generalTime }).first()).toBeVisible();
    // 完工コールステータスは CALL_STATUS_VALUES ラベル（実施前/実施済/不要）のいずれか。
    const postValue = await metaValue(panel, cl.postStatus);
    expect(postValue, `完工コールステータス「${postValue}」`).toMatch(/(実施前|実施済|不要|未設定)/);

    // マエカク希望「日時」(datetime) は基本情報ページに表示されない（リグレッション）。
    await expect(page.locator("dt", { hasText: "マエカク希望日時" })).toHaveCount(0);

    // 編集ダイアログを開いて保存。
    await panel.getByRole("button", { name: cl.editTrigger }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // 汎用コール希望時間帯を一意な値に書き換える。
    const stamp = `E2E希望${Date.now() % 100000}`;
    const generalInput = dialog.locator("#cl-general");
    await generalInput.fill(stamp);
    // 完工コールステータスを「実施済」に設定。
    await dialog.locator("#cl-post-status").selectOption("done");

    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // 保存後、汎用コール希望時間帯に新しい値が反映される。
    await expect(panel.getByText(stamp)).toBeVisible({ timeout: 30_000 });
    const postAfter = await metaValue(panel, cl.postStatus);
    expect(postAfter, `保存後の完工コールステータス「${postAfter}」`).toBe("実施済");
  });
});
