"use client";

// NotificationSettingsForm — client component for S-080.
//
// Renders a type × channel checkbox matrix. Rows = notification types,
// columns = IN_APP / EMAIL. LINE column is shown but disabled (Phase 2).
// On submit, all rows are sent to the Server Action as an upsert batch.

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { labels } from "@/lib/i18n/labels";
import { Button } from "@/components/ui/button";

import { updateNotificationPreferencesAction } from "./actions";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOTIFICATION_TYPES = [
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

type NotificationType = (typeof NOTIFICATION_TYPES)[number];
type ActiveChannel = "IN_APP" | "EMAIL";

type PrefKey = `${NotificationType}:${ActiveChannel}`;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InitialPref {
  type: string;
  channel: ActiveChannel;
  enabled: boolean;
}

interface Props {
  initialPrefs: InitialPref[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const LINE_FEATURE_ENABLED = process.env.NEXT_PUBLIC_FEATURE_LINE_NOTIFICATIONS === "true";

export function NotificationSettingsForm({ initialPrefs }: Props) {
  const [prefs, setPrefs] = useState<Map<PrefKey, boolean>>(() => {
    const map = new Map<PrefKey, boolean>();
    for (const p of initialPrefs) {
      if (p.channel === "IN_APP" || p.channel === "EMAIL") {
        map.set(`${p.type}:${p.channel}` as PrefKey, p.enabled);
      }
    }
    return map;
  });

  const [isPending, startTransition] = useTransition();

  function isEnabled(type: NotificationType, channel: ActiveChannel): boolean {
    return prefs.get(`${type}:${channel}` as PrefKey) ?? true;
  }

  function toggle(type: NotificationType, channel: ActiveChannel) {
    setPrefs((prev) => {
      const next = new Map(prev);
      const key = `${type}:${channel}` as PrefKey;
      next.set(key, !(prev.get(key) ?? true));
      return next;
    });
  }

  function handleSave() {
    startTransition(async () => {
      const preferences = NOTIFICATION_TYPES.flatMap((type) =>
        (["IN_APP", "EMAIL"] as ActiveChannel[]).map((channel) => ({
          type,
          channel,
          enabled: isEnabled(type, channel),
        })),
      );

      try {
        await updateNotificationPreferencesAction({ preferences });
        toast.success(labels.notificationSettings.savedToast);
      } catch {
        toast.error(labels.notificationSettings.errorToast);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium min-w-[220px]">
                {labels.notificationSettings.typeColumnHeader}
              </th>
              <th className="px-4 py-3 text-center font-medium whitespace-nowrap">
                {labels.notificationSettings.channelHeaders.IN_APP}
              </th>
              <th className="px-4 py-3 text-center font-medium whitespace-nowrap">
                {labels.notificationSettings.channelHeaders.EMAIL}
              </th>
              <th
                className="px-4 py-3 text-center font-medium whitespace-nowrap text-muted-foreground"
                title={labels.notificationSettings.lineDisabledNote}
              >
                {labels.notificationSettings.channelHeaders.LINE}
              </th>
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_TYPES.map((type, i) => (
              <tr
                key={type}
                className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}
              >
                <td className="px-4 py-2 font-medium">
                  {labels.notificationTypes[type]}
                </td>
                {(["IN_APP", "EMAIL"] as ActiveChannel[]).map((channel) => (
                  <td key={channel} className="px-4 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={isEnabled(type, channel)}
                      onChange={() => toggle(type, channel)}
                      aria-label={`${labels.notificationTypes[type]} ${labels.notificationSettings.channelHeaders[channel]}`}
                      className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
                    />
                  </td>
                ))}
                {/* LINE — Phase 2, always disabled until feature flag is active */}
                <td className="px-4 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={false}
                    disabled={!LINE_FEATURE_ENABLED}
                    readOnly
                    aria-label={`${labels.notificationTypes[type]} ${labels.notificationSettings.channelHeaders.LINE}`}
                    title={labels.notificationSettings.lineDisabledNote}
                    className="h-4 w-4 cursor-not-allowed rounded border-input opacity-40"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending
            ? labels.notificationSettings.saving
            : labels.notificationSettings.saveButton}
        </Button>
      </div>
    </div>
  );
}
