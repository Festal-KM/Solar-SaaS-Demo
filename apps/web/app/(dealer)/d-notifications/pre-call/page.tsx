// S-077 — F-037 二次店マエカク結果確認 (DEALER_ADMIN / DEALER_STAFF).
// マエカク結果通知一覧 + ステータスフィルタ + 確認ボタン。

import { Badge } from "@/components/ui/badge";
import { labels } from "@/lib/i18n/labels";

import type { PreCallNotificationStatus } from "@solar/db";

import { listDealerPreCallNotifications } from "./data";
import { AcknowledgeButton } from "./acknowledge-button";

export const dynamic = "force-dynamic";

const VALID_STATUSES: PreCallNotificationStatus[] = ["PENDING", "SENT", "ACKNOWLEDGED"];

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function DealerPreCallNotificationsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const statusFilter = VALID_STATUSES.includes(params.status as PreCallNotificationStatus)
    ? (params.status as PreCallNotificationStatus)
    : undefined;

  const notifications = await listDealerPreCallNotifications(statusFilter);

  const t = labels.dealerPreCallNotification;
  const tp = labels.preCall;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.subtitle}</p>
      </div>

      {/* Status filter */}
      <form method="get" className="flex flex-wrap items-center gap-2">
        <select
          name="status"
          defaultValue={statusFilter ?? ""}
          aria-label={t.filterByStatus}
          className="border-input bg-background ring-offset-background focus-visible:ring-ring h-10 rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          <option value="">{t.allStatuses}</option>
          {VALID_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.statuses[s]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="border-input bg-background ring-offset-background focus-visible:ring-ring inline-flex h-10 items-center rounded-md border px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          {labels.common.search}
        </button>
      </form>

      {notifications.length === 0 ? (
        <div className="border-border bg-muted/30 rounded-md border p-8 text-center">
          <p className="text-foreground font-medium">{t.empty}</p>
          <p className="text-muted-foreground mt-2 text-sm">{t.emptyCta}</p>
        </div>
      ) : (
        <div className="border-border overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{t.fields.customerName}</th>
                <th className="px-3 py-2 font-medium">{t.fields.scheduledAt}</th>
                <th className="px-3 py-2 font-medium">{t.fields.preCallResult}</th>
                <th className="px-3 py-2 font-medium">{t.fields.status}</th>
                <th className="px-3 py-2 font-medium">{t.fields.notifiedAt}</th>
                <th className="px-3 py-2 font-medium">{labels.common.actions}</th>
              </tr>
            </thead>
            <tbody>
              {notifications.map((n) => (
                <tr key={n.id} className="border-border border-t">
                  <td className="px-3 py-2 font-medium">{n.customerName}</td>
                  <td className="text-muted-foreground px-3 py-2 tabular-nums">
                    {new Date(n.scheduledAt).toLocaleString("ja-JP")}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="secondary" className="text-xs">
                      {tp.resultBadges[n.preCallResult]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={
                        n.status === "ACKNOWLEDGED"
                          ? "default"
                          : n.status === "SENT"
                            ? "outline"
                            : "secondary"
                      }
                      className="text-xs"
                    >
                      {t.statuses[n.status]}
                    </Badge>
                  </td>
                  <td className="text-muted-foreground px-3 py-2 text-xs tabular-nums">
                    {n.notifiedAt ? new Date(n.notifiedAt).toLocaleString("ja-JP") : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {n.status !== "ACKNOWLEDGED" && (
                      <AcknowledgeButton notificationId={n.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
