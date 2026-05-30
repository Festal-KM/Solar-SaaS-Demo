// Shared ShiftCard component and date-range utilities for S-053 / S-054.
// Used by both the field dashboard (page.tsx) and the shift-list page (shifts/page.tsx).

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { labels } from "@/lib/i18n/labels";

import type { MyShiftDto } from "../data";

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function thisWeekRange(): { from: string; to: string } {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun..6=Sat
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    from: monday.toISOString().slice(0, 10),
    to: sunday.toISOString().slice(0, 10),
  };
}

export function ShiftCard({
  shift,
  isToday,
  showDate = false,
}: {
  shift: MyShiftDto;
  isToday: boolean;
  /** When true, renders the date string above the time range (used in the list page). */
  showDate?: boolean;
}) {
  const l = labels.fieldShift;
  const start = new Date(shift.startPlanned).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  });
  const end = new Date(shift.endPlanned).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  });
  const dateStr = new Date(shift.startPlanned).toLocaleDateString("ja-JP", {
    month: "short",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Tokyo",
  });

  return (
    <Card className={isToday ? "border-primary border-2" : undefined}>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm leading-snug">
            {shift.event.eventCandidate.storeName}
          </CardTitle>
          <div className="flex shrink-0 gap-1">
            {isToday && <Badge variant="default">{l.todayBadge}</Badge>}
            <Badge variant="outline">
              {l.roles[shift.role as keyof typeof l.roles] ?? shift.role}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 text-sm space-y-1">
        {showDate && <p className="text-muted-foreground text-xs">{dateStr}</p>}
        <p className="text-muted-foreground">
          {start} – {end}
        </p>
        {shift.event.eventCandidate.area && (
          <p className="text-muted-foreground text-xs">{shift.event.eventCandidate.area}</p>
        )}
        <Badge variant="secondary" className="text-xs">
          {l.statuses[shift.status as keyof typeof l.statuses] ?? shift.status}
        </Badge>
      </CardContent>
    </Card>
  );
}
