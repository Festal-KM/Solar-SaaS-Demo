"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { labels } from "@/lib/i18n/labels";

import type { DaySummary } from "./unified-data";

const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocalDate(s: string): Date {
  const parts = s.split("-").map(Number);
  return new Date(parts[0]!, parts[1]! - 1, parts[2]!);
}

function formatDayHeader(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()} (${DAY_LABELS[d.getDay()]})`;
}

function formatRangeLabel(start: string, end: string): string {
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  return `${s.getFullYear()}年${s.getMonth() + 1}月${s.getDate()}日(${DAY_LABELS[s.getDay()]}) 〜 ${e.getMonth() + 1}月${e.getDate()}日(${DAY_LABELS[e.getDay()]})`;
}

function shiftWeek(weekStart: string, delta: number): string {
  const d = parseLocalDate(weekStart);
  d.setDate(d.getDate() + 7 * delta);
  return localDateStr(d);
}

function todayMonday(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return localDateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff));
}

function cellBg(day: DaySummary, isSelected: boolean): string {
  if (isSelected) return "bg-primary/5 ring-1 ring-primary/30 ring-inset";
  if (day.isHoliday || day.dayOfWeek === 0) return "bg-red-50";
  if (day.dayOfWeek === 6) return "bg-blue-50";
  return "";
}

function dayHeaderColor(day: DaySummary): string {
  if (day.isHoliday || day.dayOfWeek === 0) return "text-warning";
  if (day.dayOfWeek === 6) return "text-link-light";
  return "text-ink";
}

interface WeeklyCalendarProps {
  weekStart: string;
  weekEnd: string;
  daySummaries: DaySummary[];
  selectedDates: Set<string>;
  onToggleDate: (date: string) => void;
  onClearSelection: () => void;
}

export function WeeklyCalendar({
  weekStart,
  weekEnd,
  daySummaries,
  selectedDates,
  onToggleDate,
  onClearSelection,
}: WeeklyCalendarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = labels.eventList;

  const navigate = useCallback(
    (week: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("week", week);
      params.delete("day");
      router.push(`/events?${params.toString()}`);
    },
    [searchParams, router],
  );

  const navigateWeek = useCallback(
    (delta: number) => navigate(shiftWeek(weekStart, delta)),
    [weekStart, navigate],
  );

  const goToday = useCallback(() => navigate(todayMonday()), [navigate]);

  const handleDayClick = useCallback(
    (date: string) => onToggleDate(date),
    [onToggleDate],
  );

  return (
    <Card className="p-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-hairline-light">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-ink">{t.weeklyCalendar}</h2>
          {selectedDates.size > 0 && (
            <button
              type="button"
              className="text-xs text-link-light hover:underline underline-offset-4"
              onClick={onClearSelection}
            >
              {t.clearSelection}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="px-2" onClick={() => navigateWeek(-1)}>
            {"<"}
          </Button>
          <span className="text-sm text-ink tabular-nums px-2">
            {formatRangeLabel(weekStart, weekEnd)}
          </span>
          <Button variant="outline" size="sm" className="px-2" onClick={() => navigateWeek(1)}>
            {">"}
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>
            {t.thisWeek}
          </Button>
        </div>
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 divide-x divide-hairline-light border-b border-hairline-light">
        {daySummaries.map((day) => {
          const isSelected = selectedDates.has(day.date);
          return (
            <div
              key={day.date}
              className={[
                "px-4 py-3 cursor-pointer transition-colors hover:bg-primary/5",
                cellBg(day, isSelected),
              ].join(" ")}
              onClick={() => handleDayClick(day.date)}
            >
              {/* Day header */}
              <p
                className={[
                  "text-xs font-semibold mb-3 pb-2 border-b border-hairline-light",
                  dayHeaderColor(day),
                ].join(" ")}
              >
                {formatDayHeader(day.date)}
              </p>

              {/* Total */}
              <div className="text-center mb-3">
                <p className="text-[10px] text-mute-light tracking-wider">{t.totalEvents}</p>
                <p className="text-2xl font-bold text-ink tabular-nums leading-tight">
                  {day.total}
                </p>
              </div>

              {/* Breakdown */}
              <div className="space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-body-light">{t.confirmed}</span>
                  <span className="text-ink font-medium tabular-nums">{day.confirmed}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-body-light">{t.prospective}</span>
                  <span className="text-ink font-medium tabular-nums">{day.prospective}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-body-light">{t.unassigned}</span>
                  <span className="text-ink font-medium tabular-nums">{day.unassigned}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
