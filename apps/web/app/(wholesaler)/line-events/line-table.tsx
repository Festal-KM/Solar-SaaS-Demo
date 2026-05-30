"use client";

import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { labels } from "@/lib/i18n/labels";

import type { LineEventListRow } from "./data";

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

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function statusVariant(s: LineEventListRow["status"]): "default" | "secondary" | "destructive" {
  switch (s) {
    case "CONFIRMED":
      return "default";
    case "DRAFT":
      return "secondary";
    case "CANCELLED":
      return "destructive";
  }
}

interface LineTableProps {
  rows: LineEventListRow[];
}

export function LineTable({ rows }: LineTableProps) {
  const router = useRouter();
  const t = labels.lineEvent;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-hairline-light bg-surface-soft/50">
            <th className="px-4 py-3 text-left text-xs font-medium text-mute-light uppercase tracking-wider whitespace-nowrap">
              {t.columns.venueName}
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-mute-light uppercase tracking-wider whitespace-nowrap">
              {t.columns.venueProvider}
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-mute-light uppercase tracking-wider">
              {t.columns.scheduledDates}
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-mute-light uppercase tracking-wider whitespace-nowrap">
              {t.columns.area}
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-mute-light uppercase tracking-wider whitespace-nowrap">
              {t.columns.holdingCount}
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-mute-light uppercase tracking-wider whitespace-nowrap">
              {t.columns.lastUpdated}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline-light">
          {rows.map((row) => {
            const sorted = [...row.scheduledDates].sort();
            return (
              <tr
                key={row.id}
                className="hover:bg-surface-soft/30 transition-colors cursor-pointer"
                onClick={() => router.push(`/line-events/${row.id}`)}
              >
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <span className="text-ink font-medium">{row.name}</span>
                    <Badge variant={statusVariant(row.status)}>{t.statuses[row.status]}</Badge>
                  </div>
                </td>
                <td className="px-4 py-3 text-body-light whitespace-nowrap">
                  {row.venueProviderName ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5 max-w-md">
                    {sorted.map((d) => (
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
                </td>
                <td className="px-4 py-3 text-body-light whitespace-nowrap">{row.area ?? "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums text-ink whitespace-nowrap">
                  {row.scheduledDates.length}
                  {t.holdingCountSuffix}
                </td>
                <td className="px-4 py-3 text-body-light tabular-nums whitespace-nowrap">
                  {formatDate(row.updatedAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
