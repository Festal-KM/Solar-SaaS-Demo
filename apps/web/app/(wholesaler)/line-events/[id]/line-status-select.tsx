"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { labels } from "@/lib/i18n/labels";

import { updateLineStatusAction } from "./actions";

import type { LineEventStatus } from "@solar/contracts";

const OPTIONS: LineEventStatus[] = ["DRAFT", "CONFIRMED", "CANCELLED"];

function chipColors(s: LineEventStatus): string {
  switch (s) {
    case "CONFIRMED":
      return "bg-primary/10 text-primary border-primary/30";
    case "CANCELLED":
      return "bg-warning/10 text-warning border-warning/30";
    default:
      return "bg-amber-50 text-amber-700 border-amber-200";
  }
}

function menuItemColors(s: LineEventStatus, active: boolean): string {
  const base = active ? "font-semibold" : "";
  switch (s) {
    case "CONFIRMED":
      return `${base} text-primary`;
    case "CANCELLED":
      return `${base} text-warning`;
    default:
      return `${base} text-amber-700`;
  }
}

interface Props {
  id: string;
  current: LineEventStatus;
}

export function LineStatusSelect({ id, current }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const t = labels.lineEvent;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  function handleSelect(next: LineEventStatus) {
    setOpen(false);
    if (next === current) return;

    if (next === "CANCELLED" && !window.confirm(t.statusUpdate.cancelConfirm)) {
      return;
    }

    startTransition(async () => {
      try {
        await updateLineStatusAction({ id, status: next });
        toast.success(labels.common.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : labels.common.unknownError);
      }
    });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => !isPending && setOpen(!open)}
        disabled={isPending}
        className={[
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors cursor-pointer",
          chipColors(current),
          isPending ? "opacity-50" : "hover:shadow-sm",
        ].join(" ")}
      >
        {t.statuses[current]}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="opacity-60">
          <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-36 rounded-md border border-hairline-light bg-white py-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-150">
          {OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleSelect(s)}
              className={[
                "flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-surface-soft",
                menuItemColors(s, s === current),
              ].join(" ")}
            >
              <span className={["inline-block h-2 w-2 rounded-full", chipColors(s).split(" ")[0]].join(" ")} />
              {t.statuses[s]}
              {s === current && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="ml-auto">
                  <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
