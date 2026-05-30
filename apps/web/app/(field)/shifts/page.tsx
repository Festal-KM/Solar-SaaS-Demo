// S-054 — 自分のシフト一覧 (T-03-11 / F-026 / docs/04 §1.4).
//
// 期間フィルタ (今日 / 今週 / カスタム) + シフトカード一覧。
// 当日分は最上段固定 + border-primary で視覚強調。
// Next.js 15 では searchParams は Promise<> になるため await で解決する。

import "server-only";

import { Suspense } from "react";

import { labels } from "@/lib/i18n/labels";

import { fetchMyShifts } from "./data";
import { ShiftFilterBar } from "./filter-bar";
import { ShiftCard, thisWeekRange, todayIso } from "./_components/shift-card";

async function ShiftList({ from, to }: { from: string; to: string }) {
  const l = labels.fieldShift;
  const today = todayIso();
  const { shifts } = await fetchMyShifts({ from, to });

  // Today's shifts first, then the rest in chronological order.
  const todayShifts = shifts.filter(
    (s) => new Date(s.startPlanned).toISOString().slice(0, 10) === today,
  );
  const otherShifts = shifts.filter(
    (s) => new Date(s.startPlanned).toISOString().slice(0, 10) !== today,
  );
  const ordered = [...todayShifts, ...otherShifts];

  if (ordered.length === 0) {
    return <p className="text-muted-foreground text-sm">{l.noShiftsInPeriod}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {ordered.map((s) => (
        <ShiftCard
          key={s.id}
          shift={s}
          isToday={new Date(s.startPlanned).toISOString().slice(0, 10) === today}
          showDate
        />
      ))}
    </div>
  );
}

export default async function ShiftListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const l = labels.fieldShift;
  const params = await searchParams;
  const filter = (params.filter as string | undefined) ?? "today";

  let from: string;
  let to: string;

  if (filter === "week") {
    ({ from, to } = thisWeekRange());
  } else if (
    filter === "custom" &&
    typeof params.from === "string" &&
    typeof params.to === "string"
  ) {
    from = params.from;
    to = params.to;
  } else {
    // default: today
    from = todayIso();
    to = todayIso();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">{l.shiftListTitle}</h1>
        <p className="text-muted-foreground text-sm mt-1">{l.shiftListSubtitle}</p>
      </div>

      <ShiftFilterBar currentFilter={filter} currentFrom={from} currentTo={to} />

      <Suspense fallback={<p className="text-sm text-muted-foreground">{l.loading}</p>}>
        <ShiftList from={from} to={to} />
      </Suspense>
    </div>
  );
}
