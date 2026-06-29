import { expect, test, type Page } from "@playwright/test";

// F-061 顧客詳細「案件情報」統合ビュー (UC-06 / docs/05 §16).
//
// 案件情報は独立タブを廃し「基本情報」タブ内に統合表示する。上段の編集カード
// （担当者 / 顧客基本情報 / メモ）と重複する 基本情報・体制・備考 セクションは
// embedded で抑制し、案件固有（契約・金額 / 契約明細 / 工事・完工 / 特記事項 /
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

// 「基本情報」タブの「契約情報」区分に pull 表示される契約予定情報の案件固有カテゴリ見出し。
// embedded で 基本情報・体制・備考 は抑制され、「工事・完工」「ローン」「コール状況」は
// 各専用タブへ集約、「概況」は現状情報側へ移設されたため embedded（契約情報）には出ない。
// 残る契約予定情報のカテゴリのみを検証する。
const PROJECT_INFO_SECTION_HEADINGS = ["契約・金額", "特記事項"];

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

    // 基本情報タブ再設計: 案件情報 embedded は「契約予定情報」区分見出しの下に統合され、
    // 旧「案件情報」見出しは「契約予定情報」へ改称された。
    await expect(panel.getByRole("heading", { name: "契約情報", exact: true })).toBeVisible();

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

    // 契約 0 件で安定している「佐藤 一馬」を一覧検索で確実に引き当てる。商談中フィルタの
    // 先頭行はマスク名が重複する別顧客（契約あり）に当たり得るため使わない。
    await page.goto("/customers");
    const search = page.getByRole("searchbox").first();
    await expect(search).toBeVisible();
    await search.fill("佐藤 一馬");
    await page.getByRole("button", { name: "検索" }).click();
    // 検索が URL クエリに反映されてから、マスク名「佐藤様」の行を明示クリックする
    // （検索適用前の先頭行＝別顧客の誤クリックを防ぐ）。
    await page.waitForURL(/[?&]query=/, { timeout: 30_000 });
    const firstRow = page.getByRole("button", { name: "佐藤様" });
    await expect(firstRow).toBeVisible({ timeout: 30_000 });
    await firstRow.click();

    await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });

    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // クラッシュせず「契約情報」区分見出しが出る（再設計で改称）。
    await expect(panel.getByRole("heading", { name: "契約情報", exact: true })).toBeVisible();

    // 基本情報タブの契約情報は読み取り専用 pull（contractReadOnly）。契約 0 件では
    // 設備追加導線（＋）ではなくプレースホルダ「契約情報がありません」が描画される
    // （追加・編集の導線は契約状況タブに集約されているため）。
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
    // 再設計で「既存設備」カード（現状情報側）と embedded「既設設備（現況）」の
    // 両方に同カテゴリが描画されるため .first() で先頭に限定する。
    await expect(panel.getByText(h.catGas, { exact: true }).first()).toBeVisible();
    await expect(panel.getByText(h.catEq, { exact: true }).first()).toBeVisible();
    await expect(panel.getByText(h.catPv, { exact: true }).first()).toBeVisible();
    // 有無バッジ（あり/なし/不明 のいずれか）が既設カードに描画される。
    await expect(
      panel.getByText(/^(あり|なし|不明)$/).first(),
      "既設設備の有無バッジが描画される",
    ).toBeVisible();

    // 家族属性 / 連絡先 は基本情報タブでは権限保持者向けインライン編集フォーム
    // （HearingInlineEdit）として描画される（再設計）。表示用 dt/dd ではなく、ラベル付き
    // 入力欄（#hr-husband / #hr-landline 等）で確認する。年齢は number 入力（生値）。
    await expect(panel.getByRole("heading", { name: h.familyTitle })).toBeVisible();
    await expect(panel.locator("#hr-husband")).toBeVisible();
    await expect(panel.locator("#hr-wife")).toBeVisible();
    await expect(panel.locator("#hr-child")).toBeVisible();

    // 連絡先: 固定/携帯電話の入力欄。マエカク希望日時は基本情報ページでは非表示。
    // 再設計でヒアリングはインライン編集化され、連絡先見出しは "連絡先" (h4) になった。
    await expect(panel.getByRole("heading", { name: "連絡先", exact: true })).toBeVisible();
    await expect(panel.locator("#hr-landline")).toBeVisible();
    await expect(panel.locator("#hr-mobile")).toBeVisible();
    // マエカク希望日時は基本情報ページに表示されない（連絡先ブロックから撤去済み）。
    await expect(panel.locator("dt", { hasText: h.maekakuPreferredAt })).toHaveCount(0);
    await expect(panel.getByLabel(h.maekakuPreferredAt)).toHaveCount(0);

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

    // 契約 0 件の顧客（権限保持者）では、契約予定情報 pull に「契約情報がありません」
    // ではなく設備追加導線（＋ヒント）が出る（編集権限保持者の場合）。プレースホルダ判定は
    // 行わず、ヒアリングセクションがクラッシュせず描画されることを検証する。
    await expect(panel.getByRole("heading", { name: "契約情報", exact: true })).toBeVisible();

    // ヒアリング親見出し + F-063 サブ見出し群がクラッシュせず描画される。
    await expect(panel.getByRole("heading", { name: h.title })).toBeVisible();
    await expect(panel.getByRole("heading", { name: h.existingTitle })).toBeVisible();
    await expect(panel.getByRole("heading", { name: h.familyTitle })).toBeVisible();
    // 再設計でヒアリングはインライン編集化され、連絡先見出しは "連絡先" (h4) になった。
    await expect(panel.getByRole("heading", { name: "連絡先", exact: true })).toBeVisible();

    // 家族年齢・連絡先のインライン入力欄が（未設定含め）クラッシュせず描画される。
    await expect(panel.locator("#hr-husband")).toBeVisible();
    await expect(panel.locator("#hr-landline")).toBeVisible();
    // マエカク希望日時は基本情報ページに表示されない。
    await expect(panel.locator("dt", { hasText: h.maekakuPreferredAt })).toHaveCount(0);
  });
});

// コールタブ（マエカク/サンキュー/ローン審査完了/施工完了 の 4 セクション・全インライン編集）.
//
// コール状況は再設計で旧「コール状況」単一セクション + EditCallStatusDialog
// （`コール状況を編集` / `#cl-post-status` / `#cl-general`）を廃し、専用「コール」タブの
// 4 セクション・カード内インライン編集へ移行した。その表面検証（4 見出し・過去コール履歴・
// インライン保存と永続化・マエカク希望日時の同一列共用）は専用 spec
// tests/e2e/customer-call-tab.spec.ts（5/5 PASS）が網羅するため、本ファイルからは
// 旧ダイアログ依存の describe を撤去した。
//
// 「マエカク希望日時が基本情報タブに出ない」リグレッションは F-063 ヒアリングの
// 上記 2 test（line 248 / 293, dt/getByLabel "マエカク希望日時" toHaveCount(0)）で
// 引き続き担保される。
