import Link from "next/link";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { getSaasAdminDashboardSummary } from "../tenants/data";

// S-013 — 運営者ダッシュボード (T-02-08 / F-004 placeholder for F-005 + F-055).
// 監査ログプレビュー / 直近作成テナント詳細リンクは SP-07 / T-02-09 で拡張する。

export const dynamic = "force-dynamic";

export default async function SaasAdminDashboardPage() {
  const summary = await getSaasAdminDashboardSummary();
  const t = labels.saasAdminTenant;

  const cards = [
    { key: "totalTenants", label: t.summaryCards.totalTenants, value: summary.totalTenants },
    { key: "activeTenants", label: t.summaryCards.activeTenants, value: summary.activeTenants },
    { key: "totalUsers", label: t.summaryCards.totalUsers, value: summary.totalActiveUsers },
    {
      key: "pendingInvitations",
      label: t.summaryCards.pendingInvitations,
      value: summary.pendingInvitations,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.dashboardTitle}</h1>
          <p className="text-muted-foreground text-sm">{t.dashboardSubtitle}</p>
        </div>
        <Button asChild>
          <Link href="/tenants/new">{t.new}</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.key}
            href="/tenants"
            className="border-border bg-card hover:bg-muted/40 rounded-md border p-4 transition-colors"
          >
            <p className="text-muted-foreground text-xs">{card.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{card.value}</p>
          </Link>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t.listTitle}</h2>
        {summary.recentTenants.length === 0 ? (
          <div className="border-border bg-muted/30 rounded-md border p-6 text-center">
            <p className="text-foreground font-medium">{t.empty}</p>
            <p className="text-muted-foreground mt-2 text-sm">{t.emptyCta}</p>
            <Button asChild className="mt-4">
              <Link href="/tenants/new">{t.new}</Link>
            </Button>
          </div>
        ) : (
          <div className="border-border overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">{t.fields.name}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.type}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.plan}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.status}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.userCount}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.createdAt}</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentTenants.map((r) => (
                  <tr key={r.id} className="border-border border-t">
                    <td className="px-3 py-2">
                      <Link
                        href={`/tenants/${r.id}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{t.types[r.type]}</td>
                    <td className="px-3 py-2">{r.plan ? t.plans[r.plan] : "—"}</td>
                    <td className="px-3 py-2">{t.statuses[r.status]}</td>
                    <td className="px-3 py-2 tabular-nums">{r.userCount}</td>
                    <td className="text-muted-foreground px-3 py-2 text-xs">
                      {new Date(r.createdAt).toLocaleString("ja-JP")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
