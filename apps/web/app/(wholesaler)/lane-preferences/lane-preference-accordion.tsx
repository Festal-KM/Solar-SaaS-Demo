"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { labels } from "@/lib/i18n/labels";

import type { LanePreferenceItemRow, LanePreferenceRow } from "./data";

const DOW = ["日", "月", "火", "水", "木", "金", "土"];

// Timezone-safe — parse YYYY-MM-DD into a local Date (never toISOString()).
function parseLocalDate(s: string): Date {
  const parts = s.split("-").map(Number);
  return new Date(parts[0]!, parts[1]! - 1, parts[2]!);
}

function formatChip(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, "0")}(${DOW[d.getDay()]})`;
}

function chipColor(dateStr: string): string {
  const dow = parseLocalDate(dateStr).getDay();
  if (dow === 0) return "bg-red-50 text-red-700 border-red-200";
  if (dow === 6) return "bg-blue-50 text-blue-700 border-blue-200";
  return "bg-surface-soft text-ink border-hairline-light";
}

// 月曜始まりで、その日付が属する週の月曜を返す（local-time 計算、toISOString 不使用）。
function getMonday(d: Date): Date {
  const day = d.getDay(); // 0=日..6=土
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
}

// 対象月の第何週か（月内の最初の月曜始まり週を第1週とする）。
function weekOfMonth(targetMonth: string, d: Date): number {
  const [y, m] = targetMonth.split("-").map(Number);
  const firstMonday = getMonday(new Date(y!, m! - 1, 1));
  const dMonday = getMonday(d);
  return Math.round((dMonday.getTime() - firstMonday.getTime()) / (7 * 86_400_000)) + 1;
}

interface WeekGroup {
  week: number;
  dates: string[];
}

// 開催日を月曜始まりの週ごとにまとめ、週番号順にソートして返す。
function groupByWeek(targetMonth: string, dates: string[]): WeekGroup[] {
  const byWeek = new Map<number, string[]>();
  for (const ds of [...dates].sort()) {
    const w = weekOfMonth(targetMonth, parseLocalDate(ds));
    (byWeek.get(w) ?? byWeek.set(w, []).get(w)!).push(ds);
  }
  return Array.from(byWeek.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([week, ds]) => ({ week, dates: ds }));
}

// 提出日時は YYYY/MM/DD HH:mm（ja-JP, JST 表示）。
function formatSubmittedAt(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PRIORITY_LABELS = labels.lanePreference.priorityLabels;

function priorityLabel(priority: number): string {
  const fixed = PRIORITY_LABELS[priority as 1 | 2 | 3 | 4 | 5];
  if (fixed) return fixed;
  return PRIORITY_LABELS.fallback.replace("{n}", String(priority));
}

function PreferenceCard({
  item,
  targetMonth,
}: {
  item: LanePreferenceItemRow;
  targetMonth: string;
}) {
  const c = labels.lanePreference.card;
  const weekGroups = groupByWeek(targetMonth, item.scheduledDates);
  return (
    <div className="min-w-[220px] flex-1 rounded-md border border-hairline-light bg-surface-soft/40 p-3">
      <div className="text-xs font-medium text-link-light mb-2">
        {priorityLabel(item.priority)}
      </div>
      <dl className="space-y-1.5 text-sm">
        <div>
          <dt className="text-xs text-mute-light">{c.lineName}</dt>
          <dd className="text-ink font-medium">{item.lineName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-mute-light">{c.venueProvider}</dt>
          <dd className="text-body-light">{item.venueProviderName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-mute-light mb-1">{c.scheduledDates}</dt>
          <dd>
            {weekGroups.length === 0 ? (
              <span className="text-mute-light">—</span>
            ) : (
              <div className="space-y-2">
                {weekGroups.map((g) => (
                  <div
                    key={g.week}
                    className="rounded-md border border-hairline-light bg-white/60 p-2"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-body-light">
                        {c.weekLabel.replace("{n}", String(g.week))}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary tabular-nums">
                        {c.dayCount.replace("{n}", String(g.dates.length))}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {g.dates.map((d) => (
                        <span
                          key={d}
                          className={[
                            "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
                            chipColor(d),
                          ].join(" ")}
                        >
                          {formatChip(d)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function AccordionRow({ row }: { row: LanePreferenceRow }) {
  const [open, setOpen] = useState(false);
  const t = labels.lanePreference;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-surface-soft/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <ChevronDown
            size={16}
            className={[
              "text-mute-light transition-transform",
              open ? "rotate-180" : "",
            ].join(" ")}
          />
          <span className="text-ink font-medium">{row.dealerName}</span>
        </div>
        <span className="text-xs text-mute-light tabular-nums">
          {t.submittedAtLabel} {formatSubmittedAt(row.submittedAt)}
        </span>
      </button>

      <div
        className={[
          "grid transition-[grid-template-rows] duration-300 ease-in-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        ].join(" ")}
      >
        <div className="overflow-hidden">
          <div className="px-6 pb-5 pt-4 space-y-3 border-t border-hairline-light bg-surface-soft/20">
            <div className="flex flex-wrap gap-3">
              {row.items.length === 0 ? (
                <span className="text-sm text-mute-light">—</span>
              ) : (
                row.items.map((item) => (
                  <PreferenceCard
                    key={`${row.id}-${item.priority}-${item.lineEventId}`}
                    item={item}
                    targetMonth={row.targetMonth}
                  />
                ))
              )}
            </div>
            <div className="text-sm">
              <span className="text-xs text-mute-light">{t.commentLabel}: </span>
              <span className="text-body-light">{row.comment ?? t.noComment}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface LanePreferenceAccordionProps {
  rows: LanePreferenceRow[];
}

export function LanePreferenceAccordion({ rows }: LanePreferenceAccordionProps) {
  return (
    <div className="divide-y divide-hairline-light">
      {rows.map((row) => (
        <AccordionRow key={row.id} row={row} />
      ))}
    </div>
  );
}
