"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { labels } from "@/lib/i18n/labels";

import { bandColor, groupConsecutiveDates } from "./desired-dates";

import type { LanePreferenceDto, LanePreferenceItemDto } from "./data";

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

function PreferenceCard({ item }: { item: LanePreferenceItemDto }) {
  const c = labels.lanePreference.card;
  // 連続日を帯チップにグルーピング（例 7/7,7/8 → "7/7~8"）。
  const bands = groupConsecutiveDates(item.desiredDates);
  // マスタ突合名は副次情報として表示（一次ソースは venueLabel）。
  const linkedName = item.venueProviderName ?? item.storeName ?? null;

  return (
    <div className="min-w-[240px] flex-1 rounded-md border border-hairline-light bg-surface-soft/40 p-3">
      <div className="text-xs font-medium text-link-light mb-2">
        {priorityLabel(item.priority)}
      </div>
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-xs text-mute-light">{c.venueLabel}</dt>
          <dd className="text-ink font-medium">{item.venueLabel}</dd>
          {linkedName ? (
            <dd className="text-xs text-mute-light mt-0.5">
              {item.venueProviderName ? c.venueProvider : c.store}: {linkedName}
            </dd>
          ) : null}
        </div>
        <div>
          <dt className="text-xs text-mute-light mb-1">{c.desiredDates}</dt>
          <dd>
            {bands.length === 0 ? (
              <span className="text-mute-light">—</span>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {bands.map((b) => (
                  <span
                    key={b.dates[0]}
                    className={[
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
                      bandColor(b.startDow),
                    ].join(" ")}
                  >
                    <span>{b.label}</span>
                    <span className="text-[10px] font-semibold opacity-70">
                      {c.dayCount.replace("{n}", String(b.dates.length))}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </dd>
        </div>
        {item.memo ? (
          <div>
            <dt className="text-xs text-mute-light">{c.memo}</dt>
            <dd className="text-body-light">{item.memo}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function AccordionRow({ row }: { row: LanePreferenceDto }) {
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
          <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary tabular-nums">
            {t.laneCountBadge.replace("{n}", String(row.laneCount))}
          </span>
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
                  <PreferenceCard key={`${row.id}-${item.priority}`} item={item} />
                ))
              )}
            </div>
            <div className="text-sm">
              <span className="text-xs text-mute-light">{t.noteLabel}: </span>
              <span className="text-body-light">{row.note ?? t.noNote}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface LanePreferenceAccordionProps {
  rows: LanePreferenceDto[];
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
