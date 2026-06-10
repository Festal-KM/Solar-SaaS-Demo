import { expect, test, type Page } from "@playwright/test";

// F-060 二次店レーン希望（ボトムアップ構造）卸業者側一覧確認 (docs/02 §F-060 / docs/05 §3.4.5).
//
// 構造変更後の振る舞いを検証する。従来「既存レーンを優先順位付け」から、二次店が
// 希望レーン数を宣言し、レーンごとに「希望場所ラベル(venueLabel) + 週単位の希望開催日
// (desiredDates)」を提出する形へ移行した。卸業者側一覧 (/lane-preferences) が確認すべきもの:
//   - 二次店ごとのアコーディオン行（二次店名 + 提出日時 + 希望レーン数バッジ）。
//   - バッジ「希望レーン {n}件」= 明細件数。
//   - 展開時、希望順位カード（第一希望 / 第二希望…）が priority 昇順で並ぶ。
//   - 各カードに希望場所ラベル（例「カインズ 大宮店」「コメリ 大宮店」）が表示される。
//   - 各カードに週単位の希望開催日チップ（連続日が "M/D~D" の帯チップにグルーピング）。
//   - 全体の特記事項(note)が表示される。
//   - 二次店ロール (dealer_admin) は本一覧を閲覧不可（卸業者ロールのみ／URL 直叩きは 403）。
//
// 認証:
//   - 卸業者デモ: demo@solar-saas.demo / Demo1234!（WHOLESALER_ADMIN, 2FA off）
//   - 二次店: alpha-admin@solar-saas.dev / Pilot!2026（DEALER_ADMIN）
//
// Seed (tests/e2e/global-setup.ts → pnpm db:seed) は LANE_PREFERENCE_SEEDS を当月
// (lineMonth = 現在月) × 各 relationship で投入する。ページの既定対象月も当月なので、
// フィルタ未変更で seed 行が表示される。alpha 提出は明細 2 件（カインズ 大宮店 / コメリ
// 大宮店）、特記事項あり。
//
// 文言は labels.ts (lanePreference.*) の日本語に依存するため、ラベル文字列は実画面の
// 表示値（labels.ts の定義値）に合わせて記述する。workers:1 + fullyParallel:false に追従。

const DEMO_EMAIL = "demo@solar-saas.demo";
const DEMO_PASSWORD = "Demo1234!";

const DEALER_EMAIL = "alpha-admin@solar-saas.dev";
const PILOT_PASSWORD = "Pilot!2026";

// 当月を YYYY-MM で算出（page.tsx の currentMonth と同じく getFullYear/getMonth で TZ 安全に）。
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Auth.js credentials フローを任意パスワードで実行するローカルヘルパ
// （customer-project-info.spec.ts の signInAsDemo 作法を踏襲）。
async function signInWith(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: "サインイン" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 90_000 });
  await page.waitForLoadState("networkidle");
}

test.describe("F-060 二次店レーン希望 一覧確認（卸業者側）", () => {
  // dev サーバの cold-compile（/login → /lane-preferences）を吸収するため 30s 既定を拡張。
  test.describe.configure({ timeout: 120_000 });

  test("卸業者: 当月の希望提出がアコーディオン行 + 希望レーン数バッジ + 件数で描画される", async ({
    page,
  }) => {
    await signInWith(page, DEMO_EMAIL, DEMO_PASSWORD);

    await page.goto("/lane-preferences");

    // 画面見出し（labels.lanePreference.title）。title は h1（ページ見出し）と
    // h2（カードヘッダ）の双方に出るため h1 に限定する。
    await expect(page.getByRole("heading", { name: "二次店希望一覧", level: 1 })).toBeVisible();

    // 既定対象月は当月。月フィルタ <input type="month"> が当月で初期化されている。
    await expect(page.locator("input[type=month]")).toHaveValue(currentMonth());

    // seed 行（alpha / beta）がアコーディオン行として描画される。
    const alphaRow = page.getByRole("button", { name: /アルファ/ });
    await expect(alphaRow).toBeVisible();

    // 希望レーン数バッジ = 明細件数（alpha は 2 件）。labels: "希望レーン {n}件"。
    await expect(alphaRow.getByText("希望レーン 2件")).toBeVisible();

    // 提出日時ラベルがヘッダ行に出る。
    await expect(alphaRow.getByText("提出日時", { exact: false })).toBeVisible();
  });

  test("卸業者: アコーディオン展開で希望順位カード（priority 昇順）+ 希望場所ラベル + 帯チップ + 特記事項が表示される", async ({
    page,
  }) => {
    await signInWith(page, DEMO_EMAIL, DEMO_PASSWORD);

    await page.goto("/lane-preferences");

    const alphaButton = page.getByRole("button", { name: /アルファ/ });
    await expect(alphaButton).toBeVisible();

    // AccordionRow は <div>（button + 折りたたみパネル）。button の親 <div> に scope し、
    // alpha 行だけを検証対象にする（beta 行のカードも DOM 上は存在するため厳密スコープが必要）。
    const alphaRow = alphaButton.locator("xpath=..");

    // 展開前。各行のカード内容は描画済みだが grid-rows-[0fr] で折りたたまれている。
    await expect(alphaButton).toHaveAttribute("aria-expanded", "false");
    await alphaButton.click();
    await expect(alphaButton).toHaveAttribute("aria-expanded", "true");

    // 展開後、alpha 行内に希望順位カードが priority 昇順で並ぶ（第一希望 → 第二希望）。
    const firstPref = alphaRow.getByText("第一希望", { exact: true });
    const secondPref = alphaRow.getByText("第二希望", { exact: true });
    await expect(firstPref).toBeVisible();
    await expect(secondPref).toBeVisible();

    // priority 昇順 = レイアウト上で第一希望が第二希望より前（左/上）に並ぶ。
    const firstBox = await firstPref.boundingBox();
    const secondBox = await secondPref.boundingBox();
    expect(firstBox, "第一希望カードの bounding box").not.toBeNull();
    expect(secondBox, "第二希望カードの bounding box").not.toBeNull();
    expect(
      firstBox!.y < secondBox!.y || firstBox!.x <= secondBox!.x,
      "第一希望カードが第二希望カードより前（左/上）に並ぶ",
    ).toBeTruthy();

    // 各カードの希望場所ラベル（venueLabel が一次ソース）。alpha = カインズ / コメリ。
    await expect(alphaRow.getByText("カインズ 大宮店", { exact: true })).toBeVisible();
    await expect(alphaRow.getByText("コメリ 大宮店", { exact: true })).toBeVisible();

    // 「希望場所」ラベル（labels.lanePreference.card.venueLabel）がカード内に出る。
    await expect(alphaRow.getByText("希望場所", { exact: true }).first()).toBeVisible();

    // 週単位の希望開催日チップ（連続日が "M/D~D" の帯チップにグルーピングされる）。
    // alpha 第一希望 desiredDates = 当月の 7,8,14,15 日 → "M/7~8" と "M/14~15" の 2 帯。
    const month = new Date().getMonth() + 1;
    await expect(alphaRow.getByText(`${month}/7~8`, { exact: true })).toBeVisible();
    await expect(alphaRow.getByText(`${month}/14~15`, { exact: true })).toBeVisible();
    // 第二希望 desiredDates = 21,22 日 → "M/21~22"。
    await expect(alphaRow.getByText(`${month}/21~22`, { exact: true })).toBeVisible();

    // 帯内の日数表示（labels.lanePreference.card.dayCount = "{n}日"。2 日帯なので「2日」）。
    await expect(alphaRow.getByText("2日", { exact: true }).first()).toBeVisible();

    // 全体の特記事項(note)が表示される（labels.noteLabel + seed alpha の note）。
    await expect(alphaRow.getByText("特記事項", { exact: false }).first()).toBeVisible();
    await expect(
      alphaRow.getByText("土日を中心に2会場で展開希望。要員2名で対応可能です。", {
        exact: false,
      }),
    ).toBeVisible();
  });

  test("卸業者: 希望提出が無い対象月では空表示プレースホルダが描画される", async ({ page }) => {
    await signInWith(page, DEMO_EMAIL, DEMO_PASSWORD);

    // seed が無い過去月でフィルタ → 結果 0 件。
    await page.goto("/lane-preferences?month=2020-01");

    await expect(page.locator("input[type=month]")).toHaveValue("2020-01");

    // 空表示プレースホルダ（labels.lanePreference.empty）。
    await expect(page.getByText("該当する希望提出はありません")).toBeVisible();

    // 件数表示が 0 件（labels.lanePreference.filter.resultCount = "件"）。
    await expect(page.getByText("0件", { exact: false })).toBeVisible();

    // アコーディオン行（二次店名 + 希望レーン数バッジ）は出ない。
    await expect(page.getByText("希望レーン", { exact: false })).toHaveCount(0);
  });

  test("二次店ロール(dealer_admin)は本一覧を閲覧不可（URL 直叩きで 403 サーフェス）", async ({
    page,
  }) => {
    await signInWith(page, DEALER_EMAIL, PILOT_PASSWORD);

    await page.goto("/lane-preferences");

    const finalUrl = new URL(page.url());
    const redirectedAway = finalUrl.pathname !== "/lane-preferences";

    if (redirectedAway) {
      // middleware/Server が他ルートへ飛ばすパターン。再ログイン(/login)でないことのみ確認。
      expect(finalUrl.pathname).not.toBe("/login");
    } else {
      // 同一 URL に留まる場合は group error boundary の 403 サーフェスに切替わる。
      // 通常の一覧見出しは出ず、forbidden 見出し（labels.common.forbidden）が出る。
      await expect(page.getByRole("heading", { name: "二次店希望一覧" })).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "この情報にアクセスできません" }),
      ).toBeVisible();
    }

    // どちらのパターンでも、二次店他社の希望明細（カインズ 大宮店 等）が露出しないこと。
    await expect(page.getByText("カインズ 大宮店")).toHaveCount(0);
  });
});
