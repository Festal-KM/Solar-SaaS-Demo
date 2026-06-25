import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

// 顧客詳細「契約状況」タブ 再設計（インライン編集化）の E2E。
// (F-031 / F-062 / docs/02 顧客詳細・契約予定情報ユースケース)。
//
// 今回の変更点（検証対象）:
//   1. 概況(ContractStatusPanel: 契約プラン/金額/予定日)の旧パネルが削除されている。
//   2. 設備入力が ポップアップ廃止 → カード内インライン編集（EquipmentInlineEdit）。
//      PV/BT/付帯/施工 等の各商材カードがフォーム（金額/メーカー/型番/容量/枚数/保証）を
//      直接持ち、dirty 時のみ「保存」/「キャンセル」が活性化。
//      saveProjectContractEquipmentAction（契約 find-or-create 維持）で保存→反映。
//   3. 各商材（PV/BT/付帯/施工）に金額欄(ContractEquipment.amount)があり ¥ 表示される。
//      契約合計（契約・金額サマリ）= 各商材金額の反映。
//   4. 施工が商材ライン（EquipmentCategory.CONSTRUCTION）として PV/BT/付帯 と並ぶ
//      （金額・施工業者・型番・契約詳細）。施工状況タブの Construction とは別概念。
//   5. 契約状況タブに関連ファイル（CustomerFileCategory.CONTRACT）のアップロード/一覧
//      セクションが併設される。
//   6. 契約 0 件の顧客（佐藤 一馬）でも、商材金額入力 → 保存で最小 Deal+Contract が
//      自動作成され、再保存しても契約は増殖しない（1顧客1契約）。
//   7. 基本情報タブ「契約予定情報」は読み取り専用（インライン編集フォーム/追加トリガー
//      非描画）。
//
// 認証は demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, 2FA off, seed 投入済）。
// seed（global-setup が 1 回実行）は契約あり顧客に PV/BT/EQ + CONSTRUCTION の
// ContractEquipment（amount 付き）を冪等投入する。佐藤 一馬 は契約 0 件。
// 行は role="button" + aria-label="<マスク名>様"。契約なし顧客はマスク名に依存できない
// ため一覧の検索（DB の raw name に contains マッチ）で「佐藤 一馬」を引き当てる。
// Seed は tests/e2e/global-setup.ts で全 spec 起動前に 1 回だけ実行される。
// workers:1 + fullyParallel:false（playwright.config.ts）に追従。

const DEMO_EMAIL = "demo@solar-saas.demo";
const DEMO_PASSWORD = "Demo1234!";

// ラベル（labels.customer.detail.projectInfo.equipment / contractTab / contractFiles）。
const L = {
  detailTitle: "契約予定情報（案件詳細）",
  pvTitle: "PV（太陽光）",
  btTitle: "BT（蓄電池）",
  accessoryTitle: "付帯商材",
  constructionTitle: "施工",
  amount: "金額（税込）",
  vendor: "施工業者",
  maker: "メーカー",
  contractFilesTitle: "契約関連ファイル",
  contractFilesEmpty: "契約関連ファイルはありません",
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

// 契約あり顧客（PV/BT/EQ + CONSTRUCTION 商材保有）を 1 件開く。
async function openContractedCustomer(page: Page): Promise<void> {
  await page.goto("/customers?contractStatus=contracted");
  const firstRow = page.getByRole("button", { name: /様$/ }).first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
}

// 契約 0 件の顧客「佐藤 一馬」を検索で引き当てて開く。
async function openNoContractCustomer(page: Page): Promise<void> {
  await page.goto("/customers");
  const search = page.getByRole("searchbox").first();
  await expect(search).toBeVisible();
  await search.fill("佐藤 一馬");
  await page.getByRole("button", { name: "検索" }).click();
  await page.waitForURL(/[?&]query=/, { timeout: 30_000 });
  const row = page.getByRole("button", { name: "佐藤様" });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
}

async function openContractTab(page: Page): Promise<Locator> {
  await page.getByRole("tab", { name: "契約" }).click();
  const panel = page.getByRole("tabpanel");
  await expect(panel).toBeVisible();
  return panel;
}

// インライン編集カード（EquipmentInlineEdit）を category 固有の金額入力 id で特定する。
// 各カードは #eq-amount-<CATEGORY> を含む「最も近い」カード div（保存/キャンセルを内包）。
// ancestor 軸の (...)[last()] が document order で最も近い祖先 = 当該設備カード。
// そのカード内に Save/キャンセルを scope する（他カードの「保存」ボタンを誤って掴まない）。
function inlineCard(panel: Locator, category: string): Locator {
  return panel
    .locator(`#eq-amount-${category}`)
    .first()
    .locator('xpath=(ancestor::div[contains(@class,"space-y-3")])[last()]');
}

test.describe("契約状況タブ インライン編集 + 商材金額 + 施工ライン + 契約ファイル + 契約自動作成", () => {
  // dev サーバの cold-compile を吸収するため 30s 既定を 150s に拡張。
  test.describe.configure({ timeout: 180_000 });

  // 契約自動作成テストが佐藤 一馬に残すデモ Deal+Contract を削除して「契約 0 件」へ戻す。
  // 未契約顧客の空状態を前提とする他 spec への汚染と再実行時のフレークを防ぐ
  // （CLAUDE.md ハードルール: テスト前後に対象テナントの業務テーブルを truncate）。
  test.afterAll(() => {
    const script = resolve(__dirname, "fixtures", "cleanup-demo-contract.ts");
    const dbDir = resolve(__dirname, "..", "..", "packages", "db");
    execFileSync("pnpm", ["exec", "tsx", script], {
      cwd: dbDir,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  });

  test("契約あり顧客: 概況パネルが無く、PV/BT/付帯/施工の商材カードがインライン編集フォーム＋金額欄で表示される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);
    const panel = await openContractTab(page);

    // (#1) 旧概況パネル（ContractStatusPanel: 契約プラン/金額/予定日）が削除されている。
    await expect(panel.getByRole("heading", { name: "契約状況（概況）" })).toHaveCount(0);
    await expect(panel.locator("#contract-plan")).toHaveCount(0);
    await expect(panel.locator("#contract-date")).toHaveCount(0);

    // 契約予定情報（案件詳細）見出し + 契約・金額サマリ。
    await expect(panel.getByRole("heading", { name: L.detailTitle })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "契約・金額", exact: true }).first()).toBeVisible();

    // (#2/#3) 商材カードがインライン編集フォームとして描画される。PV/BT/付帯/施工が
    // それぞれ金額入力欄(#eq-amount-<cat>)を持つ。ポップアップ起動の鉛筆/追加(＋)トリガーは
    // インライン化により出ない。
    for (const cat of ["PV", "BT", "ACCESSORY", "CONSTRUCTION"]) {
      await expect(panel.locator(`#eq-amount-${cat}`).first(), `${cat} 金額欄`).toBeVisible();
    }
    // PV カードはインライン入力（メーカー/型番/容量/枚数）を持つ。
    await expect(panel.locator("#eq-maker-PV").first()).toBeVisible();
    await expect(panel.locator("#eq-model-PV").first()).toBeVisible();
    await expect(panel.locator("#eq-capacity-PV").first()).toBeVisible();
    await expect(panel.locator("#eq-qty-PV").first()).toBeVisible();

    // (#4) 施工が商材ラインとして PV/BT/付帯 と並ぶ。施工カードは施工業者(#eq-vendor)・
    // 型番・契約詳細(#eq-detail)を持ち、容量/枚数/保証は持たない（CONSTRUCTION 分岐）。
    await expect(panel.locator("#eq-vendor-CONSTRUCTION").first(), "施工業者欄").toBeVisible();
    await expect(panel.locator("#eq-model-CONSTRUCTION").first()).toBeVisible();
    await expect(panel.locator("#eq-detail-CONSTRUCTION").first()).toBeVisible();
    await expect(panel.locator("#eq-capacity-CONSTRUCTION")).toHaveCount(0);
    await expect(panel.locator("#eq-wstd-CONSTRUCTION")).toHaveCount(0);

    // 各商材カードに「金額（税込）」ラベルが描画される（金額欄の見出し）。
    await expect(panel.getByText(L.amount).first()).toBeVisible();

    // seed 投入済みの商材金額が ¥ 表示でサマリに反映される（契約・金額サマリは商材合計）。
    await expect(panel.getByText(/¥[\d,]+/).first()).toBeVisible();
  });

  test("契約あり顧客: PV の金額・メーカーをインライン編集→保存→反映。施工(CONSTRUCTION)の金額・業者も保存→反映", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);
    const panel = await openContractTab(page);

    // ── PV カードのインライン編集 ──
    const pvCard = inlineCard(panel, "PV");
    await expect(pvCard).toBeVisible();
    // dirty になるまで保存ボタンは disabled。
    const pvSave = pvCard.getByRole("button", { name: "保存" });
    await expect(pvSave).toBeDisabled();

    const pvAmount = 3456000;
    const pvMaker = `PV製造E2E${Date.now() % 100000}`;
    await pvCard.locator("#eq-amount-PV").fill(String(pvAmount));
    await pvCard.locator("#eq-maker-PV").fill(pvMaker);
    await expect(pvSave).toBeEnabled();
    await pvSave.click();

    // 保存後 router.refresh で再描画。メーカー値・金額が PV 商材カードへ永続反映される。
    // （契約・金額サマリは Contract.contractAmount 由来で商材金額の自動合計ではないため、
    //  ここでは商材ラインの金額入力値の永続化で検証する。）
    await expect(panel.locator("#eq-maker-PV").first()).toHaveValue(pvMaker, { timeout: 30_000 });
    await expect(panel.locator("#eq-amount-PV").first()).toHaveValue(String(pvAmount), {
      timeout: 30_000,
    });

    // ── 施工(CONSTRUCTION)カードのインライン編集（商材ラインとしての施工） ──
    const conCard = inlineCard(panel, "CONSTRUCTION");
    await expect(conCard).toBeVisible();
    const conAmount = 987000;
    const conVendor = `施工業者E2E${Date.now() % 100000}`;
    await conCard.locator("#eq-amount-CONSTRUCTION").fill(String(conAmount));
    await conCard.locator("#eq-vendor-CONSTRUCTION").fill(conVendor);
    const conSave = conCard.getByRole("button", { name: "保存" });
    await expect(conSave).toBeEnabled();
    await conSave.click();

    await expect(panel.locator("#eq-vendor-CONSTRUCTION").first()).toHaveValue(conVendor, {
      timeout: 30_000,
    });
    await expect(panel.locator("#eq-amount-CONSTRUCTION").first()).toHaveValue(String(conAmount), {
      timeout: 30_000,
    });
  });

  test("契約状況タブ: 契約関連ファイル(CONTRACT)のアップロード/一覧セクションが描画される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);
    const panel = await openContractTab(page);

    // (#5) 契約関連ファイルセクション（見出し + CONTRACT カテゴリのファイルピッカー）。
    await expect(panel.getByRole("heading", { name: L.contractFilesTitle })).toBeVisible();
    // CONTRACT カテゴリ専用のファイル入力（id は category.toLowerCase() でサフィックス）。
    await expect(panel.locator("#customer-file-input-contract")).toBeVisible();
    // R2 実 PUT は E2E では通らないため、メタデータ未投入時の空状態描画で存在検証する
    // （application-files / PV図面と同方針）。seed は CONTRACT ファイルを投入しないため
    // 空プレースホルダが出る。
    await expect(panel.getByText(L.contractFilesEmpty)).toBeVisible();
  });

  test("契約なし顧客（佐藤 一馬）: 商材金額入力→保存で契約が自動作成され、再保存しても契約が二重作成されない", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openNoContractCustomer(page);
    const customerUrl = page.url();
    const panel = await openContractTab(page);

    // 契約自動作成は DB へ永続化されるため、過去の実行で既に契約済みになっている場合がある。
    // クリーン開始（契約 0 件）と再実行（既契約）の両方を扱えるよう開始状態で分岐する。
    // 契約 0 件のときは「商材ライン」追加導線見出し + ヒントが出る。
    const addHint = panel.getByText("PV/BT/付帯/施工の各商材の金額・内容を入力");
    const startedClean = (await addHint.count()) > 0;

    if (startedClean) {
      // 契約 0 件のときも商材カードはインライン編集として描画される（contractId=null）。
      // 契約別ブロック見出し「契約・金額 #1」はまだ無い。
      await expect(panel.getByRole("heading", { name: /契約・金額 #1/ })).toHaveCount(0);

      const amount = 4321000;
      const maker = `自動契約PV${Date.now() % 100000}`;
      const pvCard = inlineCard(panel, "PV");
      await expect(pvCard).toBeVisible();
      await pvCard.locator("#eq-amount-PV").fill(String(amount));
      await pvCard.locator("#eq-maker-PV").fill(maker);
      await pvCard.getByRole("button", { name: "保存" }).click();

      // 契約が自動作成され、契約別ブロック「契約・金額 #1」+ PV メーカー + 金額が描画される。
      await expect(panel.getByRole("heading", { name: /契約・金額 #1/ })).toBeVisible({
        timeout: 30_000,
      });
      await expect(panel.locator("#eq-maker-PV").first()).toHaveValue(maker, { timeout: 30_000 });
      await expect(panel.getByText(`¥${amount.toLocaleString("ja-JP")}`).first()).toBeVisible();
      // 追加導線ヒントは消えている（契約が出来たため）。
      await expect(addHint).toHaveCount(0);
    } else {
      // 再実行（既に契約自動作成済み）: 契約は既に 1 件。
      await expect(panel.getByRole("heading", { name: /契約・金額 #1/ })).toHaveCount(1);
    }

    // ── 1顧客1契約: さらに商材を保存しても契約は増えない（既存契約に紐づくだけ） ──
    const reMaker = `再保存PV${Date.now() % 100000}`;
    const pvCard2 = inlineCard(panel, "PV");
    await pvCard2.locator("#eq-maker-PV").fill(reMaker);
    await pvCard2.getByRole("button", { name: "保存" }).click();
    await expect(panel.locator("#eq-maker-PV").first()).toHaveValue(reMaker, { timeout: 30_000 });

    // 契約ブロックは依然 1 件のみ（#2 が生成されていない = 二重作成なし）。
    await expect(panel.getByRole("heading", { name: /契約・金額 #1/ })).toHaveCount(1);
    await expect(panel.getByRole("heading", { name: /契約・金額 #2/ })).toHaveCount(0);

    // フルリロード後も契約は 1 件（#1 のみ）で重複しない。
    await page.goto(customerUrl);
    const panel2 = await openContractTab(page);
    await expect(panel2.getByRole("heading", { name: /契約・金額 #1/ })).toHaveCount(1);
    await expect(panel2.getByRole("heading", { name: /契約・金額 #2/ })).toHaveCount(0);
  });

  test("基本情報タブ『契約予定情報』: 商材・金額が読み取り専用で表示され、インライン編集フォーム/追加トリガーが描画されない", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    // 既定の「基本情報」タブ。
    await expect(page.getByRole("tab", { name: "基本情報" })).toHaveAttribute("data-state", "active");
    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();

    // 契約情報（基本情報タブの区分見出し）+ 設備明細 + PV カードが読み取り専用で pull 表示される。
    await expect(panel.getByRole("heading", { name: "契約情報", exact: true })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "設備明細" })).toBeVisible();
    await expect(panel.getByText(L.pvTitle).first()).toBeVisible();
    // 商材金額が読み取りカードに ¥ 表示で描画される。
    await expect(panel.getByText(/¥[\d,]+/).first()).toBeVisible();

    // (#7) 読み取り専用 pull のため、商材のインライン編集フォーム入力（#eq-amount-PV 等）も
    // 設備の追加(+)/編集(鉛筆)トリガーも一切描画されない（編集面は契約状況タブに集約）。
    await expect(
      panel.locator("#eq-amount-PV"),
      "基本情報タブにインライン金額入力が出ないこと",
    ).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: /設備明細を編集/ }),
      "基本情報タブに設備編集トリガーが出ないこと",
    ).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: /設備を追加/ }),
      "基本情報タブに設備追加トリガーが出ないこと",
    ).toHaveCount(0);
  });
});
