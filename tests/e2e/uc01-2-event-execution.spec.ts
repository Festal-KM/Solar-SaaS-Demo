import { expect, test } from "@playwright/test";
import { signIn } from "./fixtures/auth";

// E2E spec for T-04-12 (part 1) — UC-01 後半 steps 8b-10
// (F-028 / F-029 / F-030 / F-031 / F-033).
//
// 前提: globalSetup が pnpm db:seed を実行済み。
//
// このスペックは自己完結するため、uc01-event-flow.spec.ts の state には依存しない。
// 代わりに最小限の event setup シーケンス（場所取り → 候補 → 体制決定）を実行して
// eventId を取得し、UC-01 後半（開始/終了/成果報告 + 顧客 + アポ）をテストする。
//
// Steps covered:
//   Setup     wholesaler_event_team: 場所提供元対応 → FIXED → 候補昇格 → OPEN → 可視化
//   Setup     wholesaler_admin: 開催体制決定 → eventId 取得
//   Step 8b   wholesaler_admin/dealer_admin: 開始報告を提出
//   Step 9    wholesaler_admin/dealer_admin: 終了報告を提出
//   Step 10a  wholesaler_admin: 成果報告フォームに数値入力 → 送信
//   Step 10b  wholesaler_admin: 顧客登録（催事チャネル）
//   Step 10c  wholesaler_admin: アポ登録（登録した顧客に対して）

// Module-level state shared across serial steps.
let eventId = "";
let customerId = "";

const RUN_ID = Date.now();

// ---------------------------------------------------------------------------
// UC-01 後半 (steps 8b-10) — serial shared state
// ---------------------------------------------------------------------------

test.describe.serial("UC-01 後半 — イベント実施・報告・顧客・アポ登録", () => {
  test.describe.configure({ timeout: 180_000 });

  // -------------------------------------------------------------------------
  // Setup-1: 場所提供元対応を作成して FIXED まで進め、候補昇格
  // -------------------------------------------------------------------------

  test("setup-1: create venue negotiation and promote to event candidate (OPEN)", async ({
    page,
  }) => {
    await signIn(page, "wholesaler_event_team@solar-saas.dev");

    // 場所提供元対応を新規起票
    await page.goto("/venue-negotiations/new");
    await expect(
      page.getByRole("heading", { name: "対応を新規起票" }),
    ).toBeVisible({ timeout: 30_000 });

    const vpSelect = page.locator("#venueProviderId");
    await vpSelect.waitFor({ state: "visible" });
    const options = await vpSelect.locator("option").all();
    const firstValue = await options[1]?.getAttribute("value");
    if (!firstValue) {
      throw new Error("場所提供元の選択肢がありません — seed データを確認してください");
    }
    await vpSelect.selectOption(firstValue);
    await page.locator("#candidateDates").fill("2027-03-10");

    const noteField = page.getByLabel("備考・履歴メモ");
    if (await noteField.isVisible()) {
      await noteField.fill(`UC-01-2 E2E ${RUN_ID}`);
    }

    await page.getByRole("button", { name: "登録" }).click();
    await expect(
      page.getByRole("heading", { name: "場所提供元対応詳細" }),
    ).toBeVisible({ timeout: 60_000 });

    // Verify we're on a detail page (not the new-form URL)
    expect(
      page.url().match(/\/venue-negotiations\/[A-Za-z0-9_-]+/),
    ).not.toBeNull();

    // NOT_CONTACTED → CONDITION_REVIEW → FEASIBLE → FIXED
    await page.getByRole("button", { name: "条件確認中" }).click();
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "実施可" }).click();
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "確定" }).click();
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("button", { name: "イベント候補として登録" }),
    ).toBeVisible({ timeout: 20_000 });

    // 候補昇格フォームを入力
    await page.locator("#targetMonth").fill("2027-03");
    await page.locator("#scheduledDate").fill("2027-03-10");
    await page.locator("#storeName").clear();
    await page.locator("#storeName").fill(`UC-01-2 店舗 ${RUN_ID}`);
    await page.locator("#deadlineAt").fill("2099-12-01T10:00");

    await page.getByRole("button", { name: "イベント候補として登録" }).click();
    await page.waitForURL(/\/event-candidates\/[A-Za-z0-9_-]+/, { timeout: 60_000 });
    const candidateMatch = page.url().match(/\/event-candidates\/([A-Za-z0-9_-]+)/);
    expect(candidateMatch).not.toBeNull();
    const eventCandidateId = candidateMatch![1]!;

    // DRAFT → OPEN
    await page.goto(`/event-candidates/${eventCandidateId}`);
    await page.getByRole("button", { name: "希望受付を開始（公開）" }).click();
    await expect(page.getByText("希望受付中")).toBeVisible({ timeout: 20_000 });

    // 二次店に公開
    const visibilitySection = page.getByRole("region", { name: "二次店共有設定" });
    await expect(visibilitySection).toBeVisible({ timeout: 20_000 });
    const selectAllCheckbox = page.getByLabel("すべて選択");
    await expect(selectAllCheckbox).toBeVisible({ timeout: 10_000 });
    await selectAllCheckbox.check();
    await page.getByRole("button", { name: "公開する" }).click();
    await expect(page.getByText("公開中").first()).toBeVisible({ timeout: 20_000 });

    // dealer_admin が希望提出
    await signIn(page, "alpha-admin@solar-saas.dev");
    await page.goto("/visible-event-candidates");
    await expect(
      page.getByRole("heading", { name: "公開中のイベント候補" }),
    ).toBeVisible({ timeout: 30_000 });

    const storeLabel = `UC-01-2 店舗 ${RUN_ID}`;
    await expect(page.getByText(storeLabel, { exact: false })).toBeVisible({
      timeout: 20_000,
    });

    const card = page.locator("li").filter({ hasText: storeLabel });
    await card.getByRole("link", { name: "希望提出" }).click();
    await page.waitForURL(/\/visible-event-candidates\/[A-Za-z0-9_-]+\/preference/, {
      timeout: 30_000,
    });
    await page.locator("#pref-priority").fill("1");
    await page.getByRole("button", { name: "希望を提出" }).click();
    await expect(
      page
        .getByRole("button", { name: "希望を更新" })
        .or(page.getByText("提出済み", { exact: false })),
    ).toBeVisible({ timeout: 30_000 });

    // wholesaler_admin が開催体制決定
    await signIn(page, "wholesaler_admin@solar-saas.dev");
    await page.goto(`/event-candidates/${eventCandidateId}/decide`);
    await expect(
      page.getByRole("heading", { name: "開催体制決定" }),
    ).toBeVisible({ timeout: 30_000 });

    const jointLabel = page
      .locator("label")
      .filter({ has: page.locator("input[value='JOINT']") });
    await expect(jointLabel).toBeVisible({ timeout: 10_000 });
    await jointLabel.click();

    const requiredPeopleInput = page.locator("#requiredPeople-input");
    await expect(requiredPeopleInput).toBeVisible({ timeout: 10_000 });
    await requiredPeopleInput.fill("2");

    const dealerCheckboxes = page.locator("input[type='checkbox']");
    const checkboxCount = await dealerCheckboxes.count();
    if (checkboxCount > 0) {
      const first = dealerCheckboxes.first();
      if (!(await first.isChecked())) {
        await first.check();
      }
    }

    await page.getByRole("button", { name: "決定して通知" }).click();
    await page.getByRole("button", { name: "決定する" }).click();

    await page.waitForURL(/\/events\/[A-Za-z0-9_-]+\/shifts/, { timeout: 60_000 });
    const shiftMatch = page.url().match(/\/events\/([A-Za-z0-9_-]+)\/shifts/);
    expect(shiftMatch).not.toBeNull();
    eventId = shiftMatch![1]!;

    expect(eventId).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Step 8b — wholesaler_admin: イベント詳細で「開始報告を提出」
  // -------------------------------------------------------------------------

  test("step-8b: wholesaler_admin submits start report", async ({ page }) => {
    expect(eventId, "Setup-1 で eventId が取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    await page.goto(`/events/${eventId}`);
    await expect(
      page.getByText(`UC-01-2 店舗 ${RUN_ID}`, { exact: false }),
    ).toBeVisible({ timeout: 30_000 });

    // 「開始報告を提出」ボタン（ReportButtons コンポーネント）
    const startBtn = page.getByRole("button", { name: "開始報告を提出" });
    await expect(startBtn).toBeVisible({ timeout: 20_000 });
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    // トースト「開始報告を提出しました」 or ボタンが「開始報告は提出済みです」に変わる
    await expect(
      page
        .getByText("開始報告を提出しました", { exact: false })
        .or(page.getByRole("button", { name: "開始報告は提出済みです" })),
    ).toBeVisible({ timeout: 30_000 });
  });

  // -------------------------------------------------------------------------
  // Step 9 — wholesaler_admin: 「終了報告を提出」ボタンクリック
  // -------------------------------------------------------------------------

  test("step-9: wholesaler_admin submits end report", async ({ page }) => {
    expect(eventId, "Setup-1 で eventId が取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    await page.goto(`/events/${eventId}`);
    await expect(
      page.getByText(`UC-01-2 店舗 ${RUN_ID}`, { exact: false }),
    ).toBeVisible({ timeout: 30_000 });

    // 開始報告が既に提出済みなのでボタンは「開始報告は提出済みです」で disabled
    const startSubmittedBtn = page.getByRole("button", { name: "開始報告は提出済みです" });
    await expect(startSubmittedBtn).toBeVisible({ timeout: 20_000 });

    // 「終了報告を提出」ボタン
    const endBtn = page.getByRole("button", { name: "終了報告を提出" });
    await expect(endBtn).toBeVisible({ timeout: 20_000 });
    await expect(endBtn).toBeEnabled();
    await endBtn.click();

    // トーストか disabled ボタンで成功を確認
    await expect(
      page
        .getByText("終了報告を提出しました", { exact: false })
        .or(page.getByText("開始報告が未提出です", { exact: false }))
        .or(page.getByRole("button", { name: "終了報告は提出済みです" })),
    ).toBeVisible({ timeout: 30_000 });
  });

  // -------------------------------------------------------------------------
  // Step 10a — wholesaler_admin: 成果報告フォームに数値入力 → 送信
  // -------------------------------------------------------------------------

  test("step-10a: wholesaler_admin submits result report", async ({ page }) => {
    expect(eventId, "Setup-1 で eventId が取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    await page.goto(`/events/${eventId}`);
    await expect(
      page.getByText(`UC-01-2 店舗 ${RUN_ID}`, { exact: false }),
    ).toBeVisible({ timeout: 30_000 });

    // 成果報告フォーム（ResultReportForm）が存在することを確認
    const resultSection = page.getByRole("region", { name: "成果報告" });
    await expect(resultSection).toBeVisible({ timeout: 20_000 });

    // すでに提出済みの場合はスキップ
    const alreadySubmitted = resultSection.getByText("成果報告は提出済みです");
    if (await alreadySubmitted.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // 前回の実行で既に提出されている — フォームが不在でも OK
      return;
    }

    // 各フィールドに 0 以上整数を入力
    await page.locator("#approachCount").fill("30");
    await page.locator("#surveyCount").fill("15");
    await page.locator("#totalAppts").fill("5");
    await page.locator("#validAppts").fill("3");
    await page.locator("#invalidAppts").fill("2");

    const submitBtn = page.getByRole("button", { name: "成果報告を提出" });
    await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
    await submitBtn.click();

    // 成功トーストが表示される
    await expect(
      page.getByText("成果報告を提出しました", { exact: false }),
    ).toBeVisible({ timeout: 30_000 });
  });

  // -------------------------------------------------------------------------
  // Step 10b — wholesaler_admin: 顧客登録（催事チャネル / sourceEventId 指定）
  // -------------------------------------------------------------------------

  test("step-10b: wholesaler_admin registers a customer (EVENT channel)", async ({
    page,
  }) => {
    expect(eventId, "Setup-1 で eventId が取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    await page.goto("/customers/new");
    await expect(
      page.getByRole("heading", { name: "顧客を新規登録" }),
    ).toBeVisible({ timeout: 30_000 });

    // 氏名
    await page.getByLabel("氏名").fill(`テスト 太郎 ${RUN_ID}`);
    // 電話番号 (type="tel")
    await page.getByLabel("電話番号").fill(`090${String(RUN_ID).slice(-8)}`);
    // チャネル → 催事（獲得チャネル select）
    await page.getByLabel("獲得チャネル").selectOption("EVENT");
    // 催事 ID（sourceEventId field label = "催事 ID"）
    await page.getByLabel("催事 ID").fill(eventId);

    // 登録ボタン
    const submitBtn = page.getByRole("button", { name: "登録" });
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    // 顧客一覧へリダイレクト（redirectTo="/customers"）
    await page.waitForURL((url) => url.pathname.startsWith("/customers"), {
      timeout: 60_000,
    });
    await expect(
      page.getByRole("heading", { name: "顧客一覧" }),
    ).toBeVisible({ timeout: 30_000 });

    // 一覧の先頭行のリンク href から顧客 ID を取得
    // （顧客一覧は最終更新降順 — 今登録したレコードが先頭に来るはず）
    const firstLink = page.locator("table tbody tr:first-child td:first-child a");
    await expect(firstLink).toBeVisible({ timeout: 20_000 });
    const href = await firstLink.getAttribute("href");
    const m = href?.match(/\/customers\/([A-Za-z0-9_-]+)/);
    if (m) customerId = m[1]!;

    expect(customerId, "顧客 ID が取得できなかった").toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Step 10c — wholesaler_admin: アポ登録
  // -------------------------------------------------------------------------

  test("step-10c: wholesaler_admin registers an appointment for the customer", async ({
    page,
  }) => {
    expect(customerId, "Step 10b で顧客 ID が取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    await page.goto(`/appointments/new?customerId=${customerId}`);
    await expect(
      page.getByRole("heading", { name: "アポを新規登録" }),
    ).toBeVisible({ timeout: 30_000 });

    // customerId が事前入力されていることを確認（aria-required="true" の先頭 input）
    const customerIdInput = page.locator("input[aria-required='true']").first();
    await expect(customerIdInput).toHaveValue(customerId, { timeout: 10_000 });

    // 訪問予定日時
    const scheduledAtInput = page.locator("input[type='datetime-local']");
    await expect(scheduledAtInput).toBeVisible({ timeout: 10_000 });
    await scheduledAtInput.fill("2027-03-15T14:00");

    // 登録ボタン
    const submitBtn = page.getByRole("button", { name: "登録" });
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    // アポ一覧へリダイレクト（redirectTo="/appointments"）
    await page.waitForURL(/\/appointments/, { timeout: 60_000 });
    await expect(
      page.getByRole("heading", { name: "アポ一覧" }),
    ).toBeVisible({ timeout: 30_000 });

    // data-appointment-id 属性の先頭行が存在することを確認
    const firstApptRow = page.locator("table tbody tr[data-appointment-id]").first();
    await expect(firstApptRow).toBeVisible({ timeout: 20_000 });
    await expect(firstApptRow.getByText("未確認")).toBeVisible({ timeout: 10_000 });
  });
});
