import Link from "next/link";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { labels } from "@/lib/i18n/labels";
import { cn } from "@/lib/utils";

import { getEventCandidatePreferenceStatus } from "./data";

import type { PreferenceSubmissionStatus } from "./data";

// S-025 / S-026 — 二次店希望状況確認 (T-03-07 / F-022 / docs/04 §1.3).
//
// 卸業者本部 (wholesaler_admin / wholesaler_event_team) 専用。data.ts の
// assertCan('event_candidate.read_preferences') で dealer / call_team /
// direct_sales / field_staff は 403、wholesalerId 不一致は NotFound 隠蔽。

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

const BADGE_BASE = "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium";

function statusBadgeClass(status: PreferenceSubmissionStatus): string {
  switch (status) {
    case "SUBMITTED":
      return cn(BADGE_BASE, "bg-primary/10 text-primary border-primary/20 border");
    case "OVERDUE":
      return cn(BADGE_BASE, "bg-destructive/10 text-destructive border-destructive/20 border");
    case "PENDING":
    default:
      return cn(BADGE_BASE, "bg-muted text-muted-foreground border-border border");
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ja-JP");
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP");
}

export default async function EventCandidatePreferenceStatusPage({ params }: PageProps) {
  const { id } = await params;
  const data = await getEventCandidatePreferenceStatus(id);
  const t = labels.eventCandidatePreferences;
  const { candidate, summary } = data;
  const bc = labels.breadcrumb.items;

  return (
    <div className="space-y-8">
      <Breadcrumb
        items={[
          { label: bc.eventCandidates, href: "/events" },
          { label: bc.eventCandidateDetail, href: `/event-detail/${candidate.id}` },
          { label: bc.eventCandidatePreferences },
        ]}
      />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-muted-foreground text-sm">{t.subtitle}</p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/event-detail/${candidate.id}`}>{t.backToCandidate}</Link>
        </Button>
      </div>

      <section
        className="border-border bg-muted/20 grid grid-cols-1 gap-4 rounded-md border p-4 sm:grid-cols-4"
        aria-label={t.storeLine}
      >
        <div>
          <p className="text-muted-foreground text-xs">{t.storeLine}</p>
          <p className="text-lg font-semibold">{candidate.storeName}</p>
          {candidate.area ? (
            <p className="text-muted-foreground text-xs">{candidate.area}</p>
          ) : null}
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{t.targetMonthLine}</p>
          <p className="text-lg font-semibold">{candidate.targetMonth}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{t.scheduledDateLine}</p>
          <p className="text-sm">{formatDate(candidate.scheduledDate)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{t.deadlineLine}</p>
          <p className="text-sm">{formatDateTime(candidate.deadlineAt)}</p>
          {candidate.deadlinePassed ? (
            <span className={cn(statusBadgeClass("OVERDUE"), "mt-1")}>{t.statuses.OVERDUE}</span>
          ) : null}
        </div>
      </section>

      {candidate.deadlinePassed && summary.totals.overdue > 0 ? (
        <p className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-4 py-3 text-sm">
          {t.deadlinePassedBanner}
        </p>
      ) : null}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="totals">
        <div className="border-border bg-background rounded-md border p-3">
          <p className="text-muted-foreground text-xs">{t.totals.visible}</p>
          <p className="text-2xl font-semibold">{summary.totals.visible}</p>
        </div>
        <div className="border-border bg-background rounded-md border p-3">
          <p className="text-muted-foreground text-xs">{t.totals.submitted}</p>
          <p className="text-primary text-2xl font-semibold">{summary.totals.submitted}</p>
        </div>
        <div className="border-border bg-background rounded-md border p-3">
          <p className="text-muted-foreground text-xs">{t.totals.pending}</p>
          <p className="text-2xl font-semibold">{summary.totals.pending}</p>
        </div>
        <div className="border-border bg-background rounded-md border p-3">
          <p className="text-muted-foreground text-xs">{t.totals.overdue}</p>
          <p
            className={cn(
              "text-2xl font-semibold",
              summary.totals.overdue > 0 ? "text-destructive" : "",
            )}
          >
            {summary.totals.overdue}
          </p>
        </div>
      </section>

      <Tabs defaultValue="byDealer" className="w-full">
        <TabsList>
          <TabsTrigger value="byDealer">{t.tabs.byDealer}</TabsTrigger>
          <TabsTrigger value="byStore">{t.tabs.byStore}</TabsTrigger>
        </TabsList>

        <TabsContent value="byDealer" className="space-y-3">
          <h2 className="text-lg font-medium">{t.byDealer.heading}</h2>
          {summary.rows.length === 0 ? (
            <p className="border-border bg-muted/20 text-muted-foreground rounded-md border border-dashed p-4 text-sm">
              {t.byDealer.empty}
            </p>
          ) : (
            <div className="border-border overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t.byDealer.columns.dealer}</th>
                    <th className="px-3 py-2 font-medium">{t.byDealer.columns.status}</th>
                    <th className="px-3 py-2 font-medium">{t.byDealer.columns.priority}</th>
                    <th className="px-3 py-2 font-medium">{t.byDealer.columns.availablePeople}</th>
                    <th className="px-3 py-2 font-medium">{t.byDealer.columns.availableDates}</th>
                    <th className="px-3 py-2 font-medium">{t.byDealer.columns.submittedAt}</th>
                    <th className="px-3 py-2 font-medium">{t.byDealer.columns.comment}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((r) => (
                    <tr key={r.relationshipId} className="border-border border-t align-top">
                      <td className="px-3 py-2">{r.dealerName}</td>
                      <td className="px-3 py-2">
                        <span className={statusBadgeClass(r.status)}>{t.statuses[r.status]}</span>
                      </td>
                      <td className="px-3 py-2">{r.preference?.priority ?? t.none}</td>
                      <td className="px-3 py-2">{r.preference?.availablePeople ?? t.none}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.preference && r.preference.availableDates.length > 0
                          ? r.preference.availableDates.join(", ")
                          : t.none}
                      </td>
                      <td className="text-muted-foreground px-3 py-2 text-xs">
                        {r.preference ? formatDateTime(r.preference.submittedAt) : t.none}
                      </td>
                      <td className="px-3 py-2 text-xs">{r.preference?.comment ?? t.none}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="byStore" className="space-y-3">
          <h2 className="text-lg font-medium">{t.byStore.heading}</h2>
          <p className="text-muted-foreground text-xs">{t.byStore.description}</p>
          <div className="border-border overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">{t.byStore.columns.store}</th>
                  <th className="px-3 py-2 font-medium">{t.byStore.columns.scheduledDate}</th>
                  <th className="px-3 py-2 font-medium">{t.byStore.columns.submitted}</th>
                  <th className="px-3 py-2 font-medium">{t.byStore.columns.pending}</th>
                  <th className="px-3 py-2 font-medium">{t.byStore.columns.overdue}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-border border-t">
                  <td className="px-3 py-2 font-medium">{candidate.storeName}</td>
                  <td className="px-3 py-2">{formatDate(candidate.scheduledDate)}</td>
                  <td className="text-primary px-3 py-2">{summary.totals.submitted}</td>
                  <td className="px-3 py-2">{summary.totals.pending}</td>
                  <td
                    className={cn(
                      "px-3 py-2",
                      summary.totals.overdue > 0 ? "text-destructive font-semibold" : "",
                    )}
                  >
                    {summary.totals.overdue}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
