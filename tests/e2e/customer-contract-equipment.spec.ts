import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

// 顧客詳細「契約状況」タブ 設備（PV/BT/付帯）追加・編集 + 1顧客1契約・契約自動作成
// (F-031 / F-062 / docs/02 顧客詳細・契約予定情報ユースケース)。
//
// 今回の変更点（検証対象）:
//   1. 契約状況タブ(value="contract") の「契約予定情報（案件詳細）」内 ProjectContractList で、
//      PV/BT/付帯(EQ=エコキュート等) の設備カードを 追加(+)・編集(鉛筆) できる。
//      - PV カード: メーカー/型番/容量/枚数 + 総合保証(warrantyStandard)/延長保証(warrantyExtended)
//      - BT カード: メーカー/型番/容量 + 自然災害保証(warrantyDisaster)/延長保証(warrantyExtended)
//      - 付帯(EQ) カード: 該当項目（型番/導入状況/延長保証）。
//      EditEquipmentDialog（保証はプルダウン 未設定/有/無）で保存→反映。
//   2. 契約 0 件の顧客（佐藤 一馬）でも、設備追加 or 契約金額入力を保存すると
//      デモ用の最小 Deal+Contract が自動作成され、設備/金額が紐づいて表示される。
//      1顧客1契約 — 再保存しても契約は増殖しない（契約ブロック / 設備カードが重複しない）。
//   3. 自動作成後、損益計算タブに当該契約の損益行は生成されない（GrossProfit 非生成）。
//   4. 基本情報タブ「契約予定情報」は読み取り専用（設備の追加(+)/編集(鉛筆)トリガー非描画）。
//
// 認証は demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, 2FA off, seed 投入済）。
// seed（global-setup が 1 回実行）は契約あり顧客に PV/BT/EQ(エコキュート) の
// ContractEquipment を冪等投入する。佐藤 一馬 は契約 0 件（提案中・withPreCall:false）。
//
// 行は role="button" + aria-label="<マスク名>様"。契約なし顧客はマスク名に依存できないため
// 一覧の検索（DB の raw name に contains マッチ）で「佐藤 一馬」を引き当てて行クリックする。
// Seed は tests/e2e/global-setup.ts で全 spec 起動前に 1 回だけ実行される。
// workers:1 + fullyParallel:false（playwright.config.ts）に追従。

const DEMO_EMAIL = "demo@solar-saas.demo";
const DEMO_PASSWORD = "Demo1234!";

// ラベル（labels.customer.detail.projectInfo.equipment / edit）に対応。
const E = {
  pvCard: "PV（太陽光）",
  btCard: "BT（蓄電池）",
  eqCard: "EQ（エコキュート）",
  accessoryCard: "付帯商材",
  maker: "メーカー",
  modelNo: "型番",
  capacity: "容量",
  panelCount: "枚数",
  totalWarranty: "総合保証・発電量保証",
  extWarranty: "延長保証",
  disasterWarranty: "自然災害保証（有償）",
  addEquipment: "設備を追加",
  editEquipment: "設備明細を編集",
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

// 契約あり顧客（PV/BT/EQ 設備保有）を 1 件開く。
async function openContractedCustomer(page: Page): Promise<void> {
  await page.goto("/customers?contractStatus=contracted");
  const firstRow = page.getByRole("button", { name: /様$/ }).first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
}

// 契約 0 件の顧客「佐藤 一馬」を検索で引き当てて開く。検索は DB の raw name に
// contains マッチする。検索適用前の先頭行（別顧客）を誤クリックしないよう、検索クエリの
// URL 反映を待ってから、マスク名が「佐藤様」の行（姓マスキング）を明示的にクリックする。
async function openNoContractCustomer(page: Page): Promise<void> {
  await page.goto("/customers");
  const search = page.getByRole("searchbox").first();
  await expect(search).toBeVisible();
  await search.fill("佐藤 一馬");
  await page.getByRole("button", { name: "検索" }).click();
  // 検索が URL クエリに反映され、フィルタ後の一覧が描画されるのを待つ。
  await page.waitForURL(/[?&]query=/, { timeout: 30_000 });
  const row = page.getByRole("button", { name: "佐藤様" });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
}

async function openContractTab(page: Page) {
  await page.getByRole("tab", { name: "契約状況" }).click();
  const panel = page.getByRole("tabpanel");
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("契約状況タブ 設備（PV/BT/付帯）追加・編集 + 1顧客1契約・契約自動作成", () => {
  // dev サーバの cold-compile を吸収するため 30s 既定を 120s に拡張。
  test.describe.configure({ timeout: 150_000 });

  // 契約自動作成テストが佐藤 一馬に残すデモ Deal+Contract を削除して「契約 0 件」へ戻す。
  // 未契約顧客の空状態を前提とする他 spec への汚染と再実行時のフレークを防ぐ
  // （CLAUDE.md ハードルール: テスト前後に対象テナントの業務テーブルを truncate）。
  test.afterAll(() => {
    // tsx は @solar/db ワークスペースの devDependency（ルートには無い）。@solar/db の
    // ディレクトリを cwd にして tsx を解決し、クリーンアップスクリプトは絶対パスで渡す。
    // 顧客名はスクリプト既定（佐藤 一馬）に委ねる。shell:true 下で空白入り引数が
    // 分割される問題を避けるため、引数では渡さない。
    const script = resolve(__dirname, "fixtures", "cleanup-demo-contract.ts");
    const dbDir = resolve(__dirname, "..", "..", "packages", "db");
    execFileSync("pnpm", ["exec", "tsx", script], {
      cwd: dbDir,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  });

  test("契約あり顧客: PV/BT/付帯の設備カードが項目・保証付きで表示され、PVを編集→保存→反映される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);
    const panel = await openContractTab(page);

    // 設備明細セクション + PV/BT/EQ カードが描画される（seed は PV/BT/EQ を投入）。
    await expect(panel.getByRole("heading", { name: "設備明細" }).first()).toBeVisible();
    await expect(panel.getByText(E.pvCard).first()).toBeVisible();
    await expect(panel.getByText(E.btCard).first()).toBeVisible();
    await expect(panel.getByText(E.eqCard).first()).toBeVisible();

    // PV カードはメーカー/型番/容量/枚数 + 総合保証/延長保証 のラベルを持つ。
    for (const label of [E.maker, E.modelNo, E.capacity, E.panelCount, E.totalWarranty, E.extWarranty]) {
      await expect(
        panel.locator("dt", { hasText: label }).first(),
        `PV項目ラベル「${label}」`,
      ).toBeVisible();
    }
    // BT カードは 自然災害保証/延長保証 ラベルを持つ。
    await expect(panel.locator("dt", { hasText: E.disasterWarranty }).first()).toBeVisible();

    // PV 設備を編集（鉛筆）→ メーカーを一意な値に書き換え + 総合保証を「有」に設定 → 保存。
    await panel
      .getByRole("button", { name: `${E.pvCard} ${E.editEquipment}` })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const makerStamp = `PV製造E2E${Date.now() % 100000}`;
    await dialog.locator("#eq-maker").fill(makerStamp);
    await dialog.locator("#eq-wstd").selectOption("true"); // 総合保証=有
    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // 再描画後、PV カードに新しいメーカー値が反映される。
    await expect(panel.getByText(makerStamp)).toBeVisible({ timeout: 30_000 });
  });

  test("契約あり顧客: 空カテゴリ（付帯商材）に追加(+)→入力→保存→カードに反映される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);
    const panel = await openContractTab(page);

    // 付帯商材カード。seed では未投入の空カテゴリだが、過去の実行で 1 行追加済みなら
    // 「設備明細を編集」(鉛筆) になっている場合があるため、追加(+)/編集(鉛筆)どちらでも開く。
    const addBtn = panel.getByRole("button", { name: `${E.accessoryCard} ${E.addEquipment}` });
    const editBtn = panel.getByRole("button", { name: `${E.accessoryCard} ${E.editEquipment}` });
    const trigger = (await addBtn.count()) > 0 ? addBtn.first() : editBtn.first();
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // 既存契約があるため契約金額入力欄(#eq-contract-amount)は出ない。
    await expect(dialog.locator("#eq-contract-amount")).toHaveCount(0);

    const detailStamp = `付帯E2E${Date.now() % 100000}`;
    await dialog.locator("#eq-detail").fill(detailStamp);
    await dialog.locator("#eq-qty").fill("3");
    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // 追加後、付帯商材カードに入力した契約詳細が反映される。
    await expect(panel.getByText(detailStamp)).toBeVisible({ timeout: 30_000 });
  });

  test("契約なし顧客（佐藤 一馬）: 設備追加+契約金額入力で契約が自動作成され、再保存しても契約が二重作成されない", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openNoContractCustomer(page);
    const customerUrl = page.url();
    const panel = await openContractTab(page);

    // 契約自動作成は DB へ永続化されるため、過去の実行で既に契約済みになっている場合がある
    // （seed は当該デモ契約を削除しない）。初回（クリーン）と再実行（既契約）の両方で
    // 「1顧客1契約・契約自動作成・二重作成なし」を検証できるよう、開始状態で分岐する。
    const addHint = panel.getByText("＋から設備を追加すると契約が作成されます");
    const startedClean = (await addHint.count()) > 0;

    const amount = 4321000;
    const makerStamp = `自動契約PV${Date.now() % 100000}`;

    if (startedClean) {
      // ── クリーン開始: 契約 0 件 → 設備追加 + 契約金額入力で契約が自動作成される ──
      // 契約別ブロック見出し「契約・金額 #1」はまだ無い（契約 0 件）。
      await expect(panel.getByRole("heading", { name: /契約・金額 #1/ })).toHaveCount(0);

      // PV 設備を追加（+）。契約 0 件なので契約金額入力欄が出る。
      await panel.getByRole("button", { name: `${E.pvCard} ${E.addEquipment}` }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(
        dialog.locator("#eq-contract-amount"),
        "契約 0 件では契約金額入力が出る",
      ).toBeVisible();
      await dialog.locator("#eq-contract-amount").fill(String(amount));
      await dialog.locator("#eq-maker").fill(makerStamp);
      await dialog.getByRole("button", { name: "保存" }).click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });

      // 契約が自動作成され、契約別ブロック「契約・金額 #1」+ PV メーカー + 金額が描画される。
      await expect(panel.getByRole("heading", { name: /契約・金額 #1/ })).toBeVisible({
        timeout: 30_000,
      });
      await expect(panel.getByText(makerStamp)).toBeVisible({ timeout: 30_000 });
      await expect(panel.getByText(`¥${amount.toLocaleString("ja-JP")}`).first()).toBeVisible();
      // 設備追加導線のヒントは消えている（契約が出来たため）。
      await expect(addHint).toHaveCount(0);
    } else {
      // ── 再実行（既に契約自動作成済み）: 契約は既に 1 件 ──
      await expect(panel.getByRole("heading", { name: /契約・金額 #1/ })).toHaveCount(1);
    }

    // ── 1顧客1契約: さらに設備を保存しても契約は増えない（既存契約に紐づくだけ） ──
    // PV カードは既に契約済み設備があるため「設備明細を編集」(鉛筆)。一意な値で更新する。
    const reMakerStamp = `再保存PV${Date.now() % 100000}`;
    await panel.getByRole("button", { name: `${E.pvCard} ${E.editEquipment}` }).first().click();
    const dialog2 = page.getByRole("dialog");
    await expect(dialog2).toBeVisible();
    // 既存契約があるので契約金額入力欄はもう出ない。
    await expect(dialog2.locator("#eq-contract-amount")).toHaveCount(0);
    await dialog2.locator("#eq-maker").fill(reMakerStamp);
    await dialog2.getByRole("button", { name: "保存" }).click();
    await expect(dialog2).toBeHidden({ timeout: 30_000 });
    await expect(panel.getByText(reMakerStamp)).toBeVisible({ timeout: 30_000 });

    // 契約ブロックは依然 1 件のみ（#2 が生成されていない = 二重作成なし）。
    await expect(panel.getByRole("heading", { name: /契約・金額 #1/ })).toHaveCount(1);
    await expect(panel.getByRole("heading", { name: /契約・金額 #2/ })).toHaveCount(0);

    // フルリロード後も契約は 1 件（#1 のみ）で重複しない。
    await page.goto(customerUrl);
    const panel2 = await openContractTab(page);
    await expect(panel2.getByRole("heading", { name: /契約・金額 #1/ })).toHaveCount(1);
    await expect(panel2.getByRole("heading", { name: /契約・金額 #2/ })).toHaveCount(0);

    // 自動作成された契約は saveProjectContractEquipmentAction では GrossProfit を生成しない。
    // 本セッション内でクリーンに自動作成した契約は、再 seed されていないため GrossProfit を
    // 持たず、損益計算タブが空状態になる。
    // 注: 再実行時は当該デモ契約が前回実行から永続化しており、global-setup の db:seed が
    // 全契約に GrossProfit を冪等バックフィルするため損益行が付く。これは seed のバック
    // フィル仕様であってアクションの生成ではないため、クリーン開始時のみ非生成を厳密検証する。
    if (startedClean) {
      await page.getByRole("tab", { name: "損益計算" }).click();
      const profitPanel = page.getByRole("tabpanel");
      await expect(profitPanel).toBeVisible();
      await expect(
        profitPanel.getByText("損益を計算できる契約がありません。"),
        "アクションが自動作成した契約は GrossProfit を生成しない（損益タブが空）",
      ).toBeVisible();
    }
  });

  test("基本情報タブ『契約予定情報』: 設備が読み取り専用で表示され、設備の追加(+)/編集(鉛筆)トリガーが描画されない", async ({
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
    await expect(panel.getByText(E.pvCard).first()).toBeVisible();

    // 設備の追加(+)/編集(鉛筆)トリガーが一切描画されない（編集面は契約状況タブに集約）。
    await expect(
      panel.getByRole("button", { name: new RegExp(E.editEquipment) }),
      "基本情報タブに設備編集トリガーが出ないこと",
    ).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: new RegExp(E.addEquipment) }),
      "基本情報タブに設備追加トリガーが出ないこと",
    ).toHaveCount(0);
  });
});
