// S-067 — 二次店側 商談一覧 (T-05-03 / F-038 / docs/04 §1.5).
//
// 二次店メンバは自社が関与する商談のみ閲覧できる。
// スコープ (canUpdate / canClose) に応じた操作制限をバッジで表示する。
// APPOINTMENT_ONLY の二次店は更新不可（ readonly バッジを表示）。

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import type { DealStatus } from "@solar/db";

import { listDealerDeals } from "./data";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    status?: string;
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

export default async function DealerDealListPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const status = VALID_STATUSES.includes(params.status as DealStatus)
    ? (params.status as DealStatus)
    : undefined;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const result = await listDealerDeals({ status, page });

  const t = labels.deal;
  const c = labels.common;

  function pageUrl(p: number): string {
    const sp = new URLSearchParams();
    if (status) sp.set("status", status);
    sp.set("page", String(p));
    return `/deals?${sp.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.listTitle}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t.dealerSubtitle}</p>
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
                  <th className="px-3 py-2 font-medium">{t.fields.expectedContractDate}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.createdAt}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.scopeCapability}</th>
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
                    <td className="text-muted-foreground px-3 py-2">
                      {row.expectedContractDate
                        ? new Date(row.expectedContractDate).toLocaleDateString("ja-JP")
                        : "—"}
                    </td>
                    <td className="text-muted-foreground px-3 py-2 text-xs">
                      {new Date(row.createdAt).toLocaleDateString("ja-JP")}
                    </td>
                    <td className="px-3 py-2">
                      {!row.canUpdate ? (
                        <span className="text-muted-foreground text-xs">
                          {t.scopeCapabilities.readOnly}
                        </span>
                      ) : !row.canClose ? (
                        <span className="text-xs">{t.scopeCapabilities.visitOnly}</span>
                      ) : (
                        <span className="text-xs">{t.scopeCapabilities.fullClosing}</span>
                      )}
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
