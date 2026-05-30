// S-074 / S-075 — 二次店側 アポ一覧 (T-04-08 / F-034 / docs/04 §1.5).
//
// Dealer sees only appointments acquired by their own relationship IDs.
// GET-form filters: status / from / to / page.

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import type { AppointmentStatus } from "@solar/db";

import { listDealerAppointments } from "./data";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    status?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}

const VALID_STATUSES: AppointmentStatus[] = [
  "UNCONFIRMED",
  "PRE_CALL_DONE",
  "VISITED",
  "ABSENT",
  "CANCELLED",
  "RESCHEDULED",
];

export default async function DealerAppointmentListPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const status = VALID_STATUSES.includes(params.status as AppointmentStatus)
    ? (params.status as AppointmentStatus)
    : undefined;
  const from = params.from ?? "";
  const to = params.to ?? "";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const result = await listDealerAppointments({
    status,
    from: from || undefined,
    to: to || undefined,
    page,
  });

  const t = labels.appointment;
  const c = labels.common;

  function pageUrl(p: number): string {
    const sp = new URLSearchParams();
    if (status) sp.set("status", status);
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    sp.set("page", String(p));
    return `/d-appointments?${sp.toString()}`;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t.listTitle}</h1>

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
          defaultValue={from}
          aria-label={t.filterByFrom}
          className="w-40"
        />
        <Input
          type="date"
          name="to"
          defaultValue={to}
          aria-label={t.filterByTo}
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
                  <th className="px-3 py-2 font-medium">{t.fields.customerId}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.scheduledAt}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.status}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.createdAt}</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((row) => (
                  <tr key={row.id} className="border-border border-t">
                    <td className="px-3 py-2">{row.customerName}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {new Date(row.scheduledAt).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2">{t.statuses[row.status]}</td>
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
