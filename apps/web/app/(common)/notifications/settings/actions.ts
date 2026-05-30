"use server";

// Notification preference Server Action — T-07-06 / F-052 / F-053 / S-080.
//
// `updateNotificationPreferencesAction` upserts NotificationPreference rows
// for the calling user. LINE channel is rejected in Phase 1 to prevent
// accidentally enabling the unimplemented Phase 2 channel.
//
// Security:
//   - userId is taken from ctx.actorUserId, never from input.
//   - LINE channel is disallowed and returns a validation error.

import { z } from "zod";

import { withServerActionContext } from "@/lib/tenancy/server-action";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const ALLOWED_CHANNELS = ["IN_APP", "EMAIL"] as const;
type AllowedChannel = (typeof ALLOWED_CHANNELS)[number];

const VALID_TYPES = [
  "DEALER_PREFERENCE_SUBMITTED",
  "DEALER_PREFERENCE_MISSING",
  "EVENT_DECISION_PENDING",
  "EVENT_SHIFT_SHORTAGE",
  "EVENT_START_REPORTED",
  "EVENT_END_REPORTED",
  "EVENT_RESULT_REPORTED",
  "CUSTOMER_NEW",
  "PRE_CALL_PENDING",
  "PRE_CALL_NOTIFICATION_PENDING",
  "PRE_CALL_RESULT_SHARED",
  "DEAL_STATUS_TO_CONTRACT",
  "MONTHLY_REPORT_SUBMITTED",
  "MONTHLY_REPORT_REVIEW_PENDING",
  "GROSS_PROFIT_PENDING",
  "INCENTIVE_PENDING",
  "INCENTIVE_FINALIZED",
  "CONSTRUCTION_UPCOMING",
  "APPLICATION_DEADLINE",
  "EVENT_PUBLISHED",
  "EVENT_PREFERENCE_DEADLINE",
  "EVENT_ASSIGNED",
  "EVENT_DAY_BEFORE",
  "CONTRACT_CONTRACTED",
  "SHIFT_ASSIGNED",
  "SHIFT_CHANGED",
  "REPORT_PENDING",
] as const;

// 「"use server"」ファイルは async function 以外を export 不可（Next.js 制約）。
// 以下のスキーマ・型は内部使用のみ。
const NotificationPreferenceItemSchema = z.object({
  type: z.enum(VALID_TYPES),
  channel: z.enum(ALLOWED_CHANNELS),
  enabled: z.boolean(),
});

const UpdateNotificationPreferencesSchema = z.object({
  preferences: z.array(NotificationPreferenceItemSchema).min(1),
});

type UpdateNotificationPreferencesInput = z.infer<
  typeof UpdateNotificationPreferencesSchema
>;

interface UpdateNotificationPreferencesResult {
  updatedCount: number;
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const updateNotificationPreferencesAction =
  withServerActionContext<
    UpdateNotificationPreferencesInput,
    UpdateNotificationPreferencesResult
  >(
    { action: "notification.update_preferences" },
    async ({ tx, ctx, input }) => {
      const { preferences } = UpdateNotificationPreferencesSchema.parse(input);

      await Promise.all(
        preferences.map((pref) =>
          tx.notificationPreference.upsert({
            where: {
              userId_type_channel: {
                userId: ctx.actorUserId,
                type: pref.type,
                channel: pref.channel,
              },
            },
            update: { enabled: pref.enabled },
            create: {
              userId: ctx.actorUserId,
              type: pref.type,
              channel: pref.channel,
              enabled: pref.enabled,
            },
          }),
        ),
      );

      return { updatedCount: preferences.length };
    },
  );

// ---------------------------------------------------------------------------
// Read helper (used by the settings page server component)
// ---------------------------------------------------------------------------

export const getNotificationPreferencesAction = withServerActionContext<
  Record<string, never>,
  Array<{ type: string; channel: AllowedChannel; enabled: boolean }>
>(
  { action: "notification.update_preferences" },
  async ({ tx, ctx }) => {
    const rows = await tx.notificationPreference.findMany({
      where: {
        userId: ctx.actorUserId,
        channel: { in: [...ALLOWED_CHANNELS] },
      },
      select: { type: true, channel: true, enabled: true },
    });

    return rows.map((r) => ({
      type: r.type as string,
      channel: r.channel as AllowedChannel,
      enabled: r.enabled,
    }));
  },
);
