// S-037 — 卸業者側 商談一覧 (T-05-03 / F-038 / docs/04 §1.3).
//
// 卸業者全ロール（admin / direct_sales / call_team）が商談一覧を閲覧・検索。
// ステータスフィルタ付き。ページネーション。

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import type { DealStatus } from "@solar/db";

import { listDeals } from "./data";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    status?: string;
    from?: string;
    to?: string;
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

export default async function WholesalerDealListPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const status = VALID_STATUSES.includes(params.status as DealStatus)
    ? (params.status as DealStatus)
    : undefined;
  const from = params.from ?? undefined;
  const to = params.to ?? undefined;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const result = await listDeals({ status, from, to, page });

  const t = labels.deal;
  const c = labels.common;

  function pageUrl(p: number): string {
    const sp = new URLSearchParams();
    if (status) sp.set("status", status);
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    sp.set("page", String(p));
    return `/deals?${sp.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.listTitle}</h1>
        </div>
      </div>

      {/* Filter bar */}
      <form method="get" className="flex flex-wrap items-center gap-2">
        <select
          name="status"
          defaultValue={status ?? ""}
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
        <Input
          type="date"
          name="from"
          defaultValue={from ?? ""}
          aria-label={t.filterFrom}
          className="w-40"
        />
        <Input
          type="date"
          name="to"
          defaultValue={to ?? ""}
          aria-label={t.filterTo}
          className="w-40"
        />
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
                  <th className="px-3 py-2 font-medium">{t.fields.ownerType}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.expectedContractDate}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.createdAt}</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((row) => (
                  <tr key={row.id} className="border-border border-t">
                    <td className="px-3 py-2">
                      <Link
                        href={`/deals/${row.id}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {row.customerName}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{t.statuses[row.status]}</td>
                    <td className="px-3 py-2">{t.ownerTypes[row.ownerType]}</td>
                    <td className="text-muted-foreground px-3 py-2">
                      {row.expectedContractDate
                        ? new Date(row.expectedContractDate).toLocaleDateString("ja-JP")
                        : "—"}
                    </td>
                    <td className="text-muted-foreground px-3 py-2 text-xs">
                      {new Date(row.createdAt).toLocaleDateString("ja-JP")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <Button asChild variant="outline" size="sm" disabled={page <= 1}>
                <Link href={pageUrl(page - 1)}>{t.pagination.prev}</Link>
              </Button>
              <span className="text-muted-foreground text-sm">
                {t.pagination.pageOf
                  .replace("{page}", String(page))
                  .replace("{total}", String(result.totalPages))}
              </span>
              <Button asChild variant="outline" size="sm" disabled={page >= result.totalPages}>
                <Link href={pageUrl(page + 1)}>{t.pagination.next}</Link>
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
