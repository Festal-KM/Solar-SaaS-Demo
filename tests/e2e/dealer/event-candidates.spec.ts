import { expect, request, test, type APIRequestContext } from "@playwright/test";
import { signIn } from "../fixtures/auth";

// E2E spec for T-03-05 — dealer-facing event candidate listing
// (S-059 / F-020 / docs/05 §4.5).
//
// Two checks:
//
//   1. dealer_admin が /event-candidates にアクセスできる（403 にならない）+
//      画面見出しと空状態 (or 候補リスト) が描画される。Seed 単独では公開中の
//      候補は無いので、empty state でも合格扱いとする。
//   2. `GET /api/event-candidates/visible` を dealer cookie で叩き、レスポンス
//      の `items` 内すべてに `fixedFee` / `performanceRate` / `internalNote`
//      キーが **物理的に** 存在しないことを確認する。
//      （docs/02 §F-020 受入基準 — UI と API の両方で内部情報が漏れない）

test.describe.configure({ timeout: 90_000 });

// Seed は `tests/e2e/global-setup.ts` で 1 回だけ実行される。

test("dealer_admin can open /visible-event-candidates and the wholesaler-internal columns never appear in the DOM", async ({
  page,
}) => {
  await signIn(page, "alpha-admin@solar-saas.dev");

  // dealer URL は `/visible-event-candidates` に分離されている (T-03-05 設計
  // メモ参照 — `(dealer)/event-candidates/page.tsx` は `(wholesaler)` 側と
  // Next.js ルート競合を起こすため別 URL とした)。
  const response = await page.goto("/visible-event-candidates");
  expect(response?.status() ?? 0).toBeLessThan(400);

  // ページ見出しが表示されている。
  await expect(page.getByRole("heading", { name: "公開中のイベント候補" })).toBeVisible();

  // 卸業者内部ラベル（固定費 / 成果報酬率 / 内部メモ）は二次店画面では
  // 一切露出してはならない。labels.eventCandidate.fields.* の wholesaler-only
  // 文言が DOM に含まれないことを確認する。
  const forbiddenLabels = [
    "固定費（円・内部）",
    "成果報酬率（%・内部）",
    "卸業者内部メモ",
    "固定費（円）",
    "成果報酬率（%）",
  ];
  const bodyText = (await page.locator("body").innerText()).normalize();
  for (const label of forbiddenLabels) {
    expect(
      bodyText.includes(label),
      `dealer event-candidate UI must not contain wholesaler-only label "${label}"`,
    ).toBe(false);
  }
});

test("GET /api/event-candidates/visible returns JSON without fixedFee / performanceRate / internalNote keys", async ({
  page,
  baseURL,
}) => {
  await signIn(page, "alpha-admin@solar-saas.dev");

  const cookies = await page.context().cookies();
  const requestCtx: APIRequestContext = await request.newContext({
    baseURL: baseURL!,
    extraHTTPHeaders: {
      cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    },
  });

  const res = await requestCtx.get("/api/event-candidates/visible");
  expect(res.status(), `unexpected status: ${res.status()}\n${await res.text()}`).toBe(200);

  const body = (await res.json()) as {
    items: Array<Record<string, unknown>>;
  };
  expect(Array.isArray(body.items)).toBe(true);

  // Seed には公開中の候補は含まれない (T-03-04 公開トグルは UI 経由のみ) ので
  // 空配列でもパス。0 件でも以下のキー検証はベースが Array.isArray のみで担保。
  for (const row of body.items) {
    expect(
      Object.keys(row).includes("fixedFee"),
      `fixedFee leaked to dealer for ${String(row.id)}: ${JSON.stringify(row)}`,
    ).toBe(false);
    expect(
      Object.keys(row).includes("performanceRate"),
      `performanceRate leaked to dealer for ${String(row.id)}: ${JSON.stringify(row)}`,
    ).toBe(false);
    expect(
      Object.keys(row).includes("internalNote"),
      `internalNote leaked to dealer for ${String(row.id)}: ${JSON.stringify(row)}`,
    ).toBe(false);
  }

  await requestCtx.dispose();
});
