// S-048 — 卸業者 月次報告一覧 (T-06-07 / F-048 / docs/04 §1.3).
//
// wholesaler_admin / wholesaler_event_team が閲覧可。
// 年月選択（YYYY-MM）と scope タブ（ALL / SELF / DEALER / JOINT）でフィルタ。
// 各行: 対象月, 体制区分, ステータスバッジ, 契約数, 売上, 粗利, インセンティブ。

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import type { MonthlyScope } from "@solar/db";

import { listMonthlyReports } from "./data";
import { RunAggregateForm } from "./run-aggregate-form";

export const dynamic = "force-dynamic";

const SCOPES: MonthlyScope[] = ["ALL", "SELF", "DEALER", "JOINT"];

interface PageProps {
  searchParams: Promise<{
    targetMonth?: string;
    scope?: string;
  }>;
}

export default async function MonthlyReportListPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const scope = SCOPES.includes(params.scope as MonthlyScope)
    ? (params.scope as MonthlyScope)
    : undefined;
  const targetMonth = params.targetMonth ?? undefined;

  const result = await listMonthlyReports({ scope, targetMonth });

  const t = labels.monthlyReport;
  const c = labels.common;

  function filterUrl(updates: Record<string, string | undefined>) {
    const sp = new URLSearchParams();
    const merged = {
      targetMonth: targetMonth ?? "",
      scope: scope ?? "",
      ...updates,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v) sp.set(k, v);
    }
    return `/monthly-reports?${sp.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.listTitle}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t.listSubtitle}</p>
        </div>
        <RunAggregateForm />
      </div>

      {/* Filter bar */}
      <form method="get" className="flex flex-wrap items-center gap-2">
        <Input
          type="month"
          name="targetMonth"
          defaultValue={targetMonth ?? ""}
          aria-label={t.targetMonthLabel}
          className="w-40"
        />
        <select
          name="scope"
          defaultValue={scope ?? ""}
          aria-label={t.scopeLabel}
          className="border-input bg-background ring-offset-background focus-visible:ring-ring h-10 rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          <option value="">{t.allScopes}</option>
          {SCOPES.map((s) => (
            <option key={s} value={s}>
              {t.scopes[s]}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          {t.filterApply}
        </Button>
        {(targetMonth || scope) && (
          <Button asChild variant="ghost" size="sm">
            <Link href="/monthly-reports">{c.cancel}</Link>
          </Button>
        )}
      </form>

      {/* Scope tabs */}
      <div className="flex gap-1 border-b border-border">
        <Link
          href={filterUrl({ scope: undefined })}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            !scope
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.allTab}
        </Link>
        {SCOPES.map((s) => (
          <Link
            key={s}
            href={filterUrl({ scope: s })}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              scope === s
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.scopes[s]}
          </Link>
        ))}
      </div>

      {/* Table */}
      {result.items.length === 0 ? (
        <div className="border-border bg-muted/30 rounded-md border p-8 text-center">
          <p className="text-foreground font-medium">{t.empty}</p>
          <p className="text-muted-foreground mt-2 text-sm">{t.emptyCta}</p>
        </div>
      ) : (
        <div className="border-border overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{t.fields.targetMonth}</th>
                <th className="px-3 py-2 font-medium">{t.fields.scope}</th>
                <th className="px-3 py-2 font-medium">{t.fields.status}</th>
                <th className="px-3 py-2 font-medium text-right">{t.fields.contractCount}</th>
                <th className="px-3 py-2 font-medium text-right">{t.fields.totalSales}</th>
                <th className="px-3 py-2 font-medium text-right">{t.fields.totalGrossProfit}</th>
                <th className="px-3 py-2 font-medium text-right">{t.fields.totalIncentive}</th>
                <th className="px-3 py-2 font-medium">{c.actions}</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((row) => (
                <tr key={row.id} className="border-border border-t hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium tabular-nums">{row.targetMonth}</td>
                  <td className="px-3 py-2">{t.scopes[row.scope] ?? row.scope}</td>
                  <td className="px-3 py-2">
                    <span className={t.statusBadgeClass[row.status] ?? "text-foreground"}>
                      {t.statuses[row.status] ?? row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.contractCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.totalSales.toLocaleString("ja-JP")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.totalGrossProfit.toLocaleString("ja-JP")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.totalIncentive.toLocaleString("ja-JP")}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/monthly-reports/${row.id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {t.viewDetail}
                    </Link>
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
