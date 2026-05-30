"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import { EventTable } from "./event-table";

import type { UnifiedEventRow } from "./unified-data";

interface MonthlyViewProps {
  events: UnifiedEventRow[];
  venues: string[];
  currentFrom: string;
  currentTo: string;
  currentVenue: string;
  currentHolding: string;
  currentAssign: string;
}

export function MonthlyView({
  events,
  venues,
  currentFrom,
  currentTo,
  currentVenue,
  currentHolding,
  currentAssign,
}: MonthlyViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = labels.eventList;

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.set("view", "monthly");
      router.push(`/events?${params.toString()}`);
    },
    [searchParams, router],
  );

  const clearFilters = useCallback(() => {
    router.push("/events?view=monthly");
  }, [router]);

  const hasFilter = !!(currentFrom || currentTo || currentVenue || currentHolding || currentAssign);

  return (
    <>
      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs text-mute-light font-medium">{t.filter.period}</label>
            <div className="flex items-center gap-1">
              <Input
                type="date"
                value={currentFrom}
                onChange={(e) => updateParam("from", e.target.value)}
                className="h-9 w-[150px]"
              />
              <span className="text-mute-light text-sm">〜</span>
              <Input
                type="date"
                value={currentTo}
                onChange={(e) => updateParam("to", e.target.value)}
                className="h-9 w-[150px]"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-mute-light font-medium">{t.filter.venue}</label>
            <select
              value={currentVenue}
              onChange={(e) => updateParam("venue", e.target.value)}
              className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
            >
              <option value="">{t.filter.allVenues}</option>
              {venues.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-mute-light font-medium">{t.columns.holdingStatus}</label>
            <select
              value={currentHolding}
              onChange={(e) => updateParam("holding", e.target.value)}
              className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
            >
              <option value="">{t.filter.all}</option>
              <option value="confirmed">{t.holdingStatuses.confirmed}</option>
              <option value="pending">{t.holdingStatuses.pending}</option>
              <option value="cancelled">{t.holdingStatuses.cancelled}</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-mute-light font-medium">{t.columns.assignStatus}</label>
            <select
              value={currentAssign}
              onChange={(e) => updateParam("assign", e.target.value)}
              className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
            >
              <option value="">{t.filter.all}</option>
              <option value="confirmed">{t.assignStatuses.confirmed}</option>
              <option value="pending">{t.assignStatuses.pending}</option>
            </select>
          </div>

          {hasFilter && (
            <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
              {t.filter.clear}
            </Button>
          )}
        </div>
      </Card>

      {/* Table */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline-light">
          <h2 className="text-sm font-medium text-ink">{t.monthlyListTitle}</h2>
          <span className="text-xs text-mute-light tabular-nums">
            {events.length}{t.filter.resultCount}
          </span>
        </div>

        {events.length === 0 ? (
          <div className="px-6 py-12 text-center text-mute-light text-sm">{t.empty}</div>
        ) : (
          <EventTable events={events} />
        )}
      </Card>
    </>
  );
}
