"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { labels } from "@/lib/i18n/labels";

import { changeStatusAction } from "./actions";

import type { VenueNegotiationStatus, VenueNegotiationStatusTarget } from "@solar/contracts";

// S-022 — ヘッダ右上に表示するインラインステータスプルダウン。他のフォーム
// プルダウンと同じ UX で、選択した瞬間に保存。状態遷移の制約はデモ用途で
// 撤廃済み（actions.ts 側も同様）— 同一状態のみブロック。
//
// FIXED に変更した時は確認ダイアログを開き、単発イベントとして登録するか
// 尋ねる。Yes → /events へ遷移、No → ダイアログを閉じてそのまま。

const ALL_TARGETS: VenueNegotiationStatusTarget[] = [
  "CONTACTING",
  "CONDITION_REVIEW",
  "FEASIBLE",
  "FIXED",
  "INFEASIBLE",
  "CANCELLED",
];

const STATUS_PILL_CLASS: Record<VenueNegotiationStatus, string> = {
  NOT_CONTACTED: "bg-gray-100 text-gray-700 ring-gray-200",
  CONTACTING: "bg-blue-50 text-blue-700 ring-blue-200",
  CONDITION_REVIEW: "bg-amber-50 text-amber-700 ring-amber-200",
  FEASIBLE: "bg-teal-50 text-teal-700 ring-teal-200",
  FIXED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  INFEASIBLE: "bg-rose-50 text-rose-700 ring-rose-200",
  CANCELLED: "bg-zinc-100 text-zinc-500 ring-zinc-200",
};

interface StatusControlProps {
  id: string;
  current: VenueNegotiationStatus;
}

export function StatusControl({ id, current }: StatusControlProps) {
  const router = useRouter();
  const t = labels.venueNegotiation;
  const c = labels.common;

  // Optimistic local value — diverges from `current` while a save is in flight.
  const [localValue, setLocalValue] = useState<VenueNegotiationStatus>(current);
  const [serverError, setServerError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [showFixedDialog, setShowFixedDialog] = useState(false);

  // Sync back to the server-provided value whenever the parent re-renders
  // (e.g. after router.refresh()).
  useEffect(() => {
    setLocalValue(current);
  }, [current]);

  function onChange(value: string) {
    if (!value || value === localValue) return;
    const target = value as VenueNegotiationStatusTarget;
    const prev = localValue;
    setLocalValue(target);
    setServerError(null);
    startTransition(async () => {
      try {
        await changeStatusAction({ id, status: target });
        toast.success(c.saved);
        router.refresh();
        if (target === "FIXED") {
          setShowFixedDialog(true);
        }
      } catch (err) {
        // Roll back optimistic update on failure.
        setLocalValue(prev);
        const message = err instanceof Error && err.message ? err.message : c.unknownError;
        setServerError(message);
      }
    });
  }

  // Exclude only the current value so the select keeps it as the displayed
  // selection but doesn't offer it as a re-pick.
  const otherTargets = ALL_TARGETS.filter((s) => s !== localValue);

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        aria-label={t.fields.status}
        value={localValue}
        onChange={(e) => onChange(e.target.value)}
        className={`appearance-auto cursor-pointer rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-inset hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-electric-blue/40 ${STATUS_PILL_CLASS[localValue]}`}
      >
        <option value={localValue}>{t.statuses[localValue]}</option>
        {otherTargets.map((s) => (
          <option key={s} value={s}>
            {t.statuses[s]}
          </option>
        ))}
      </select>
      {serverError ? (
        <p role="alert" className="text-destructive text-xs font-medium">
          {serverError}
        </p>
      ) : null}

      <Dialog open={showFixedDialog} onOpenChange={setShowFixedDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>単発イベントとして登録しますか？</DialogTitle>
            <DialogDescription>
              ステータスを「確定」に変更しました。続けて単発イベントとして登録できます。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowFixedDialog(false)}
            >
              あとで
            </Button>
            <Button
              type="button"
              onClick={() => {
                setShowFixedDialog(false);
                router.push("/events");
              }}
            >
              イベント登録へ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
