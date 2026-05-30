// S-039 — 二次店商談・クロージング報告一覧 (T-05-04 / F-039 / docs/04 §1.3).
//
// 卸業者 (wholesaler_admin / wholesaler_direct_sales) 専用。
// 二次店所有商談を月・二次店・ステータスで絞込み一覧表示。
// 契約見込み行を強調。「商談詳細へ」で S-038 に遷移。

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import type { DealStatus } from "@solar/db";

import { listDealReports } from "./data";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    status?: string;
    ownerRelationshipId?: string;
    targetMonth?: string;
    page?: string;
  }>;
}

const VALID_STATUSES: DealStatus[] = [
  "VISIT_PLANNED",
  "VISITED",
  "PROPOSING",
  "QUOTED",
  "CONSIDERING",
  "LIKELY_CONTRACT",
  "CONTRACTED",
  "LOST",
];

export default async function DealerReportsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const status = VALID_STATUSES.includes(params.status as DealStatus)
    ? (params.status as DealStatus)
    : undefined;
  const ownerRelationshipId = params.ownerRelationshipId ?? undefined;
  const targetMonth = params.targetMonth ?? undefined;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const result = await listDealReports({ status, ownerRelationshipId, targetMonth, page });

  const t = labels.dealReport;
  const d = labels.deal;
  const c = labels.common;

  function pageUrl(p: number): string {
    const sp = new URLSearchParams();
    if (status) sp.set("status", status);
    if (ownerRelationshipId) sp.set("ownerRelationshipId", ownerRelationshipId);
    if (targetMonth) sp.set("targetMonth", targetMonth);
    sp.set("page", String(p));
    return `/deals/dealer-reports?${sp.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.listTitle}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t.subtitle}</p>
      </div>

      {/* Filter bar */}
      <form method="get" className="flex flex-wrap items-center gap-2">
        <Input
          type="month"
          name="targetMonth"
          defaultValue={targetMonth ?? ""}
          aria-label={t.filterByMonth}
          className="w-40"
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          aria-label={d.filterByStatus}
          className="border-input bg-background ring-offset-background focus-visible:ring-ring h-10 rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          <option value="">{d.allStatuses}</option>
          {VALID_STATUSES.map((s) => (
            <option key={s} value={s}>
              {d.statuses[s]}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          {c.search}
        </Button>
      </form>

      {result.items.length === 0 ? (
        <div className="border-border bg-muted/30 rounded-md border p-8 text-center">
          <p className="text-foreground font-medium">{t.empty}</p>
          <p className="text-muted-foreground mt-2 text-sm">{t.emptyCta}</p>
        </div>
      ) : (
        <>
          <div className="border-border overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">{t.fields.customer}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.status}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.dealer}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.updatedAt}</th>
                  <th className="px-3 py-2 font-medium">{c.actions}</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-border border-t${row.status === "LIKELY_CONTRACT" ? " bg-amber-50 dark:bg-amber-950/20" : ""}`}
                  >
                    <td className="px-3 py-2">{row.customerName}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          row.status === "LIKELY_CONTRACT"
                            ? "text-amber-700 font-semibold dark:text-amber-400"
                            : undefined
                        }
                      >
                        {d.statuses[row.status]}
                      </span>
                    </td>
                    <td className="text-muted-foreground px-3 py-2">
                      {row.dealerName ?? "—"}
                    </td>
                    <td className="text-muted-foreground px-3 py-2 text-xs">
                      {new Date(row.updatedAt).toLocaleDateString("ja-JP")}
                    </td>
                    <td className="px-3 py-2">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/deals/${row.id}`}>{t.goToDetail}</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <Button asChild variant="outline" size="sm" disabled={page <= 1}>
                <Link href={pageUrl(page - 1)}>{d.pagination.prev}</Link>
              </Button>
              <span className="text-muted-foreground text-sm">
                {d.pagination.pageOf
                  .replace("{page}", String(page))
                  .replace("{total}", String(result.totalPages))}
              </span>
              <Button asChild variant="outline" size="sm" disabled={page >= result.totalPages}>
                <Link href={pageUrl(page + 1)}>{d.pagination.next}</Link>
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
