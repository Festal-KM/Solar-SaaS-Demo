"use client";

import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { labels } from "@/lib/i18n/labels";

import type { AssignStatus, HoldingStatus, UnifiedEventRow } from "./unified-data";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
}

function holdingVariant(s: HoldingStatus): "default" | "secondary" | "destructive" {
  switch (s) {
    case "confirmed":
      return "default";
    case "pending":
      return "secondary";
    case "cancelled":
      return "destructive";
  }
}

function assignVariant(s: AssignStatus): "default" | "secondary" {
  return s === "confirmed" ? "default" : "secondary";
}

interface EventTableProps {
  events: UnifiedEventRow[];
}

export function EventTable({ events }: EventTableProps) {
  const router = useRouter();
  const t = labels.eventList;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-hairline-light bg-surface-soft/50">
            <th className="px-6 py-3 text-left text-xs font-medium text-mute-light uppercase tracking-wider">
              {t.columns.scheduledDate}
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-mute-light uppercase tracking-wider">
              {t.columns.area}
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-mute-light uppercase tracking-wider">
              {t.columns.venue}
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-mute-light uppercase tracking-wider">
              {t.columns.holdingStatus}
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-mute-light uppercase tracking-wider">
              {t.columns.assignStatus}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline-light">
          {events.map((ev) => (
            <tr
              key={`${ev.kind}-${ev.id}`}
              className="hover:bg-surface-soft/30 transition-colors cursor-pointer"
              onClick={() => router.push(ev.detailHref)}
            >
              <td className="px-6 py-3 tabular-nums text-body-light whitespace-nowrap">
                {formatDateTime(ev.scheduledDate)}
              </td>
              <td className="px-6 py-3 text-body-light">{ev.area ?? "—"}</td>
              <td className="px-6 py-3 text-ink font-medium">{ev.venue ?? "—"}</td>
              <td className="px-6 py-3">
                <Badge variant={holdingVariant(ev.holdingStatus)}>
                  {t.holdingStatuses[ev.holdingStatus]}
                </Badge>
              </td>
              <td className="px-6 py-3">
                <Badge variant={assignVariant(ev.assignStatus)}>
                  {t.assignStatuses[ev.assignStatus]}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
