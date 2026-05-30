import { expect, test } from "@playwright/test";
import { signIn } from "../fixtures/auth";

// E2E spec for T-02-11 — wholesaler dashboard skeleton (S-018).
//
// 卸業者ダッシュボードの 4 セクション骨組み (docs/04 §1.3 S-018) が表示
// されることを確認する。具体的な集計値は SP-03 / SP-04 / SP-06 で接続するため
// 本テストでは「カード見出し 4 件 + ページ見出しが描画される」ことのみを検証。

test.describe.configure({ timeout: 90_000 });

// Seed は `tests/e2e/global-setup.ts` で 1 回だけ実行される。

test("wholesaler_admin sees the 4 placeholder cards on the dashboard", async ({ page }) => {
  await signIn(page, "wholesaler_admin@solar-saas.dev");

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "ダッシュボード", level: 1 })).toBeVisible();

  // 4 セクションのカードが全て描画されている。
  await expect(page.getByRole("heading", { name: "未読通知", level: 3 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "二次店希望提出状況", level: 3 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "マエカク未対応", level: 3 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "当月成績サマリ", level: 3 })).toBeVisible();

  // 各セクションの遷移リンクが描画されている。
  await expect(page.getByRole("link", { name: "通知一覧を開く" })).toBeVisible();
  await expect(page.getByRole("link", { name: "イベント体制決定画面を開く" })).toBeVisible();
  await expect(page.getByRole("link", { name: "マエカク一覧を開く" })).toBeVisible();
  await expect(page.getByRole("link", { name: "月次レポートを開く" })).toBeVisible();
});
