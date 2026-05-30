// S-065 — 二次店 契約一覧 (T-05-09 / F-040 / docs/04 §1.5).
//
// 二次店ロール (dealer_admin / dealer_staff) が閲覧可能。
// ownerRelationshipId が自テナントの関係に属する契約のみ表示。
// 仕入値・施工費・卸業者内部情報は非表示。

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import type { ContractStatus } from "@solar/db";

import { listDealerContracts } from "./data";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    status?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}

const VALID_STATUSES: ContractStatus[] = ["CONTRACTED", "CONSTRUCTING", "DONE", "CANCELLED"];

export default async function DealerContractListPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const status = VALID_STATUSES.includes(params.status as ContractStatus)
    ? (params.status as ContractStatus)
    : undefined;
  const from = params.from ?? undefined;
  const to = params.to ?? undefined;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const result = await listDealerContracts({ status, from, to, page });

  const t = labels.dealerContract;
  const c = labels.common;

  function pageUrl(p: number): string {
    const sp = new URLSearchParams();
    if (status) sp.set("status", status);
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    sp.set("page", String(p));
    return `/contracts?${sp.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t.listTitle}</h1>
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
                  <th className="px-3 py-2 font-medium">{t.fields.contractDate}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.totalAmount}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.cancelDeadline}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.status}</th>
                  <th className="px-3 py-2 font-medium">{c.actions}</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((row) => (
                  <tr key={row.id} className="border-border border-t">
                    <td className="px-3 py-2 font-medium">{row.customerName}</td>
                    <td className="text-muted-foreground px-3 py-2">
                      {new Date(row.contractDate).toLocaleDateString("ja-JP")}
                    </td>
                    <td className="px-3 py-2">
                      {Number(row.contractAmount).toLocaleString("ja-JP")} {c.currencySuffix}
                    </td>
                    <td className="text-muted-foreground px-3 py-2">
                      {new Date(row.cancelDeadline).toLocaleDateString("ja-JP")}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          row.status === "CANCELLED" ? "text-destructive" : "text-foreground"
                        }
                      >
                        {t.statuses[row.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/contracts/${row.id}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {c.edit}
                      </Link>
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
