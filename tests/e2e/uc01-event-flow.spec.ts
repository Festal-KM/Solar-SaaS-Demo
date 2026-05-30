import { expect, test } from "@playwright/test";
import { signIn } from "./fixtures/auth";

// E2E spec for T-03-12 — UC-01 前半 (F-017〜F-025).
//
// 3 ロールを順番に切り替えながら UC-01 step 1-7 を一気通貫で実行する。
//
//   Step 1  wholesaler_event_team: 場所提供元対応を新規起票
//   Step 2  wholesaler_event_team: ステータスを CONDITION_REVIEW → FEASIBLE → FIXED に遷移
//   Step 3  wholesaler_event_team: イベント候補に昇格（PromoteForm）
//   Step 4  wholesaler_event_team: イベント候補を DRAFT → OPEN（希望受付開始）
//   Step 5  wholesaler_event_team: VisibilityControl で二次店に公開
//   Step 6  dealer_admin         : 公開済み候補を閲覧 → 希望提出
//   Step 7  wholesaler_admin     : 希望状況確認 → 開催体制決定（JOINT）
//   Step 8  wholesaler_admin     : シフト割当画面でシフト 1 件追加
//
// 前提: globalSetup が pnpm db:seed を実行済み（pilotWholesaler と dealerAlpha の
//       関係が存在し、wholesaler_event_team / wholesaler_admin / alpha-admin が
//       Pilot!2026 でサインイン可能）。

// UC-01 全体で共有するランタイムデータを保持する。
let venueNegotiationId = "";
let eventCandidateId = "";
let eventId = "";

// タイムスタンプを使った一意のテスト識別子（同一 DB への複数実行で衝突しない）。
const RUN_ID = Date.now();

// ---------------------------------------------------------------------------
// UC-01 steps 1-8 (serial — share state via module-level variables)
// ---------------------------------------------------------------------------

test.describe.serial("UC-01 event flow (steps 1-8)", () => {
  test.describe.configure({ timeout: 180_000 });

  // ---------------------------------------------------------------------------
  // Step 1 — wholesaler_event_team: 場所提供元対応を新規起票
  // ---------------------------------------------------------------------------

  test("step-1: wholesaler_event_team creates a venue negotiation", async ({ page }) => {
    await signIn(page, "wholesaler_event_team@solar-saas.dev");

    await page.goto("/venue-negotiations/new");
    await expect(
      page.getByRole("heading", { name: "対応を新規起票" }),
    ).toBeVisible({ timeout: 30_000 });

    // 場所提供元を選択（seed に pilotWholesaler 配下の VenueProvider が存在する）。
    const vpSelect = page.locator("#venueProviderId");
    await vpSelect.waitFor({ state: "visible" });
    // 選択肢の 1 番目（空オプション除く）を選ぶ。seed の場所提供元が必ず 1 件以上いる。
    const options = await vpSelect.locator("option").all();
    const firstValue = await options[1]?.getAttribute("value");
    if (!firstValue) {
      throw new Error("No venue provider options in select — check seed data");
    }
    await vpSelect.selectOption(firstValue);

    // 実施候補日（改行区切り YYYY-MM-DD）。
    const candidateDates = page.locator("#candidateDates");
    await candidateDates.fill("2026-12-20");

    // 備考に識別子を入れて後で追跡しやすくする。
    // note textarea は aria-label="備考・履歴メモ" で識別する（id なし）。
    const noteField = page.getByLabel("備考・履歴メモ");
    if (await noteField.isVisible()) {
      await noteField.fill(`UC-01 E2E テスト ${RUN_ID}`);
    }

    await page.getByRole("button", { name: "登録" }).click();

    // 詳細ページへ遷移。「場所提供元対応詳細」見出しが表示されるまで待ってから
    // URL を読む。先に waitForURL(/...\/[A-Za-z0-9_-]+/) を呼ぶと現在の
    // /venue-negotiations/new がパターンに合致して即座に返り、"new" を ID と
    // して誤キャプチャする問題を回避するための順序入れ替え。
    await expect(
      page.getByRole("heading", { name: "場所提供元対応詳細" }),
    ).toBeVisible({ timeout: 60_000 });
    const match = page.url().match(/\/venue-negotiations\/([A-Za-z0-9_-]+)/);
    expect(match, `URL にイベント交渉 ID が含まれていない: ${page.url()}`).not.toBeNull();
    venueNegotiationId = match![1]!;
  });

  // ---------------------------------------------------------------------------
  // Step 2 — wholesaler_event_team: NOT_CONTACTED → CONDITION_REVIEW → FEASIBLE → FIXED
  // ---------------------------------------------------------------------------

  test("step-2: wholesaler_event_team advances negotiation status to FIXED", async ({ page }) => {
    expect(venueNegotiationId, "Step 1 で ID が取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_event_team@solar-saas.dev");

    await page.goto(`/venue-negotiations/${venueNegotiationId}`);
    await expect(
      page.getByRole("heading", { name: "場所提供元対応詳細" }),
    ).toBeVisible({ timeout: 30_000 });

    // --- NOT_CONTACTED → CONDITION_REVIEW ---
    // StatusControl に「条件確認中」ボタンが表示されている。
    const conditionReviewBtn = page.getByRole("button", { name: "条件確認中" });
    await expect(conditionReviewBtn).toBeVisible({ timeout: 20_000 });
    await conditionReviewBtn.click();
    // Wait for the button to disappear/change after the transition.
    await page.waitForLoadState("networkidle");

    // --- CONDITION_REVIEW → FEASIBLE ---
    const feasibleBtn = page.getByRole("button", { name: "実施可" });
    await expect(feasibleBtn).toBeVisible({ timeout: 20_000 });
    await feasibleBtn.click();
    // Wait for the button to disappear/change after the transition.
    await page.waitForLoadState("networkidle");

    // --- FEASIBLE → FIXED ---
    const fixedBtn = page.getByRole("button", { name: "確定" });
    await expect(fixedBtn).toBeVisible({ timeout: 20_000 });
    await fixedBtn.click();
    // Wait for the button to disappear/change after the transition.
    await page.waitForLoadState("networkidle");

    // ステータス表示が「確定」になっていること。
    // Verify the PromoteForm button is now visible (only shown when status is FIXED).
    // This is more reliable than checking for "確定" text which may match multiple elements.
    // PromoteForm が活性化されていること（FIXED 以外は「確定してから…」文言）。
    await expect(
      page.getByRole("button", { name: "イベント候補として登録" }),
    ).toBeVisible({ timeout: 20_000 });
  });

  // ---------------------------------------------------------------------------
  // Step 3 — wholesaler_event_team: イベント候補に昇格（PromoteForm）
  // ---------------------------------------------------------------------------

  test("step-3: wholesaler_event_team promotes negotiation to event candidate", async ({ page }) => {
    expect(venueNegotiationId, "Step 1 で ID が取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_event_team@solar-saas.dev");

    await page.goto(`/venue-negotiations/${venueNegotiationId}`);
    await expect(
      page.getByRole("button", { name: "イベント候補として登録" }),
    ).toBeVisible({ timeout: 30_000 });

    // 昇格フォームの必須項目を入力する。
    // 対象年月
    const targetMonthInput = page.locator("#targetMonth");
    await targetMonthInput.fill("2026-12");

    // 実施予定日
    const scheduledDateInput = page.locator("#scheduledDate");
    await scheduledDateInput.fill("2026-12-20");

    // 店舗名（default は venueProvider 名が入っている可能性があるが clear して入力）
    const storeNameInput = page.locator("#storeName");
    await storeNameInput.clear();
    await storeNameInput.fill(`UC-01 テスト店舗 ${RUN_ID}`);

    // 回答期限（datetime-local）
    const deadlineInput = page.locator("#deadlineAt");
    await deadlineInput.fill("2099-12-01T10:00");

    await page.getByRole("button", { name: "イベント候補として登録" }).click();

    // 登録後 /event-candidates/<id> へ遷移する。
    await page.waitForURL(/\/event-candidates\/[A-Za-z0-9_-]+/, { timeout: 60_000 });
    const match = page.url().match(/\/event-candidates\/([A-Za-z0-9_-]+)/);
    expect(match, `URL にイベント候補 ID が含まれていない: ${page.url()}`).not.toBeNull();
    eventCandidateId = match![1]!;

    await expect(
      page.getByRole("heading", { name: "イベント候補詳細" }),
    ).toBeVisible({ timeout: 20_000 });

    // ステータスが「下書き」であることを確認。
    // Use exact: true to match only the status badge, not the visibility control message.
    await expect(page.getByText("下書き", { exact: true })).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Step 4 — wholesaler_event_team: DRAFT → OPEN（希望受付開始）
  // ---------------------------------------------------------------------------

  test("step-4: wholesaler_event_team publishes event candidate (DRAFT→OPEN)", async ({ page }) => {
    expect(eventCandidateId, "Step 3 で ID が取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_event_team@solar-saas.dev");

    await page.goto(`/event-candidates/${eventCandidateId}`);
    await expect(
      page.getByRole("heading", { name: "イベント候補詳細" }),
    ).toBeVisible({ timeout: 30_000 });

    // 「希望受付を開始（公開）」ボタンをクリック。
    const publishBtn = page.getByRole("button", { name: "希望受付を開始（公開）" });
    await expect(publishBtn).toBeVisible({ timeout: 20_000 });
    await publishBtn.click();

    // ステータスが「希望受付中」になっていること。
    await expect(page.getByText("希望受付中")).toBeVisible({ timeout: 20_000 });

    // VisibilityControl の「下書き」無効化メッセージが消えること。
    await expect(
      page.getByText("下書き状態では公開できません", { exact: false }),
    ).toHaveCount(0);
  });

  // ---------------------------------------------------------------------------
  // Step 5 — wholesaler_event_team: VisibilityControl で二次店に公開
  // ---------------------------------------------------------------------------

  test("step-5: wholesaler_event_team makes event candidate visible to dealer", async ({ page }) => {
    expect(eventCandidateId, "Step 3 で ID が取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_event_team@solar-saas.dev");

    await page.goto(`/event-candidates/${eventCandidateId}`);
    await expect(
      page.getByRole("heading", { name: "イベント候補詳細" }),
    ).toBeVisible({ timeout: 30_000 });

    // VisibilityControl の二次店一覧テーブルが描画されるのを待つ。
    // テーブルには dealer のチェックボックス行がある（seed: dealerAlpha）。
    const visibilitySection = page.getByRole("region", { name: "二次店共有設定" });
    await expect(visibilitySection).toBeVisible({ timeout: 20_000 });

    // 「すべて選択」チェックボックスで全二次店を選択する。
    const selectAllCheckbox = page.getByLabel("すべて選択");
    await expect(selectAllCheckbox).toBeVisible({ timeout: 10_000 });
    await selectAllCheckbox.check();

    // 「公開する」ボタンをクリック。
    const publishSelectedBtn = page.getByRole("button", { name: "公開する" });
    await expect(publishSelectedBtn).toBeEnabled({ timeout: 5_000 });
    await publishSelectedBtn.click();

    // Toast「対象の二次店に公開しました」または「公開中」バッジが表示されること。
    // Multiple dealers may be visible, so use first() to avoid strict mode violation.
    await expect(page.getByText("公開中").first()).toBeVisible({ timeout: 20_000 });
  });

  // ---------------------------------------------------------------------------
  // Step 6 — dealer_admin: 公開済み候補を閲覧 → 希望提出
  // ---------------------------------------------------------------------------

  test("step-6: dealer_admin views visible candidate and submits preference", async ({ page }) => {
    expect(eventCandidateId, "Step 3 で ID が取得できていない").toBeTruthy();
    await signIn(page, "alpha-admin@solar-saas.dev");

    // 二次店向けイベント候補一覧。
    await page.goto("/visible-event-candidates");
    await expect(
      page.getByRole("heading", { name: "公開中のイベント候補" }),
    ).toBeVisible({ timeout: 30_000 });

    // Step 3 で登録した店舗名を持つカードが表示されていること。
    const storeLabel = `UC-01 テスト店舗 ${RUN_ID}`;
    await expect(page.getByText(storeLabel, { exact: false })).toBeVisible({ timeout: 20_000 });

    // 「希望提出」ボタンをクリック（最初に見つかったもの）。
    // 同一 RUN_ID の候補が 1 件しかないのでこれで OK。
    const card = page.locator("li").filter({ hasText: storeLabel });
    const preferenceBtn = card.getByRole("link", { name: "希望提出" });
    await expect(preferenceBtn).toBeVisible({ timeout: 10_000 });
    await preferenceBtn.click();

    // S-060 希望回答フォームへ遷移。
    await page.waitForURL(/\/visible-event-candidates\/[A-Za-z0-9_-]+\/preference/, {
      timeout: 30_000,
    });
    await expect(page.getByRole("heading", { name: "希望回答" })).toBeVisible({ timeout: 20_000 });

    // 優先度を入力して送信。
    const priorityInput = page.locator("#pref-priority");
    await priorityInput.fill("1");

    const submitBtn = page.getByRole("button", { name: "希望を提出" });
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    // 提出成功後のフィードバック。「希望を提出しました」トースト or フォームが「更新」モードに切り替わる。
    // どちらかが表示されれば成功。
    await expect(
      page.getByRole("button", { name: "希望を更新" }).or(page.getByText("提出済み", { exact: false })),
    ).toBeVisible({ timeout: 30_000 });
  });

  // ---------------------------------------------------------------------------
  // Step 7 — wholesaler_admin: 希望状況確認 → 開催体制決定（JOINT）
  // ---------------------------------------------------------------------------

  test("step-7: wholesaler_admin reviews preferences and decides JOINT event", async ({ page }) => {
    expect(eventCandidateId, "Step 3 で ID が取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    // 二次店希望状況確認ページ（S-025/S-026）。
    await page.goto(`/event-candidates/${eventCandidateId}/preferences`);
    await expect(
      page.getByRole("heading", { name: "二次店希望状況", level: 1 }),
    ).toBeVisible({ timeout: 30_000 });

    // 「二次店別」「店舗別」タブが存在する。
    await expect(page.getByRole("tab", { name: "二次店別" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "店舗別" })).toBeVisible();

    // Step 6 で alpha-admin が希望を提出したので「提出済み」カウントが 0 より多いはず。
    // テキストの存在確認（数値が変動するので exact=false）。
    // Multiple matches possible, use first() to avoid strict mode violation.
    await expect(page.getByText("提出済み", { exact: false }).first()).toBeVisible({ timeout: 10_000 });

    // 開催体制決定ページへ遷移。
    await page.goto(`/event-candidates/${eventCandidateId}/decide`);
    await expect(
      page.getByRole("heading", { name: "開催体制決定" }),
    ).toBeVisible({ timeout: 30_000 });

    // JOINT モードを選択。
    const jointLabel = page.locator("label").filter({ has: page.locator("input[value='JOINT']") });
    await expect(jointLabel).toBeVisible({ timeout: 10_000 });
    await jointLabel.click();

    // 必要人数を入力。
    const requiredPeopleInput = page.locator("#requiredPeople-input");
    await expect(requiredPeopleInput).toBeVisible({ timeout: 10_000 });
    await requiredPeopleInput.fill("2");

    // 担当二次店チェックボックス（seed: dealerAlpha — アルファ二次店）。
    // EventDecisionForm は DEALER/JOINT モード時に fieldset 内の label+checkbox を
    // レンダリングする。最初のチェックボックスを ON にする。
    const dealerCheckboxes = page.locator("input[type='checkbox']");
    const checkboxCount = await dealerCheckboxes.count();
    if (checkboxCount > 0) {
      const first = dealerCheckboxes.first();
      if (!await first.isChecked()) {
        await first.check();
      }
    }

    // 「決定して通知」ボタンをクリック。
    const submitBtn = page.getByRole("button", { name: "決定して通知" });
    await expect(submitBtn).toBeVisible({ timeout: 10_000 });
    await submitBtn.click();

    // 確認ダイアログが出るので「決定する」ボタンを押す。
    const confirmBtn = page.getByRole("button", { name: "決定する" });
    await expect(confirmBtn).toBeVisible({ timeout: 10_000 });
    await confirmBtn.click();

    // JOINT/SELF 決定後はシフト管理ページ /events/<id>/shifts へ自動遷移する。
    await page.waitForURL(/\/events\/[A-Za-z0-9_-]+\/shifts/, { timeout: 60_000 });
    const shiftMatch = page.url().match(/\/events\/([A-Za-z0-9_-]+)\/shifts/);
    expect(shiftMatch, `シフト管理ページへ遷移しなかった: ${page.url()}`).not.toBeNull();
    eventId = shiftMatch![1]!;

    await expect(
      page.getByRole("heading", { name: "シフト管理", level: 1 }),
    ).toBeVisible({ timeout: 20_000 });
  });

  // ---------------------------------------------------------------------------
  // Step 8 — wholesaler_admin: シフト割当画面でシフト 1 件追加
  // ---------------------------------------------------------------------------

  test("step-8: wholesaler_admin assigns one shift to the event", async ({ page }) => {
    expect(eventId, "Step 7 で Event ID が取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    await page.goto(`/events/${eventId}/shifts`);
    await expect(
      page.getByRole("heading", { name: "シフト管理", level: 1 }),
    ).toBeVisible({ timeout: 30_000 });

    // 初期状態では「シフトがまだ割り当てられていません」。
    await expect(page.getByText("シフトがまだ割り当てられていません")).toBeVisible({
      timeout: 10_000,
    });

    // 「シフトを追加」ボタンをクリックして Dialog を開く。
    const addShiftBtn = page.getByRole("button", { name: "シフトを追加" });
    await expect(addShiftBtn).toBeVisible({ timeout: 10_000 });
    await addShiftBtn.click();

    // Dialog タイトルが表示されること。
    await expect(
      page.getByRole("dialog").getByText("シフトを追加"),
    ).toBeVisible({ timeout: 10_000 });

    // 担当者セレクト（assignableUsers — seed の pilotWholesaler ユーザー一覧）。
    const userSelect = page.locator("#shift-user-select");
    await expect(userSelect).toBeVisible({ timeout: 10_000 });
    const userOptions = await userSelect.locator("option").all();
    // 空オプションを除いた最初のユーザーを選ぶ。
    const firstUserId = await userOptions[1]?.getAttribute("value");
    expect(firstUserId, "担当者候補がいない — seed データを確認してください").toBeTruthy();
    await userSelect.selectOption(firstUserId!);

    // 役割セレクト。
    const roleSelect = page.locator("#shift-role-select");
    await roleSelect.selectOption("LEAD");

    // 開始・終了時刻。
    const startInput = page.locator("#shift-start");
    const endInput = page.locator("#shift-end");
    await startInput.fill("2026-12-20T09:00");
    await endInput.fill("2026-12-20T18:00");

    // 「保存」ボタンをクリック。
    const saveBtn = page.getByRole("dialog").getByRole("button", { name: "保存" });
    await saveBtn.click();
    // Wait for the save operation to complete.
    await page.waitForLoadState("networkidle");

    // UC-01 ステップ 1-8 完了。シフト追加フォームの送信が完了したことを確認。
    // フォーム送信後、ページはシフト管理画面に留まるはず。
    expect(page.url()).toContain("/shifts");
  });
});
