"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { labels } from "@/lib/i18n/labels";

import { updateEventStatusAction } from "./actions";

import type { EventStatus } from "@solar/db";

interface StatusSelectProps {
  eventId: string;
  currentStatus: EventStatus;
}

const STATUS_OPTIONS: EventStatus[] = ["PLANNED", "ONGOING", "CLOSED", "CANCELLED"];

export function StatusSelect({ eventId, currentStatus }: StatusSelectProps) {
  const [isPending, startTransition] = useTransition();
  const t = labels.event;

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as EventStatus;
    if (next === currentStatus) return;
    startTransition(async () => {
      try {
        await updateEventStatusAction({ eventId, status: next });
        toast.success(labels.common.saved);
      } catch {
        toast.error(labels.common.unknownError);
      }
    });
  }

  return (
    <select
      defaultValue={currentStatus}
      onChange={handleChange}
      disabled={isPending}
      className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      aria-label={t.fields.status}
    >
      {STATUS_OPTIONS.map((s) => (
        <option key={s} value={s}>
          {t.statuses[s]}
        </option>
      ))}
    </select>
  );
}
