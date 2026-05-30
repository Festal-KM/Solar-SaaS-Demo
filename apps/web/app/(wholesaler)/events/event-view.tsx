"use client";

import { useCallback, useState } from "react";

import { Card } from "@/components/ui/card";
import { labels } from "@/lib/i18n/labels";

import { EventTable } from "./event-table";
import { WeeklyCalendar } from "./weekly-calendar";

import type { DaySummary, UnifiedEventRow } from "./unified-data";

interface EventViewProps {
  weekStart: string;
  weekEnd: string;
  daySummaries: DaySummary[];
  events: UnifiedEventRow[];
}

export function EventView({ weekStart, weekEnd, daySummaries, events }: EventViewProps) {
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const t = labels.eventList;

  const clearSelection = useCallback(() => setSelectedDates(new Set()), []);

  const toggleDate = useCallback((date: string) => {
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  }, []);

  const hasSelection = selectedDates.size > 0;
  const filtered = hasSelection
    ? events.filter((ev) => selectedDates.has(ev.scheduledDate.slice(0, 10)))
    : events;

  const rangeLabel = hasSelection
    ? t.selectedDateLabel.replace("{date}", [...selectedDates].sort().join(", "))
    : t.selectedWeekRange.replace("{start}", weekStart).replace("{end}", weekEnd);

  return (
    <>
      <WeeklyCalendar
        weekStart={weekStart}
        weekEnd={weekEnd}
        daySummaries={daySummaries}
        selectedDates={selectedDates}
        onToggleDate={toggleDate}
        onClearSelection={clearSelection}
      />

      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline-light">
          <h2 className="text-sm font-medium text-ink">
            {hasSelection ? t.selectedDateEvents : t.selectedWeekEvents}
          </h2>
          <span className="text-xs text-mute-light tabular-nums">{rangeLabel}</span>
        </div>

        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-mute-light text-sm">{t.empty}</div>
        ) : (
          <EventTable events={filtered} />
        )}
      </Card>
    </>
  );
}
