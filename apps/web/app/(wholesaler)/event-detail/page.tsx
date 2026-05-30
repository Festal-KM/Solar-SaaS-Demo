import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import { listEventCandidates } from "./data";

import type { EventCandidateStatus } from "@solar/contracts";

// S-023 — イベント候補一覧 (F-018 / F-019 / docs/04 §1.3 §S-023).
//
// 卸業者本部 (wholesaler_admin / wholesaler_event_team) のみアクセス可。
// data.ts の `assertCan('event_candidate.read')` でロール検証 → RLS で
// テナント分離 → 二次店ロールは 403。

export const dynamic = "force-dynamic";

const VALID_STATUSES: EventCandidateStatus[] = ["DRAFT", "OPEN", "CLOSED", "DECIDED", "CANCELLED"];

function coerceStatus(value: string | undefined): EventCandidateStatus | undefined {
  if (!value) return undefined;
  return (VALID_STATUSES as readonly string[]).includes(value)
    ? (value as EventCandidateStatus)
    : undefined;
}

function coerceTargetMonth(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : undefined;
}

interface PageProps {
  searchParams: Promise<{ status?: string; targetMonth?: string }>;
}

export default async function EventCandidatesListPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const status = coerceStatus(params.status);
  const targetMonth = coerceTargetMonth(params.targetMonth);

  const rows = await listEventCandidates({
    ...(status ? { status } : {}),
    ...(targetMonth ? { targetMonth } : {}),
  });

  const t = labels.eventCandidate;
  const c = labels.common;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-muted-foreground text-sm">{t.listTitle}</p>
        </div>
        <Button asChild>
          <Link href="/event-detail/new">{t.new}</Link>
        </Button>
      </div>

      <form method="get" className="flex max-w-2xl items-center gap-2">
        <Input
          type="text"
          name="targetMonth"
          defaultValue={targetMonth ?? ""}
          placeholder="2026-06"
          aria-label={t.filterByTargetMonth}
        />
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
        <Button type="submit" variant="outline">
          {c.search}
        </Button>
      </form>

      {rows.length === 0 ? (
        <div className="border-border bg-muted/30 rounded-md border p-8 text-center">
          <p className="text-foreground font-medium">{t.empty}</p>
          <p className="text-muted-foreground mt-2 text-sm">{t.emptyCta}</p>
          <Button asChild className="mt-4">
            <Link href="/event-detail/new">{t.new}</Link>
          </Button>
        </div>
      ) : (
        <div className="border-border overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{t.fields.targetMonth}</th>
                <th className="px-3 py-2 font-medium">{t.fields.scheduledDate}</th>
                <th className="px-3 py-2 font-medium">{t.fields.storeName}</th>
                <th className="px-3 py-2 font-medium">{t.fields.area}</th>
                <th className="px-3 py-2 font-medium">{t.fields.deadlineAt}</th>
                <th className="px-3 py-2 font-medium">{t.fields.status}</th>
                <th className="px-3 py-2 font-medium">{t.fields.updatedAt}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-border border-t">
                  <td className="px-3 py-2">{r.targetMonth}</td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/event-detail/${r.id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {new Date(r.scheduledDate).toLocaleDateString("ja-JP")}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.storeName}</td>
                  <td className="px-3 py-2">{r.area ?? "—"}</td>
                  <td className="px-3 py-2">{new Date(r.deadlineAt).toLocaleString("ja-JP")}</td>
                  <td className="px-3 py-2">{t.statuses[r.status]}</td>
                  <td className="text-muted-foreground px-3 py-2 text-xs">
                    {new Date(r.updatedAt).toLocaleString("ja-JP")}
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
