import { expect, test } from "@playwright/test";
import { signIn } from "./fixtures/auth";

// E2E spec for T-04-12 (part 2) — UC-02 steps 1-5
// (F-031 / F-033 / F-035 / F-036 / F-037).
//
// 前提: globalSetup が pnpm db:seed を実行済み。
//
// このスペックは自己完結するため、uc01-2-event-execution.spec.ts の state には依存しない。
// 最初のセットアップで顧客 + アポを登録し、以降のステップでマエカク → 結果連絡をテストする。
//
// Steps covered:
//   Setup     wholesaler_admin: 顧客登録（WALK_IN チャネル） + アポ登録 → appointmentId 取得
//   Step 1-2  wholesaler_call_team: マエカク画面 → APPROVED を記録
//   Step 3    アポステータスが PRE_CALL_DONE に更新されたことを確認
//   Step 4    (fixme) wholesaler_call_team: マエカク結果連絡 — 対象二次店に通知送信
//             (PreCallNotification.send UI が未実装のため test.fixme)
//   Step 5    (fixme) dealer_admin: 通知一覧 → 確認ボタン → ACKNOWLEDGED
//             (/notifications/pre-call page が未実装のため test.fixme)

// Module-level state shared across serial steps.
let appointmentId = "";
let customerId = "";

const RUN_ID = Date.now();

// ---------------------------------------------------------------------------
// UC-02 steps 1-5 — serial shared state
// ---------------------------------------------------------------------------

test.describe.serial("UC-02 — アポ → マエカク → 結果連絡", () => {
  test.describe.configure({ timeout: 180_000 });

  // -------------------------------------------------------------------------
  // Setup: 顧客登録 + アポ登録
  //
  // アポ登録後、/appointments 一覧の先頭行の data-appointment-id 属性から
  // appointmentId を取得する。
  // -------------------------------------------------------------------------

  test("setup: wholesaler_admin registers a customer and appointment", async ({ page }) => {
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    // 顧客登録（WALK_IN チャネル — EVENT だと sourceEventId 必須のため）
    await page.goto("/customers/new");
    await expect(
      page.getByRole("heading", { name: "顧客を新規登録" }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByLabel("氏名").fill(`UC-02 花子 ${RUN_ID}`);
    await page.getByLabel("電話番号").fill(`080${String(RUN_ID).slice(-8)}`);
    await page.getByLabel("獲得チャネル").selectOption("WALK_IN");

    await page.getByRole("button", { name: "登録" }).click();

    // 顧客詳細 or 一覧へリダイレクト
    await page.waitForURL((url) => url.pathname.startsWith("/customers"), {
      timeout: 60_000,
    });

    // 顧客 ID を URL から取得（詳細ページへリダイレクトした場合）
    const customerMatch = page.url().match(/\/customers\/([A-Za-z0-9_-]+)/);
    if (customerMatch && customerMatch[1] !== "new") {
      customerId = customerMatch[1]!;
    }

    // 一覧ページに飛んだ場合 — 先頭行のリンク href から取得
    if (!customerId || customerId === "new") {
      await page.goto("/customers");
      await expect(
        page.getByRole("heading", { name: "顧客一覧" }),
      ).toBeVisible({ timeout: 30_000 });
      const firstLink = page.locator("table tbody tr:first-child td:first-child a");
      await expect(firstLink).toBeVisible({ timeout: 20_000 });
      const href = await firstLink.getAttribute("href");
      const m = href?.match(/\/customers\/([A-Za-z0-9_-]+)/);
      if (m) customerId = m[1]!;
    }

    expect(customerId, "顧客 ID が取得できなかった").toBeTruthy();

    // アポ登録（customerId を query param で渡す）
    await page.goto(`/appointments/new?customerId=${customerId}`);
    await expect(
      page.getByRole("heading", { name: "アポを新規登録" }),
    ).toBeVisible({ timeout: 30_000 });

    // 訪問予定日時
    const scheduledAtInput = page.locator("input[type='datetime-local']");
    await expect(scheduledAtInput).toBeVisible({ timeout: 10_000 });
    await scheduledAtInput.fill("2027-04-20T15:00");

    await page.getByRole("button", { name: "登録" }).click();

    // アポ一覧へリダイレクト（redirectTo="/appointments"）
    await page.waitForURL(/\/appointments/, { timeout: 60_000 });
    await expect(
      page.getByRole("heading", { name: "アポ一覧" }),
    ).toBeVisible({ timeout: 30_000 });

    // 先頭行の data-appointment-id 属性から appointmentId を取得
    const firstRow = page.locator("table tbody tr[data-appointment-id]").first();
    await expect(firstRow).toBeVisible({ timeout: 20_000 });
    const attrId = await firstRow.getAttribute("data-appointment-id");
    expect(attrId, "data-appointment-id 属性が見つからない — appointments/page.tsx を確認してください").toBeTruthy();
    appointmentId = attrId!;
  });

  // -------------------------------------------------------------------------
  // Step 1-2: wholesaler_call_team がマエカク画面で APPROVED を記録
  // -------------------------------------------------------------------------

  test("step-1-2: wholesaler_call_team records pre-call APPROVED", async ({ page }) => {
    expect(appointmentId, "Setup で appointmentId が取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_call_team@solar-saas.dev");

    // アポ一覧からマエカクリンクをクリック
    await page.goto("/appointments");
    await expect(
      page.getByRole("heading", { name: "アポ一覧" }),
    ).toBeVisible({ timeout: 30_000 });

    // data-appointment-id で対象行を特定し、マエカクリンクをクリック
    const targetRow = page.locator(
      `table tbody tr[data-appointment-id="${appointmentId}"]`,
    );
    await expect(targetRow).toBeVisible({ timeout: 20_000 });

    const preCallLink = targetRow.getByRole("link", { name: "マエカク" });
    await expect(preCallLink).toBeVisible({ timeout: 10_000 });
    await preCallLink.click();

    // マエカク管理ページへ遷移
    await page.waitForURL(
      (url) => url.pathname.includes("/pre-call"),
      { timeout: 30_000 },
    );
    await expect(
      page.getByRole("heading", { name: "マエカク管理" }),
    ).toBeVisible({ timeout: 30_000 });

    // アポ概要のステータスが「未確認」
    await expect(page.getByText("未確認", { exact: false })).toBeVisible({ timeout: 10_000 });

    // マエカク結果フォームが表示されている
    const resultSelect = page.locator("select");
    await expect(resultSelect).toBeVisible({ timeout: 10_000 });

    // APPROVED を選択
    await resultSelect.selectOption("APPROVED");

    // 「記録する」ボタンをクリック
    const recordBtn = page.getByRole("button", { name: "記録する" });
    await expect(recordBtn).toBeVisible({ timeout: 10_000 });
    await recordBtn.click();

    // 「マエカクを記録しました」トーストが表示される
    await expect(
      page.getByText("マエカクを記録しました", { exact: false }),
    ).toBeVisible({ timeout: 30_000 });
  });

  // -------------------------------------------------------------------------
  // Step 3: アポステータスが PRE_CALL_DONE に更新されたことを確認
  // -------------------------------------------------------------------------

  test("step-3: appointment status updated to PRE_CALL_DONE after pre-call", async ({
    page,
  }) => {
    expect(appointmentId, "Setup で appointmentId が取得できていない").toBeTruthy();
    await signIn(page, "wholesaler_admin@solar-saas.dev");

    // マエカク管理ページにステータスが「マエカク済」と表示される
    await page.goto(`/appointments/${appointmentId}/pre-call`);
    await expect(
      page.getByRole("heading", { name: "マエカク管理" }),
    ).toBeVisible({ timeout: 30_000 });

    // アポ概要のステータスが「マエカク済」
    await expect(page.getByText("マエカク済", { exact: false })).toBeVisible({
      timeout: 20_000,
    });

    // マエカク履歴に「承認」バッジが表示される
    await expect(page.getByText("承認", { exact: false })).toBeVisible({ timeout: 10_000 });

    // 「すでにマエカクが記録されています」メッセージが表示される
    await expect(
      page.getByText("すでにマエカクが記録されています", { exact: false }),
    ).toBeVisible({ timeout: 10_000 });

    // アポ一覧でステータスが PRE_CALL_DONE になっていることを確認
    await page.goto("/appointments");
    await expect(
      page.getByRole("heading", { name: "アポ一覧" }),
    ).toBeVisible({ timeout: 30_000 });

    const targetRow = page.locator(
      `table tbody tr[data-appointment-id="${appointmentId}"]`,
    );
    await expect(targetRow).toBeVisible({ timeout: 20_000 });
    await expect(targetRow.getByText("マエカク済")).toBeVisible({ timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // Step 4 (fixme): wholesaler_call_team: マエカク結果連絡 — 通知送信
  //
  // 前提: マエカク管理ページ（pre-call page）に「結果連絡」セクション + 送信 UI が
  //       実装済みであること（T-04-10 で実装予定）。
  //       現時点では notification-actions.ts のみ存在し、送信 UI は未実装。
  // -------------------------------------------------------------------------

  test.fixme(
    "step-4: wholesaler_call_team sends pre-call notification to dealer",
    async ({ page }) => {
      expect(appointmentId, "Setup で appointmentId が取得できていない").toBeTruthy();
      await signIn(page, "wholesaler_call_team@solar-saas.dev");

      await page.goto(`/appointments/${appointmentId}/pre-call`);
      await expect(
        page.getByRole("heading", { name: "マエカク管理" }),
      ).toBeVisible({ timeout: 30_000 });

      // マエカク結果連絡セクションが表示されている（T-04-10 で実装）
      const notificationSection = page.getByRole("region", {
        name: "二次店への結果連絡",
      });
      await expect(notificationSection).toBeVisible({ timeout: 20_000 });

      // 全二次店を選択して「連絡する」ボタンをクリック
      const selectAllCheckbox = page.getByLabel("すべて選択");
      if (await selectAllCheckbox.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await selectAllCheckbox.check();
      }

      const sendBtn = page.getByRole("button", { name: "連絡する" });
      await expect(sendBtn).toBeEnabled({ timeout: 5_000 });
      await sendBtn.click();

      // 「マエカク結果を連絡しました」トーストが表示される
      await expect(
        page.getByText("マエカク結果を連絡しました", { exact: false }),
      ).toBeVisible({ timeout: 30_000 });
    },
  );

  // -------------------------------------------------------------------------
  // Step 5 (fixme): dealer_admin が通知一覧で確認 → ACKNOWLEDGED
  //
  // 前提: /notifications/pre-call ページ（T-04-10 で実装予定）が存在すること。
  //       現時点では dealer/notifications/pre-call/actions.ts のみ存在し、
  //       page.tsx は未実装。
  // -------------------------------------------------------------------------

  test.fixme(
    "step-5: dealer_admin acknowledges pre-call notification",
    async ({ page }) => {
      await signIn(page, "alpha-admin@solar-saas.dev");

      // 二次店側の通知一覧へ
      await page.goto("/notifications/pre-call");
      await expect(
        page.getByRole("heading", { name: "マエカク結果通知一覧" }),
      ).toBeVisible({ timeout: 30_000 });

      // 未確認の通知が少なくとも 1 件存在する
      const pendingNotifications = page
        .getByText("未連絡", { exact: false })
        .or(page.getByText("送信済み", { exact: false }));
      await expect(pendingNotifications.first()).toBeVisible({ timeout: 20_000 });

      // 「確認済みにする」ボタンをクリック（最初の通知）
      const ackBtn = page.getByRole("button", { name: "確認済みにする" }).first();
      await expect(ackBtn).toBeEnabled({ timeout: 5_000 });
      await ackBtn.click();

      // 「確認済みにしました」トーストが表示される
      await expect(
        page.getByText("確認済みにしました", { exact: false }),
      ).toBeVisible({ timeout: 30_000 });

      // ステータスが「確認済み」に更新される
      await expect(
        page.getByText("確認済み", { exact: false }).first(),
      ).toBeVisible({ timeout: 20_000 });
    },
  );
});
