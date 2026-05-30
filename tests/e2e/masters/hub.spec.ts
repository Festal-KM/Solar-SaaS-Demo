import { expect, test } from "@playwright/test";
import { signIn } from "../fixtures/auth";

// E2E spec for T-02-10 — masters hub (S-052).
//
// 5-tab 構成: 二次店関係 / 施工業者 / インセンティブ率 / キャンセル期限 /
// 年度開始月 (docs/04 §1.3 S-052). wholesaler_admin がハブを開き、各タブを
// クリックして対応するパネル内容が切り替わることを確認する。タブ切替は
// shadcn Tabs (Radix) なので独立 URL への遷移は発生しない（同じ /masters
// 配下で `role=tabpanel` の data-state が切り替わる）。
//
// Seed は `tests/e2e/global-setup.ts` で全 spec 起動前に 1 回だけ実行される。

test.describe.configure({ timeout: 90_000 });

test("wholesaler_admin sees the 5 tabs and can switch panels on the masters hub", async ({
  page,
}) => {
  await signIn(page, "wholesaler_admin@solar-saas.dev");

  await page.goto("/masters");
  await expect(page.getByRole("heading", { name: "マスタ管理", level: 1 })).toBeVisible();

  // 5 タブのトリガーが全て描画されている (role=tab).
  const tabTriggers = [
    "二次店関係",
    "施工業者",
    "インセンティブ率",
    "キャンセル期限",
    "年度開始月",
  ];
  for (const label of tabTriggers) {
    await expect(page.getByRole("tab", { name: label })).toBeVisible();
  }

  // デフォルトで「二次店関係」タブのパネルが表示されている（プレースホルダ）。
  await expect(page.getByRole("heading", { name: "二次店関係", level: 2 })).toBeVisible();
  await expect(page.getByText("二次店関係マスタは後続スプリントで実装予定です")).toBeVisible();

  // 施工業者タブへ切替。
  await page.getByRole("tab", { name: "施工業者" }).click();
  await expect(page.getByRole("heading", { name: "施工業者", level: 2 })).toBeVisible();
  await expect(page.getByRole("link", { name: "一覧画面を開く" }).first()).toBeVisible();

  // インセンティブ率タブへ切替。
  await page.getByRole("tab", { name: "インセンティブ率" }).click();
  await expect(page.getByRole("heading", { name: "インセンティブ率", level: 2 })).toBeVisible();

  // キャンセル期限タブへ切替 — 単項目フォームが見える。
  await page.getByRole("tab", { name: "キャンセル期限" }).click();
  await expect(page.getByRole("heading", { name: "キャンセル期限", level: 2 })).toBeVisible();
  // 「キャンセル期限（日数）」はフォーム input 1 個に固有のラベル。タブトリガー
  // 「キャンセル期限」と曖昧にならないよう完全一致は避け substring で取る。
  await expect(page.getByLabel("キャンセル期限（日数）", { exact: false })).toBeVisible();

  // 年度開始月タブへ切替 — 月セレクタが見える。
  // 「年度開始月」というアクセシビリティ名はタブトリガー (role=tab)、
  // タブパネル内見出し (h2)、フォーム select の <label> の 3 箇所で衝突する。
  // フォーム select のみを掴むには role=combobox にスコープを絞る。
  await page.getByRole("tab", { name: "年度開始月" }).click();
  await expect(page.getByRole("heading", { name: "年度開始月", level: 2 })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "年度開始月" })).toBeVisible();
});
