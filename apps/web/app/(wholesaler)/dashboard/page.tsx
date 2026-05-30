import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { Card } from "@/components/ui/card";
import { labels } from "@/lib/i18n/labels";

import { getDashboardSummary } from "./data";
import { SalesTrendChart } from "./sales-trend-chart";

export const dynamic = "force-dynamic";

const t = labels.dashboard;

function fmt(yen: number | null) {
  if (yen == null) return "—";
  return `¥${yen.toLocaleString("ja-JP")}`;
}

export default async function WholesalerDashboardPage() {
  const session = await auth();
  if (session?.user?.isSaasAdmin) {
    redirect("/saas-admin-dashboard");
  }

  const summary = await getDashboardSummary();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">{t.title}</h1>
        <p className="text-body-light text-sm mt-1">{t.subtitle}</p>
      </div>

      {/* ── KPI Cards (5 items) ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {/* 1. 今月の契約件数 */}
        <Card className="p-6">
          <p className="text-mute-light text-xs font-medium uppercase tracking-wider">{t.kpi.contractCount}</p>
          <p className="text-ink text-3xl font-semibold tabular-nums mt-2">
            {summary.monthlySummary.contractCount ?? "—"}
            <span className="text-body-light text-sm font-normal ml-1">{t.kpi.countUnit}</span>
          </p>
          <p className="text-mute-light text-xs mt-2">
            {t.kpi.prevMonth}: {summary.monthlySummary.prevContractCount ?? "—"}{t.kpi.countUnit}
            {summary.monthlySummary.contractCountDiff != null && (
              <span className={summary.monthlySummary.contractCountDiff >= 0 ? "text-emerald-600 ml-1" : "text-warning ml-1"}>
                ({summary.monthlySummary.contractCountDiff >= 0 ? "+" : ""}{summary.monthlySummary.contractCountDiff})
              </span>
            )}
          </p>
        </Card>

        {/* 2. 今月の売上 / 粗利 */}
        <Card className="p-6">
          <p className="text-mute-light text-xs font-medium uppercase tracking-wider">{t.kpi.revenueGrossProfit}</p>
          <p className="text-ink text-2xl font-semibold tabular-nums mt-2">{fmt(summary.monthlySummary.revenueYen)}</p>
          <p className="text-body-light text-xs mt-1">
            {t.kpi.grossProfitLabel}: <span className="font-medium text-ink">{fmt(summary.monthlySummary.grossProfitYen)}</span>
          </p>
          <p className="text-mute-light text-xs mt-2">
            {t.kpi.prevMonth}: {fmt(summary.monthlySummary.prevRevenueYen)}
          </p>
        </Card>

        {/* 3. 今週のイベント開催件数 */}
        <Card className="p-6">
          <p className="text-mute-light text-xs font-medium uppercase tracking-wider">{t.kpi.weeklyEvents}</p>
          <p className="text-ink text-3xl font-semibold tabular-nums mt-2">
            {summary.weeklyEvents.count}
            <span className="text-body-light text-sm font-normal ml-1">{t.kpi.countUnit}</span>
          </p>
          <p className="text-mute-light text-xs mt-2">{t.kpi.weeklyEventsHint}</p>
        </Card>

        {/* 4. 今週のアポ件数（実績 & 見込み） */}
        <Card className="p-6">
          <p className="text-mute-light text-xs font-medium uppercase tracking-wider">{t.kpi.weeklyAppointments}</p>
          <p className="text-ink text-3xl font-semibold tabular-nums mt-2">
            {summary.weeklyAppointments.completedCount + summary.weeklyAppointments.scheduledCount}
            <span className="text-body-light text-sm font-normal ml-1">{t.kpi.countUnit}</span>
          </p>
          <p className="text-body-light text-xs mt-2">
            {t.kpi.appointmentCompleted}: <span className="font-medium text-ink">{summary.weeklyAppointments.completedCount}</span>
            　{t.kpi.appointmentScheduled}: <span className="font-medium text-ink">{summary.weeklyAppointments.scheduledCount}</span>
          </p>
        </Card>

        {/* 5. 通知 / アラート (latest 5) */}
        <Card className="p-6 sm:col-span-2 xl:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <p className="text-mute-light text-xs font-medium uppercase tracking-wider">{t.kpi.notificationsAlert}</p>
            {summary.notifications.unreadCount > 0 && (
              <span className="badge badge-primary">{t.kpi.unreadCount.replace("{n}", String(summary.notifications.unreadCount))}</span>
            )}
          </div>
          {summary.notifications.latest.length === 0 ? (
            <p className="text-mute-light text-sm">{t.kpi.noNotifications}</p>
          ) : (
            <ul className="space-y-2">
              {summary.notifications.latest.map((n) => (
                <li key={n.id} className="flex items-start gap-2">
                  <span className={["mt-1.5 h-1.5 w-1.5 rounded-full shrink-0", n.readAt ? "bg-ash-light" : "bg-primary"].join(" ")} />
                  <div className="min-w-0">
                    <p className="text-ink text-sm font-medium truncate">{n.title}</p>
                    <p className="text-mute-light text-xs truncate">{n.body}</p>
                  </div>
                  <span className="shrink-0 text-mute-light text-xs ml-auto">{n.createdAt}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 pt-3 border-t border-hairline-light">
            <Link href="/notifications" className="text-xs text-link-light hover:underline underline-offset-4">
              {t.sections.notificationStatus.viewAll}
            </Link>
          </div>
        </Card>
      </div>

      {/* ── 売上推移グラフ (full width) ── */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline-light">
          <h2 className="text-sm font-medium text-ink">{t.sections.salesTrend.title}</h2>
          <Link href="/bi" className="text-xs text-link-light hover:underline underline-offset-4">
            {t.sections.salesTrend.viewDetail}
          </Link>
        </div>
        <div className="px-6 py-6">
          <SalesTrendChart data={summary.salesTrend} />
        </div>
      </Card>

      {/* ── 今週末のイベント一覧 (full width) ── */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline-light">
          <h2 className="text-sm font-medium text-ink">{t.sections.weekendEvents.title}</h2>
          <Link href="/events" className="text-xs text-link-light hover:underline underline-offset-4">
            {t.sections.recentEvents.viewAll}
          </Link>
        </div>
        {summary.weekendEvents.length === 0 ? (
          <div className="px-6 py-10 text-center text-mute-light text-sm">
            {t.sections.weekendEvents.empty}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline-light bg-surface-soft/50">
                  <th className="px-6 py-3 text-left text-xs font-medium text-mute-light uppercase tracking-wider">{t.sections.weekendEvents.cols.date}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-mute-light uppercase tracking-wider">{t.sections.weekendEvents.cols.name}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-mute-light uppercase tracking-wider">{t.sections.weekendEvents.cols.venue}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-mute-light uppercase tracking-wider">{t.sections.weekendEvents.cols.mode}</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-mute-light uppercase tracking-wider">{t.sections.weekendEvents.cols.dealers}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline-light">
                {summary.weekendEvents.map((ev) => (
                  <tr key={ev.id} className="hover:bg-surface-soft/30 transition-colors">
                    <td className="px-6 py-3 tabular-nums text-body-light whitespace-nowrap">{ev.date}</td>
                    <td className="px-6 py-3">
                      <Link href={`/events/${ev.id}`} className="text-link-light hover:underline underline-offset-4 font-medium">
                        {ev.name}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-body-light truncate max-w-xs">{ev.venue}</td>
                    <td className="px-6 py-3 text-body-light">{ev.mode}</td>
                    <td className="px-6 py-3 text-right tabular-nums text-body-light">{ev.dealerCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
