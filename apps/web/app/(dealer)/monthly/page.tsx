// S-069 — 二次店 成績確認 (T-06-10 / F-051 / docs/04 §1.5).
//
// dealer_admin / dealer_staff が自社 relationship の月次成績を卸業者ごとに確認する。
// 仕入値 (purchaseTotal / wholesaleProfit) は表示しない (CLAUDE.md rule #5)。

import "server-only";

import { labels } from "@/lib/i18n/labels";

import { listDealerMonthlyPerformance } from "./data";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DealerMonthlyPage({ searchParams }: Props) {
  const sp = await searchParams;
  const targetMonth = typeof sp["month"] === "string" ? sp["month"] : undefined;

  const result = await listDealerMonthlyPerformance({ targetMonth });

  const t = labels.dealerPerformance;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t.subtitle}</p>
      </div>

      {/* Month filter */}
      <form method="GET" className="flex items-center gap-2">
        <label className="text-sm font-medium" htmlFor="month-input">
          {t.filterLabel}
        </label>
        <input
          id="month-input"
          name="month"
          type="month"
          defaultValue={targetMonth ?? ""}
          className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring h-9 rounded-md border px-3 py-1 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          placeholder={t.filterPlaceholder}
        />
        <button
          type="submit"
          className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-md px-3 text-sm font-medium"
        >
          {t.filterApply}
        </button>
      </form>

      {result.items.length === 0 ? (
        <div className="border-border bg-muted/30 rounded-md border p-8 text-center">
          <p className="text-foreground font-medium">{t.empty}</p>
          <p className="text-muted-foreground mt-2 text-sm">{t.emptyCta}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {result.items.map((item) => {
            const statusLabel = t.statuses[item.status] ?? item.status;

            return (
              <div
                key={item.id}
                className="border-border rounded-md border p-4"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <p className="font-semibold tabular-nums">{item.targetMonth}</p>
                    <p className="text-muted-foreground text-xs">
                      {t.wholesalerLabel}: {item.wholesalerId}
                    </p>
                  </div>
                  <span className="text-sm font-medium">{statusLabel}</span>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground text-xs">{t.fields.contractCount}</dt>
                    <dd className="font-medium tabular-nums">
                      {item.contractCount != null
                        ? `${item.contractCount}${t.countSuffix}`
                        : t.noData}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">{t.fields.totalSales}</dt>
                    <dd className="font-medium tabular-nums">
                      {item.totalSales != null
                        ? `${Number(item.totalSales).toLocaleString("ja-JP")}${t.currencySuffix}`
                        : t.noData}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">{t.fields.totalIncentive}</dt>
                    <dd className="font-medium tabular-nums">
                      {item.totalIncentive != null
                        ? `${Number(item.totalIncentive).toLocaleString("ja-JP")}${t.currencySuffix}`
                        : t.noData}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">{t.fields.averageProfitRate}</dt>
                    <dd className="font-medium tabular-nums">
                      {item.averageProfitRate != null
                        ? `${Number(item.averageProfitRate).toFixed(1)}${t.percentSuffix}`
                        : t.noData}
                    </dd>
                  </div>
                </dl>

                {item.finalizedAt && (
                  <p className="text-muted-foreground mt-3 text-xs">
                    {t.fields.status}: {new Date(item.finalizedAt).toLocaleDateString("ja-JP")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
