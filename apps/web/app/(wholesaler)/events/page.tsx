// S-023 — 統合イベント一覧 (F-018 / F-027 / docs/04)

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { listActiveAreas, listActiveStores, listActiveVenueProviders } from "../event-detail/data";
import { EventView } from "./event-view";
import { MonthlyView } from "./monthly-view";
import { NewEventDialog } from "./new-event-dialog";
import { listUnifiedEvents, listUnifiedEventsMonthly } from "./unified-data";

import type { HoldingStatus, AssignStatus } from "./unified-data";

export const dynamic = "force-dynamic";

const VALID_HOLDING: HoldingStatus[] = ["confirmed", "pending", "cancelled"];
const VALID_ASSIGN: AssignStatus[] = ["confirmed", "pending"];

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function UnifiedEventsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const isMonthly = params.view === "monthly";
  const t = labels.eventList;

  if (isMonthly) {
    const holding = VALID_HOLDING.includes(params.holding as HoldingStatus)
      ? (params.holding as HoldingStatus)
      : undefined;
    const assign = VALID_ASSIGN.includes(params.assign as AssignStatus)
      ? (params.assign as AssignStatus)
      : undefined;

    const [result, venueProviders, areas, stores] = await Promise.all([
      listUnifiedEventsMonthly({
        from: params.from,
        to: params.to,
        venue: params.venue,
        holdingStatus: holding,
        assignStatus: assign,
      }),
      listActiveVenueProviders(),
      listActiveAreas(),
      listActiveStores(),
    ]);

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-ink">{t.title}</h1>
            <p className="text-body-light text-sm mt-1">{t.subtitleMonthly}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/events">{t.weeklyView}</Link>
            </Button>
            <NewEventDialog venueProviders={venueProviders} areas={areas} stores={stores} />
          </div>
        </div>

        <MonthlyView
          events={result.events}
          venues={result.venues}
          currentFrom={params.from ?? ""}
          currentTo={params.to ?? ""}
          currentVenue={params.venue ?? ""}
          currentHolding={params.holding ?? ""}
          currentAssign={params.assign ?? ""}
        />
      </div>
    );
  }

  // Weekly view (default)
  const weekParam = params.week && /^\d{4}-\d{2}-\d{2}$/.test(params.week) ? params.week : undefined;
  const [result, venueProviders, areas, stores] = await Promise.all([
    listUnifiedEvents(weekParam),
    listActiveVenueProviders(),
    listActiveAreas(),
    listActiveStores(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{t.title}</h1>
          <p className="text-body-light text-sm mt-1">{t.subtitleWeekly}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/events?view=monthly">{t.monthlyView}</Link>
          </Button>
          <NewEventDialog venueProviders={venueProviders} areas={areas} stores={stores} />
        </div>
      </div>

      <EventView
        weekStart={result.weekStart}
        weekEnd={result.weekEnd}
        daySummaries={result.daySummaries}
        events={result.events}
      />
    </div>
  );
}
