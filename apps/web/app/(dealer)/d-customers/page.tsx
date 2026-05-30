// S-064 — 二次店側 顧客一覧・検索 (T-04-07 / F-032 / docs/04 §1.5).
//
// Dealer sees ONLY customers in their own relationships.
// PII masking is applied by listDealerCustomers() via the dealer ViewerContext.

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import type { AcquisitionChannel, CustomerStatus } from "@solar/db";

import { listDealerCustomers } from "./data";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    query?: string;
    status?: string;
    channel?: string;
    page?: string;
  }>;
}

const VALID_STATUSES: CustomerStatus[] = [
  "NEW",
  "PRE_CALL_WAIT",
  "PRE_CALL_DONE",
  "VISIT_PLANNED",
  "IN_NEGOTIATION",
  "CONTRACTED",
  "LOST",
  "IN_CONSTRUCTION",
  "COMPLETED",
];

const VALID_CHANNELS: AcquisitionChannel[] = [
  "EVENT",
  "WALK_IN",
  "TELE",
  "REFERRAL",
  "OTHER",
];

export default async function DealerCustomerListPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = params.query?.trim() ?? "";
  const status = VALID_STATUSES.includes(params.status as CustomerStatus)
    ? (params.status as CustomerStatus)
    : undefined;
  const channel = VALID_CHANNELS.includes(params.channel as AcquisitionChannel)
    ? (params.channel as AcquisitionChannel)
    : undefined;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const result = await listDealerCustomers({ query, status, channel, page });

  const t = labels.customer;
  const c = labels.common;

  function pageUrl(p: number): string {
    const sp = new URLSearchParams();
    if (query) sp.set("query", query);
    if (status) sp.set("status", status);
    if (channel) sp.set("channel", channel);
    sp.set("page", String(p));
    return `/customers?${sp.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.listTitle}</h1>
        </div>
        <Button asChild>
          <Link href="/customers/new">{t.new}</Link>
        </Button>
      </div>

      {/* Search / filter bar */}
      <form method="get" className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          name="query"
          defaultValue={query}
          placeholder={t.searchPlaceholder}
          aria-label={t.searchPlaceholder}
          className="w-64"
        />
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
        <select
          name="channel"
          defaultValue={channel ?? ""}
          aria-label={t.filterByChannel}
          className="border-input bg-background ring-offset-background focus-visible:ring-ring h-10 rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          <option value="">{t.allChannels}</option>
          {VALID_CHANNELS.map((ch) => (
            <option key={ch} value={ch}>
              {t.channels[ch]}
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
          <Button asChild className="mt-4">
            <Link href="/customers/new">{t.new}</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="border-border overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">{t.fields.name}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.phone}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.address}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.channel}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.status}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.createdAt}</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((row) => (
                  <tr key={row.id} className="border-border border-t">
                    <td className="px-3 py-2">
                      <Link
                        href={`/customers/${row.id}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{row.phone}</td>
                    <td className="text-muted-foreground px-3 py-2">{row.address ?? "—"}</td>
                    <td className="px-3 py-2">{t.channels[row.channel]}</td>
                    <td className="px-3 py-2">{t.statuses[row.status]}</td>
                    <td className="text-muted-foreground px-3 py-2 text-xs">
                      {new Date(row.createdAt).toLocaleDateString("ja-JP")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
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
