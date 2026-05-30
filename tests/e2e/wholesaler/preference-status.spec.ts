import { expect, test } from "@playwright/test";
import { signIn } from "../fixtures/auth";

// E2E spec for T-03-07 — wholesaler-side dealer-preference status screen
// (S-025 / S-026 / F-022 / docs/04 §1.3 / docs/05 §4.5).
//
// 検証内容:
//   1. wholesaler_admin で `/event-candidates/[id]/preferences` にアクセスし、
//      「二次店別」「店舗別」の 2 タブが描画される。
//   2. 公開対象が無い場合は「公開対象の二次店がありません…」の空状態文言が
//      描画される（seed 単独では visibility 0 件のため）。
//
// 前提: seed に EventCandidate は無いため、テスト先頭で `/event-candidates/new`
// 経由で 1 件登録してから対象 ID を URL からキャプチャする。

test.describe.configure({ timeout: 120_000 });

test("wholesaler_admin can open the preference-status page with both tabs visible (empty state)", async ({
  page,
}) => {
  await signIn(page, "wholesaler_admin@solar-saas.dev");

  // --- Step 1: 新規イベント候補を 1 件作成して ID を取得 ---
  await page.goto("/event-candidates/new");
  await expect(page.getByRole("heading", { name: "イベント候補を新規登録" })).toBeVisible();

  await page.getByLabel("店舗名", { exact: false }).fill("E2E テスト店舗 T-03-07");
  await page.getByLabel("対象年月", { exact: false }).fill("2026-12");
  // <input type="date">
  await page.locator("input[type=date]").first().fill("2026-12-15");
  // <input type="datetime-local"> for deadlineAt
  await page.locator("input[type=datetime-local]").first().fill("2026-12-01T10:00");

  await page.getByRole("button", { name: "登録", exact: false }).click();

  // 詳細画面へ遷移する。URL は `/event-candidates/<id>` 形式。
  await page.waitForURL(/\/event-candidates\/[A-Za-z0-9_-]+(?:\?.*)?$/, { timeout: 60_000 });
  const match = page.url().match(/\/event-candidates\/([A-Za-z0-9_-]+)/);
  expect(match, `failed to capture candidate id from URL ${page.url()}`).not.toBeNull();
  const candidateId = match![1]!;

  // --- Step 2: /preferences に遷移してタブ + 空状態を確認 ---
  await page.goto(`/event-candidates/${candidateId}/preferences`);

  // 画面見出し。
  await expect(page.getByRole("heading", { name: "二次店希望状況", level: 1 })).toBeVisible();

  // 2 タブが両方描画されている。
  await expect(page.getByRole("tab", { name: "二次店別" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "店舗別" })).toBeVisible();

  // 既定タブは「二次店別」。visibility 0 件のため空状態の文言が出る。
  await expect(page.getByText("公開対象の二次店がありません", { exact: false })).toBeVisible();

  // 「店舗別」タブに切替えて表ヘッダが出ることを確認。
  await page.getByRole("tab", { name: "店舗別" }).click();
  await expect(page.getByText("E2E テスト店舗 T-03-07")).toBeVisible();
});
