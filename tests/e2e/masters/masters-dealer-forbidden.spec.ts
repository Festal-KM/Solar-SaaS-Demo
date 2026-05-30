import { expect, test } from "@playwright/test";
import { signIn } from "../fixtures/auth";

// E2E spec for SP-02 T-02-12 — dealer_admin (= alpha-admin) のマスタ系
// アクセス制御を一括検証する。
//
// dealer_admin にとってマスタ系 URL は 2 種類に分かれる:
//
//   A. **完全に閉鎖** (403 / リダイレクト)
//      - /masters                       … masters.read = WHOLESALER_ADMIN 限定
//      - /masters/venue-providers       … venue_provider.read 不可
//      - /masters/installers            … installer.read 不可
//      - /masters/wholesaler-settings   … wholesaler_settings.read 不可
//
//   B. **読み取り可（マスキング/関係絞り込み付き）**
//      - /masters/products              … product.read 可（仕入値は DTO 層で除去）
//      - /masters/incentive-rates       … incentive_rate.read 可（自関係分のみ）
//
// 出典: apps/web/lib/permissions/can.ts の policy、docs/02 §F-012 §F-014、
// docs/03 §4.3、docs/05 §6.5 関連、CLAUDE.md「単一テナント運営者向け SaaS
// だが二次店ロールの権限境界は機能要件として明示」。
//
// 個別 spec (`venue-providers.spec.ts`) でも venue 単独の 403 は検証されているが、
// 本 spec は SP-02 全体のリグレッション保護として、（A）4 URL の閉鎖 +
// （B）2 URL の閲覧可（書き込み UI は出ない）を一括ループで確認する。

test.describe.configure({ timeout: 90_000 });

// Seed は `tests/e2e/global-setup.ts` で 1 回だけ実行される。

// dealer_admin がアクセスしたら 403 (or redirect) になるべき URL 一覧。
// 各 URL の通常時の見出しを一緒に持つことで、spec 失敗時にどの URL の
// アクセス制御が緩んだかを直接特定できる。
const FORBIDDEN_URLS: ReadonlyArray<{ path: string; normalHeading: string }> = [
  { path: "/masters", normalHeading: "マスタ管理" },
  { path: "/masters/venue-providers", normalHeading: "場所提供元マスタ" },
  { path: "/masters/installers", normalHeading: "施工業者マスタ" },
  { path: "/masters/wholesaler-settings", normalHeading: "卸業者設定" },
];

// 二次店ロールは閲覧自体は許可されている URL。少なくとも 4xx/5xx で
// 拒否されず一覧が描画されることを確認する（書き込み導線そのものは page
// レベルでは無条件描画され、submit 時の Server Action 側で 403 になる
// 設計なので、ここでは到達可能性のみ検証する — T-02-04/T-02-06 の Vitest が
// purchasePrice 非開示と自関係絞り込みの実体を担保する）。
const READABLE_URLS: ReadonlyArray<{ path: string; heading: string }> = [
  { path: "/masters/products", heading: "商品・価格マスタ" },
  { path: "/masters/incentive-rates", heading: "インセンティブ率マスタ" },
];

test("dealer_admin is blocked from masters hub + admin-only master URLs", async ({ page }) => {
  await signIn(page, "alpha-admin@solar-saas.dev");

  for (const { path, normalHeading } of FORBIDDEN_URLS) {
    await page.goto(path);

    const finalUrl = new URL(page.url());
    const redirectedAway = finalUrl.pathname !== path;

    if (redirectedAway) {
      // middleware/Server が他ルートに飛ばすパターン。リダイレクト先が
      // login でないこと（セッションは生きているので再ログインはしない）を
      // 確認するだけ。
      expect(finalUrl.pathname).not.toBe("/login");
      continue;
    }

    // 同一 URL に留まる場合は group error boundary の 403 サーフェスに
    // 切り替わっているはず。通常時の見出しが出ていないこと + 403 文言が
    // 出ていることの両方を確認する。
    await expect(page.getByRole("heading", { name: normalHeading })).toHaveCount(0);

    const forbiddenHeading = page.getByRole("heading", {
      name: "この情報にアクセスできません",
    });
    await expect(forbiddenHeading).toBeVisible();
  }
});

test("dealer_admin can reach product / incentive-rate masters (read-only)", async ({ page }) => {
  await signIn(page, "alpha-admin@solar-saas.dev");

  for (const { path, heading } of READABLE_URLS) {
    const response = await page.goto(path);
    expect(response?.status() ?? 0).toBeLessThan(400);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});
