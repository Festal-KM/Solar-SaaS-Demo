// S-061 — 配属済みイベント一覧（二次店ビュー）(T-04-02 / F-027 / docs/04 §1.5 S-061).
//
// dealer_admin / dealer_staff が自社担当のイベントを閲覧する画面。
// data.ts が EventDealer.relationshipId IN ctx.relationshipIds でフィルタするため
// 他社担当のイベントは絶対に表示されない。

import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import { listDealerEvents } from "./data";

import type { EventStatus } from "@solar/db";

export const dynamic = "force-dynamic";

const VALID_STATUSES: EventStatus[] = ["PLANNED", "ONGOING", "CLOSED", "CANCELLED"];

function coerceStatus(value: string | undefined): EventStatus | undefined {
  if (!value) return undefined;
  return (VALID_STATUSES as readonly string[]).includes(value)
    ? (value as EventStatus)
    : undefined;
}

function coerceDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

interface PageProps {
  searchParams: Promise<{ status?: string; from?: string; to?: string }>;
}

export default async function DealerEventsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const status = coerceStatus(params.status);
  const from = coerceDate(params.from);
  const to = coerceDate(params.to);

  let rows;
  try {
    rows = await listDealerEvents({
      ...(status ? { status } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
  } catch {
    notFound();
  }

  const t = labels.eventDealer;
  const c = labels.common;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.listTitle}</p>
      </div>

      <form method="get" className="flex flex-wrap max-w-3xl items-center gap-2">
        <select
          name="status"
          defaultValue={status ?? ""}
          aria-label={t.filterByStatus}
          className="border-input bg-background flex h-10 rounded-md border px-3 py-2 text-sm"
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
          aria-label={t.filterByFrom}
          className="max-w-[180px]"
        />
        <span className="text-muted-foreground text-sm">〜</span>
        <Input
          type="date"
          name="to"
          defaultValue={to ?? ""}
          aria-label={t.filterByTo}
          className="max-w-[180px]"
        />
        <Button type="submit" variant="outline">
          {c.search}
        </Button>
      </form>

      {rows.length === 0 ? (
        <div className="border-border bg-muted/30 rounded-md border p-8 text-center">
          <p className="text-foreground font-medium">{t.empty}</p>
          <p className="text-muted-foreground mt-2 text-sm">{t.emptyCta}</p>
        </div>
      ) : (
        <div className="border-border overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{t.table.columns.store}</th>
                <th className="px-3 py-2 font-medium">{t.table.columns.scheduledDate}</th>
                <th className="px-3 py-2 font-medium">{t.table.columns.mode}</th>
                <th className="px-3 py-2 font-medium">{t.table.columns.status}</th>
                <th className="px-3 py-2 font-medium">{t.table.columns.scope}</th>
                <th className="px-3 py-2 font-medium">{t.table.columns.reports}</th>
                <th className="px-3 py-2 font-medium">{t.table.columns.actions}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-border border-t hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">
                    <Link
                      href={`/events/${r.id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {r.storeName}
                    </Link>
                    {r.area ? (
                      <span className="text-muted-foreground ml-1 text-xs">({r.area})</span>
                    ) : null}
                    {r.wholesalerName ? (
                      <p className="text-muted-foreground text-xs">{r.wholesalerName}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {new Date(r.scheduledDate).toLocaleDateString("ja-JP")}
                  </td>
                  <td className="px-3 py-2">{t.modes[r.mode]}</td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={
                        r.status === "PLANNED"
                          ? "secondary"
                          : r.status === "ONGOING"
                            ? "default"
                            : r.status === "CLOSED"
                              ? "outline"
                              : "destructive"
                      }
                    >
                      {t.statuses[r.status]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.scopeOverride
                      ? t.scopes[r.scopeOverride as keyof typeof t.scopes] ?? r.scopeOverride
                      : "—"}
                  </td>
                  <td className="px-3 py-2">{r.reportCount}</td>
                  <td className="px-3 py-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/events/${r.id}`}>{c.edit}</Link>
                    </Button>
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
