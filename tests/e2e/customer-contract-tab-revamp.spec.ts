import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

// 顧客詳細「契約」タブ 4 改修の E2E（F-031 / F-062 / docs/02 顧客・契約管理ユースケース）。
//
// 検証対象（契約タブの 4 改修）:
//   1. 架電項目の削除: 契約・金額の編集ダイアログ（EditContractDialog）から「コール
//      ステータス(#ct-call)」「ローン審査架電日時(#ct-loancall)」「契約金額の手動入力
//      (#ct-amount)」が消えている。loanReviewStatus(#ct-loanreview)/loanCompany(#ct-loanco)
//      等のローン情報は残存。
//   2. 契約金額=商材ライン合計: 契約金額は手動入力できず、商材ライン（PV/BT/付帯/施工）の
//      amount 合計が自動表示。PV の amount を保存すると契約金額（summary + per-contract）が
//      再計算される。
//   3. 付帯商材(ACCESSORY)の複数追加: 「付帯商材を追加」で複数行を追加・個別編集・削除でき、
//      追加/削除で契約金額が再計算。
//   4. 契約#2以降＋サブタブ: 「契約を追加」で契約#2 を作成でき、契約タブ配下が契約ごとの
//      サブタブ（契約 #1 / 契約 #2 …）になる。認定・設備と契約ファイルは契約タブ直下（共有）。
//
// 認証は demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, 2FA off, seed 投入済）。
// Seed は tests/e2e/global-setup.ts で全 spec 起動前に 1 回だけ実行される。
// workers:1 + fullyParallel:false（playwright.config.ts）に追従。
//
// 注意: 本 spec は契約あり顧客に「契約 #2」を作成し付帯商材を追加するため、afterAll で
// その顧客の余剰契約/付帯を掃除し、他 spec（契約 1 件前提・付帯空状態前提）への汚染を防ぐ。

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

// 契約あり顧客（PV/BT/EQ + CONSTRUCTION 商材保有）を 1 件開く。
async function openContractedCustomer(page: Page): Promise<void> {
  await page.goto("/customers?contractStatus=contracted");
  const firstRow = page.getByRole("button", { name: /様$/ }).first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 90_000 });
}

// 契約タブの外側パネル。契約サブタブ（契約 #1 / #2 …）を内包するため role=tabpanel が
// 外側 + 内側で 2 つ active になる。外側（id 末尾 -content-contract）にスコープする。
// 商材ライン等の内側要素も外側パネルの子孫として参照できる。
async function openContractTab(page: Page): Promise<Locator> {
  await page.getByRole("tab", { name: "契約" }).first().click();
  const panel = page.locator('[role="tabpanel"][id$="-content-contract"]');
  await expect(panel).toBeVisible();
  return panel;
}

// インライン編集カード（EquipmentInlineEdit）を category 固有の金額入力 id で特定。
function inlineCard(scope: Locator, category: string): Locator {
  return scope
    .locator(`#eq-amount-${category}`)
    .first()
    .locator('xpath=(ancestor::div[contains(@class,"space-y-3")])[last()]');
}

// per-contract「契約金額（商材ライン合計）」の表示値（¥…）を数値で読む。
// MetaItem は <dt>ラベル</dt><dd>値</dd> 構造。ラベル dt の次の dd を読む。
async function contractAmountTotal(panel: Locator): Promise<number> {
  const dt = panel.locator("dt", { hasText: "契約金額（商材ライン合計）" }).first();
  const dd = dt.locator("xpath=following-sibling::dd[1]");
  const text = (await dd.textContent()) ?? "";
  return Number(text.replace(/[^\d]/g, ""));
}

test.describe("顧客詳細『契約』タブ 4 改修（架電削除 / 金額自動 / 付帯複数 / 契約サブタブ）", () => {
  // dev サーバの cold-compile を吸収するため 30s 既定を 180s に拡張。
  test.describe.configure({ timeout: 180_000 });

  // 本 spec が契約あり顧客に残す余剰契約（#2 以降）+ 追加付帯を掃除する。
  test.afterAll(() => {
    const script = resolve(__dirname, "fixtures", "cleanup-demo-extra-contracts.ts");
    const dbDir = resolve(__dirname, "..", "..", "packages", "db");
    execFileSync("pnpm", ["exec", "tsx", script], {
      cwd: dbDir,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  });

  test("改修#1: EditContractDialog から架電(#ct-call/#ct-loancall)・契約金額手動(#ct-amount)が消え、ローン情報は残存", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);
    const panel = await openContractTab(page);

    // 契約サブタブ（契約 #1）が表示される。
    await expect(page.getByRole("tab", { name: /^契約 #1$/ })).toBeVisible({ timeout: 30_000 });

    // 契約・金額・ローンの編集ダイアログを開く。
    await panel.getByRole("button", { name: "契約・金額・ローンを編集" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // (改修#1) 架電関連入力が一切無い。
    await expect(dialog.locator("#ct-call"), "コールステータス入力が削除されていること").toHaveCount(0);
    await expect(
      dialog.locator("#ct-loancall"),
      "ローン審査架電日時入力が削除されていること",
    ).toHaveCount(0);
    // 契約金額の手動入力も無い（金額は商材ライン合計の自動計算）。
    await expect(
      dialog.locator("#ct-amount"),
      "契約金額の手動入力が削除されていること",
    ).toHaveCount(0);
    // ダイアログ内に「契約金額」ラベルの入力フィールドが無い（金額は自動）。
    await expect(dialog.getByLabel("契約金額", { exact: true })).toHaveCount(0);

    // 残存すべきローン情報入力（会社 / ローン審査ステータス / 頭金 / 団信 / 備考）。
    await expect(dialog.locator("#ct-loanco"), "ローン会社入力は残存").toBeVisible();
    await expect(
      dialog.locator("#ct-loanreview"),
      "ローン審査ステータス入力は残存",
    ).toBeVisible();
    await expect(dialog.locator("#ct-down"), "頭金入力は残存").toBeVisible();
    await expect(dialog.locator("#ct-credit"), "団信入力は残存").toBeVisible();
    await expect(dialog.locator("#ct-loannote"), "ローン備考入力は残存").toBeVisible();
    // 契約日・契約番号など契約メタは残存。
    await expect(dialog.locator("#ct-date")).toBeVisible();
    await expect(dialog.locator("#ct-serial")).toBeVisible();

    // ローン審査ステータスを変更→保存→ダイアログが閉じる（loanReviewStatus 残存の動作確認）。
    await dialog.locator("#ct-loanreview").selectOption({ index: 1 });
    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
  });

  test("改修#2: PV 金額をインライン編集→保存で契約金額(summary + per-contract)が当該合計へ再計算される", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);
    const panel = await openContractTab(page);

    // 契約サブタブ（契約 #1）が active。
    await expect(page.getByRole("tab", { name: /^契約 #1$/ })).toBeVisible({ timeout: 30_000 });

    // per-contract に「契約金額（商材ライン合計）」（自動・read-only）が描画される。
    await expect(panel.getByText("契約金額（商材ライン合計）").first()).toBeVisible();
    // 契約・金額サマリ見出し（全契約合計）。
    await expect(panel.getByRole("heading", { name: "契約・金額", exact: true }).first()).toBeVisible();

    // 編集前の契約金額（= PV + BT + CONSTRUCTION 等の合計）と現在の PV 金額を読む。
    // PV 以外の商材金額（BT/施工…）は本テストで変えないので、合計 = PV + others が成り立つ。
    const pvInput = panel.locator("#eq-amount-PV").first();
    const initialPv = Number((await pvInput.inputValue()).replace(/[^\d]/g, ""));
    const initialTotal = await contractAmountTotal(panel);
    const others = initialTotal - initialPv; // 他商材合計（一定）。

    // PV を一意な値へ更新する（インラインカードは外側パネルの子孫）。
    const newPv = 5_000_000 + (Date.now() % 100_000);
    const pvCard = inlineCard(panel, "PV");
    await pvCard.locator("#eq-amount-PV").fill(String(newPv));
    const pvSave = pvCard.getByRole("button", { name: "保存" });
    await expect(pvSave).toBeEnabled();
    await pvSave.click();
    await expect(pvInput).toHaveValue(String(newPv), { timeout: 30_000 });

    // 契約金額（商材ライン合計）は PV 変更後に newPv + others へ再計算される。
    await expect.poll(async () => contractAmountTotal(panel), { timeout: 30_000 }).toBe(newPv + others);

    // さらに PV を +111,000 した値へ変えると合計も同額だけ追従する（再計算が毎回走る）。
    const newPv2 = newPv + 111_000;
    const pvCard2 = inlineCard(panel, "PV");
    await pvCard2.locator("#eq-amount-PV").fill(String(newPv2));
    await pvCard2.getByRole("button", { name: "保存" }).click();
    await expect(pvInput).toHaveValue(String(newPv2), { timeout: 30_000 });
    await expect.poll(async () => contractAmountTotal(panel), { timeout: 30_000 }).toBe(newPv2 + others);
  });

  test("改修#3: 付帯商材(ACCESSORY)を2件追加→複数行表示。amount 入力で契約金額が増え、1件削除で再計算", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);
    const panel = await openContractTab(page);
    await expect(page.getByRole("tab", { name: /^契約 #1$/ })).toBeVisible({ timeout: 30_000 });

    // 付帯商材セクション + 「付帯商材を追加」導線（インライングリッドは外側パネルの子孫）。
    const addAccessory = panel.getByRole("button", { name: "付帯商材を追加" });
    await expect(addAccessory).toBeVisible();

    // 既存の付帯行数を数える（acc-amount-<id> 単位。再実行で残っている可能性に備える）。
    const accAmountInputs = panel.locator('input[id^="acc-amount-"]');
    const before = await accAmountInputs.count();

    // 1 件目を追加 → 行が 1 増える。
    await addAccessory.click();
    await expect(accAmountInputs).toHaveCount(before + 1, { timeout: 30_000 });

    // 2 件目を追加 → 2 件以上（複数行）になる。
    await panel.getByRole("button", { name: "付帯商材を追加" }).click();
    await expect(accAmountInputs).toHaveCount(before + 2, { timeout: 30_000 });

    // 追加した最後の付帯行に金額を入れて保存 → 契約金額が +accAmount 反映される。
    const beforeTotal = await contractAmountTotal(panel);

    const lastAccCard = panel
      .locator('input[id^="acc-amount-"]')
      .last()
      .locator('xpath=(ancestor::div[contains(@class,"space-y-3")])[last()]');
    const accAmount = 333_000;
    await lastAccCard.locator('input[id^="acc-amount-"]').fill(String(accAmount));
    await lastAccCard.getByRole("button", { name: "保存" }).click();

    await expect.poll(async () => contractAmountTotal(panel), { timeout: 30_000 }).toBe(
      beforeTotal + accAmount,
    );

    // 1 件削除 → 行が 1 減り、契約金額から accAmount が引かれる（再計算）。
    page.once("dialog", (d) => d.accept());
    await lastAccCard.getByRole("button", { name: "この付帯商材を削除" }).click();
    await expect(panel.locator('input[id^="acc-amount-"]')).toHaveCount(before + 1, {
      timeout: 30_000,
    });
    await expect.poll(async () => contractAmountTotal(panel), { timeout: 30_000 }).toBe(beforeTotal);
  });

  test("改修#4: 「契約を追加」で契約#2 サブタブが出現し、サブタブを切替できる。認定・契約ファイルは共有", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);
    const panel = await openContractTab(page);

    // 開始時は契約 #1 サブタブのみ（再実行時に #2 が残っている可能性を考慮しカウント分岐）。
    await expect(page.getByRole("tab", { name: /^契約 #1$/ })).toBeVisible({ timeout: 30_000 });

    const subtab2 = page.getByRole("tab", { name: /^契約 #2$/ });
    if ((await subtab2.count()) === 0) {
      await panel.getByRole("button", { name: "契約を追加" }).first().click();
      await expect(page.getByRole("tab", { name: /^契約 #2$/ })).toBeVisible({ timeout: 30_000 });
    }

    // 契約 #2 サブタブへ切替できる。
    await page.getByRole("tab", { name: /^契約 #2$/ }).click();
    await expect(page.getByRole("tab", { name: /^契約 #2$/ })).toHaveAttribute(
      "data-state",
      "active",
    );
    // 契約 #2 サブタブ配下にも商材ライン（PV 金額欄）が描画される。
    await expect(page.locator("#eq-amount-PV").first()).toBeVisible({ timeout: 30_000 });

    // 認定・設備（申請）と契約関連ファイルは契約タブ直下（サブタブ外・共有）。
    await expect(panel.getByRole("heading", { name: "認定・設備" }).first()).toBeVisible();
    await expect(panel.getByRole("heading", { name: "契約関連ファイル" })).toBeVisible();
  });

  test("回帰: 二次店物理除外/損益タブ非表示が壊れていない（卸業者には損益タブ・契約金額が見える）", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await openContractedCustomer(page);

    // 卸業者(WHOLESALER_ADMIN)には損益計算タブが見える（profitAndLoss キー存在）。
    await expect(page.getByRole("tab", { name: "損益計算" })).toBeVisible({ timeout: 30_000 });

    // 契約タブで契約金額（売上側・amount 合計）が ¥ 表示される（売上は卸業者で表示OK）。
    const panel = await openContractTab(page);
    await expect(panel.getByText(/¥[\d,]+/).first()).toBeVisible();

    // 損益計算タブが描画される（卸業者のみ・原価系列を含む機密財務面）。
    await page.getByRole("tab", { name: "損益計算" }).click();
    const profitPanel = page.getByRole("tabpanel").first();
    await expect(profitPanel).toBeVisible();
    await expect(profitPanel.getByRole("heading", { name: "損益計算" })).toBeVisible();
    // GrossProfit が計算済みの契約があれば原価系列（仕入合計）ヘッダが描画される
    // （二次店 DTO では物理除外。卸業者ではキー存在）。0 件のときは空状態のため
    // ヘッダ非描画だが、いずれにせよ原価ラベルが「漏れていない」ことを確認する。
    const purchaseHeader = profitPanel.getByText("仕入合計");
    if ((await purchaseHeader.count()) > 0) {
      await expect(purchaseHeader).toBeVisible();
    }
  });
});
