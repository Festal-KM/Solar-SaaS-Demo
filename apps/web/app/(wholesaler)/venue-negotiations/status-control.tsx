"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { changeStatusAction } from "./actions";

import type { VenueNegotiationStatus, VenueNegotiationStatusTarget } from "@solar/contracts";

// S-022 — ステータス遷移ボタン群。許可遷移は actions.ts と同じ表をローカルに
// 持っているが、サーバ側で必ず再検証されるので二重チェック扱い。

const ALLOWED: Record<VenueNegotiationStatus, VenueNegotiationStatusTarget[]> = {
  NOT_CONTACTED: ["CONTACTING", "CONDITION_REVIEW", "INFEASIBLE", "CANCELLED"],
  CONTACTING: ["CONDITION_REVIEW", "INFEASIBLE", "CANCELLED"],
  CONDITION_REVIEW: ["FEASIBLE", "INFEASIBLE", "CANCELLED"],
  FEASIBLE: ["FIXED", "INFEASIBLE", "CANCELLED"],
  FIXED: ["CANCELLED"],
  INFEASIBLE: [],
  CANCELLED: [],
};

interface StatusControlProps {
  id: string;
  current: VenueNegotiationStatus;
}

export function StatusControl({ id, current }: StatusControlProps) {
  const router = useRouter();
  const t = labels.venueNegotiation;
  const c = labels.common;

  const [reason, setReason] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<VenueNegotiationStatusTarget | null>(null);
  const [pending, startTransition] = useTransition();

  const allowed = ALLOWED[current];

  function onChange(target: VenueNegotiationStatusTarget) {
    setServerError(null);
    setPendingTarget(target);
    startTransition(async () => {
      try {
        await changeStatusAction({ id, status: target, reason: reason.trim() || undefined });
        toast.success(c.saved);
        setReason("");
        router.refresh();
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : c.unknownError;
        setServerError(message);
      } finally {
        setPendingTarget(null);
      }
    });
  }

  if (allowed.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        現在のステータス「{t.statuses[current]}」からは遷移できません（終端状態）
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="reason">
          {t.fields.reason}
        </label>
        <textarea
          id="reason"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="border-input bg-background flex w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {allowed.map((target) => (
          <Button
            key={target}
            type="button"
            variant={target === "CANCELLED" || target === "INFEASIBLE" ? "destructive" : "default"}
            disabled={pending}
            onClick={() => onChange(target)}
          >
            {pending && pendingTarget === target ? t.actions.changing : t.statuses[target]}
          </Button>
        ))}
      </div>
      {serverError ? (
        <p role="alert" className="text-destructive text-sm font-medium">
          {serverError}
        </p>
      ) : null}
    </div>
  );
}
