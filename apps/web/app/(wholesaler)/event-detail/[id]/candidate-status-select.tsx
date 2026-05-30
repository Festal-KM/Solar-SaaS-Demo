"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { labels } from "@/lib/i18n/labels";

import { cancelEventCandidateAction } from "../actions";

import type { EventCandidateStatus } from "@solar/contracts";

type HoldingValue = "pending" | "confirmed" | "cancelled";

function toHolding(s: EventCandidateStatus): HoldingValue {
  if (s === "CANCELLED") return "cancelled";
  if (s === "DECIDED") return "confirmed";
  return "pending";
}

const HOLDING_OPTIONS: HoldingValue[] = ["pending", "confirmed", "cancelled"];

function chipColors(v: HoldingValue): string {
  switch (v) {
    case "confirmed":
      return "bg-primary/10 text-primary border-primary/30";
    case "cancelled":
      return "bg-warning/10 text-warning border-warning/30";
    default:
      return "bg-amber-50 text-amber-700 border-amber-200";
  }
}

function menuItemColors(v: HoldingValue, active: boolean): string {
  const base = active ? "font-semibold" : "";
  switch (v) {
    case "confirmed":
      return `${base} text-primary`;
    case "cancelled":
      return `${base} text-warning`;
    default:
      return `${base} text-amber-700`;
  }
}

interface Props {
  id: string;
  current: EventCandidateStatus;
}

export function CandidateStatusSelect({ id, current }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tl = labels.eventList;
  const t = labels.eventCandidate;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const currentHolding = toHolding(current);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function handleSelect(next: HoldingValue) {
    setOpen(false);
    if (next === currentHolding) return;

    if (next === "confirmed") {
      router.push(`/event-detail/${id}/decide`);
      return;
    }

    if (next === "cancelled") {
      if (!window.confirm(t.actions.cancelConfirm)) return;
      startTransition(async () => {
        try {
          await cancelEventCandidateAction({ id });
          toast.success(labels.common.saved);
          router.refresh();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : labels.common.unknownError);
        }
      });
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => !isPending && setOpen(!open)}
        disabled={isPending}
        className={[
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors cursor-pointer",
          chipColors(currentHolding),
          isPending ? "opacity-50" : "hover:shadow-sm",
        ].join(" ")}
      >
        {tl.holdingStatuses[currentHolding]}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="opacity-60">
          <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-36 rounded-md border border-hairline-light bg-white py-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-150">
          {HOLDING_OPTIONS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => handleSelect(v)}
              className={[
                "flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-surface-soft",
                menuItemColors(v, v === currentHolding),
              ].join(" ")}
            >
              <span className={["inline-block h-2 w-2 rounded-full", chipColors(v).split(" ")[0]].join(" ")} />
              {tl.holdingStatuses[v]}
              {v === currentHolding && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="ml-auto">
                  <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
