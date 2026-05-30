// Pure notification type configuration — no DB / framework dependencies.
//
// Provides the default delivery channels for each NotificationType and the
// `buildNotificationContent` helper that converts a type + parameter map into
// a localised title + body pair (Japanese, per CLAUDE.md hard rule #2).
//
// Title/body templates follow the notification matrix in docs/05 §6.7 and the
// acceptance criteria for T-07-02.

// Mirror of the Prisma-generated enums — duplicated here to keep the contracts
// package DB-agnostic (no @prisma/client dependency).
export type NotificationType =
  | "DEALER_PREFERENCE_SUBMITTED"
  | "DEALER_PREFERENCE_MISSING"
  | "EVENT_DECISION_PENDING"
  | "EVENT_SHIFT_SHORTAGE"
  | "EVENT_START_REPORTED"
  | "EVENT_END_REPORTED"
  | "EVENT_RESULT_REPORTED"
  | "CUSTOMER_NEW"
  | "PRE_CALL_PENDING"
  | "PRE_CALL_NOTIFICATION_PENDING"
  | "PRE_CALL_RESULT_SHARED"
  | "DEAL_STATUS_TO_CONTRACT"
  | "MONTHLY_REPORT_SUBMITTED"
  | "MONTHLY_REPORT_REVIEW_PENDING"
  | "GROSS_PROFIT_PENDING"
  | "INCENTIVE_PENDING"
  | "INCENTIVE_FINALIZED"
  | "CONSTRUCTION_UPCOMING"
  | "APPLICATION_DEADLINE"
  | "EVENT_PUBLISHED"
  | "EVENT_PREFERENCE_DEADLINE"
  | "EVENT_ASSIGNED"
  | "EVENT_DAY_BEFORE"
  | "CONTRACT_CONTRACTED"
  | "SHIFT_ASSIGNED"
  | "SHIFT_CHANGED"
  | "REPORT_PENDING";

export type DeliveryChannel = "IN_APP" | "EMAIL" | "LINE";

export interface NotificationTypeConfig {
  defaultChannels: DeliveryChannel[];
  buildTitle: (params: Record<string, string>) => string;
  buildBody: (params: Record<string, string>) => string;
}

export const NOTIFICATION_TYPE_CONFIGS: Record<NotificationType, NotificationTypeConfig> = {
  DEALER_PREFERENCE_SUBMITTED: {
    defaultChannels: ["IN_APP", "EMAIL"],
    buildTitle: () => "二次店から希望が提出されました",
    buildBody: (p) => `${p["dealerName"] ?? "二次店"}からイベント候補への希望が提出されました。`,
  },
  DEALER_PREFERENCE_MISSING: {
    defaultChannels: ["IN_APP", "EMAIL"],
    buildTitle: () => "希望未提出の二次店があります",
    buildBody: (p) =>
      `イベント候補「${p["eventTitle"] ?? ""}」への希望締切が近づいていますが、まだ希望が提出されていない二次店があります。`,
  },
  EVENT_DECISION_PENDING: {
    defaultChannels: ["IN_APP", "EMAIL"],
    buildTitle: () => "開催体制決定が保留中です",
    buildBody: (p) =>
      `イベント候補「${p["eventTitle"] ?? ""}」の開催体制がまだ決定されていません。`,
  },
  EVENT_SHIFT_SHORTAGE: {
    defaultChannels: ["IN_APP"],
    buildTitle: () => "シフト人数が不足しています",
    buildBody: (p) =>
      `イベント「${p["eventTitle"] ?? ""}」のシフトに不足が生じています。要員を確認してください。`,
  },
  EVENT_START_REPORTED: {
    defaultChannels: ["IN_APP"],
    buildTitle: () => "イベント開始が報告されました",
    buildBody: (p) => `イベント「${p["eventTitle"] ?? ""}」の開始が報告されました。`,
  },
  EVENT_END_REPORTED: {
    defaultChannels: ["IN_APP"],
    buildTitle: () => "イベント終了が報告されました",
    buildBody: (p) => `イベント「${p["eventTitle"] ?? ""}」の終了が報告されました。`,
  },
  EVENT_RESULT_REPORTED: {
    defaultChannels: ["IN_APP", "EMAIL"],
    buildTitle: () => "イベント実績が報告されました",
    buildBody: (p) => `イベント「${p["eventTitle"] ?? ""}」の実績報告が登録されました。`,
  },
  CUSTOMER_NEW: {
    defaultChannels: ["IN_APP"],
    buildTitle: () => "新規顧客が登録されました",
    buildBody: (p) => `顧客「${p["customerName"] ?? ""}」が登録されました。マエカクを予定してください。`,
  },
  PRE_CALL_PENDING: {
    defaultChannels: ["IN_APP", "EMAIL"],
    buildTitle: () => "マエカク登録が未完了です",
    buildBody: (p) =>
      `顧客「${p["customerName"] ?? ""}」のマエカクがまだ完了していません。24 時間以内に対応してください。`,
  },
  PRE_CALL_NOTIFICATION_PENDING: {
    defaultChannels: ["IN_APP", "EMAIL"],
    buildTitle: () => "マエカク結果の連絡が未送信です",
    buildBody: (p) =>
      `顧客「${p["customerName"] ?? ""}」のマエカク結果を二次店に連絡してください。`,
  },
  PRE_CALL_RESULT_SHARED: {
    defaultChannels: ["IN_APP", "EMAIL"],
    buildTitle: () => "マエカク結果が共有されました",
    buildBody: (p) =>
      `顧客「${p["customerName"] ?? ""}」のマエカク結果が二次店に共有されました。`,
  },
  DEAL_STATUS_TO_CONTRACT: {
    defaultChannels: ["IN_APP", "EMAIL"],
    buildTitle: () => "商談が契約に進みました",
    buildBody: (p) => `商談「${p["dealTitle"] ?? ""}」が契約に進みました。確認してください。`,
  },
  MONTHLY_REPORT_SUBMITTED: {
    defaultChannels: ["IN_APP", "EMAIL"],
    buildTitle: () => "月次報告が提出されました",
    buildBody: (p) =>
      `${p["dealerName"] ?? "二次店"}から${p["targetMonth"] ?? ""}の月次報告が提出されました。`,
  },
  MONTHLY_REPORT_REVIEW_PENDING: {
    defaultChannels: ["IN_APP", "EMAIL"],
    buildTitle: () => "月次報告のレビューが必要です",
    buildBody: (p) => `${p["targetMonth"] ?? ""}の月次報告のレビューが保留中です。`,
  },
  GROSS_PROFIT_PENDING: {
    defaultChannels: ["IN_APP"],
    buildTitle: () => "粗利計算が未確定です",
    buildBody: (p) => `契約「${p["contractId"] ?? ""}」の粗利計算が未確定です。確認してください。`,
  },
  INCENTIVE_PENDING: {
    defaultChannels: ["IN_APP"],
    buildTitle: () => "インセンティブが未確定です",
    buildBody: (p) => `契約「${p["contractId"] ?? ""}」のインセンティブが未確定（DRAFT）のままです。`,
  },
  INCENTIVE_FINALIZED: {
    defaultChannels: ["IN_APP", "EMAIL"],
    buildTitle: () => "インセンティブが確定しました",
    buildBody: (p) =>
      `${p["targetMonth"] ?? ""}のインセンティブが確定しました。明細を確認してください。`,
  },
  CONSTRUCTION_UPCOMING: {
    defaultChannels: ["IN_APP", "EMAIL"],
    buildTitle: () => "施工予定が近づいています",
    buildBody: (p) =>
      `${p["constructionDate"] ?? ""}に施工予定があります。7 日前のリマインダです。`,
  },
  APPLICATION_DEADLINE: {
    defaultChannels: ["IN_APP", "EMAIL"],
    buildTitle: () => "申請期限が近づいています",
    buildBody: (p) => `申請期限（${p["deadline"] ?? ""}）まで 14 日を切りました。`,
  },
  EVENT_PUBLISHED: {
    defaultChannels: ["IN_APP", "EMAIL"],
    buildTitle: () => "新しいイベント候補が公開されました",
    buildBody: (p) =>
      `イベント候補「${p["eventTitle"] ?? ""}」が公開されました。希望を提出してください。`,
  },
  EVENT_PREFERENCE_DEADLINE: {
    defaultChannels: ["IN_APP", "EMAIL"],
    buildTitle: () => "希望提出期限が近づいています",
    buildBody: (p) =>
      `イベント候補「${p["eventTitle"] ?? ""}」への希望提出期限（${p["deadline"] ?? ""}）まで 24 時間です。`,
  },
  EVENT_ASSIGNED: {
    defaultChannels: ["IN_APP", "EMAIL"],
    buildTitle: () => "イベントに割り当てられました",
    buildBody: (p) =>
      `イベント「${p["eventTitle"] ?? ""}」（${p["eventDate"] ?? ""}）に割り当てられました。`,
  },
  EVENT_DAY_BEFORE: {
    defaultChannels: ["IN_APP", "EMAIL"],
    buildTitle: () => "明日はイベント当日です",
    buildBody: (p) =>
      `明日（${p["eventDate"] ?? ""}）はイベント「${p["eventTitle"] ?? ""}」の開催日です。準備を確認してください。`,
  },
  CONTRACT_CONTRACTED: {
    defaultChannels: ["IN_APP", "EMAIL"],
    buildTitle: () => "契約が成立しました",
    buildBody: (p) =>
      `顧客「${p["customerName"] ?? ""}」との契約が成立しました。明細を確認してください。`,
  },
  SHIFT_ASSIGNED: {
    defaultChannels: ["IN_APP", "EMAIL"],
    buildTitle: () => "シフトに割り当てられました",
    buildBody: (p) =>
      `イベント「${p["eventTitle"] ?? ""}」（${p["eventDate"] ?? ""}）のシフトに割り当てられました。`,
  },
  SHIFT_CHANGED: {
    defaultChannels: ["IN_APP", "EMAIL"],
    buildTitle: () => "シフトが変更されました",
    buildBody: (p) =>
      `イベント「${p["eventTitle"] ?? ""}」（${p["eventDate"] ?? ""}）のシフトが変更されました。確認してください。`,
  },
  REPORT_PENDING: {
    defaultChannels: ["IN_APP", "EMAIL"],
    buildTitle: () => "実績報告が未提出です",
    buildBody: (p) =>
      `イベント「${p["eventTitle"] ?? ""}」の実績報告がまだ提出されていません。`,
  },
};

export interface NotificationContent {
  title: string;
  body: string;
}

/**
 * Build localised title + body for a notification.
 *
 * params: arbitrary key → value substitutions used by the template functions.
 * Unknown keys are silently ignored; missing keys fall back to empty string.
 */
export function buildNotificationContent(
  type: NotificationType,
  params: Record<string, string> = {},
): NotificationContent {
  const config = NOTIFICATION_TYPE_CONFIGS[type];
  return {
    title: config.buildTitle(params),
    body: config.buildBody(params),
  };
}

/**
 * Default delivery channels for a notification type.
 * LINE is always excluded in Phase 1 regardless of the config.
 */
export function defaultChannelsForType(type: NotificationType): Exclude<DeliveryChannel, "LINE">[] {
  return NOTIFICATION_TYPE_CONFIGS[type].defaultChannels.filter(
    (ch): ch is Exclude<DeliveryChannel, "LINE"> => ch !== "LINE",
  );
}
