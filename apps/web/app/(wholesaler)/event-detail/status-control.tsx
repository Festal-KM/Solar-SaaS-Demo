"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import {
  cancelEventCandidateAction,
  closePreferenceAction,
  publishEventCandidateAction,
} from "./actions";

import type { EventCandidateStatus } from "@solar/contracts";

// S-024 — ステータス遷移ボタン群。各遷移は専用 Server Action（publish /
// closePreference / cancel）に対応する。CLOSED → OPEN への期限延長 (再受付)
// は publishEventCandidateAction が状態機械で許可済みなので publish 同関数を
// 流用する。
//
// 許可遷移はサーバ側で再検証されるので、ここの adjacency table は UX 上の
// 「ボタンを出すかどうか」の判定にのみ使う。

const ALLOWED: Record<EventCandidateStatus, EventCandidateStatus[]> = {
  DRAFT: ["OPEN", "CANCELLED"],
  OPEN: ["CLOSED", "CANCELLED"],
  CLOSED: ["DECIDED", "OPEN", "CANCELLED"],
  DECIDED: ["CANCELLED"],
  CANCELLED: [],
};

interface StatusControlProps {
  id: string;
  current: EventCandidateStatus;
}

type PendingTarget = "publish" | "close" | "reopen" | "cancel" | null;

export function StatusControl({ id, current }: StatusControlProps) {
  const router = useRouter();
  const t = labels.eventCandidate;
  const c = labels.common;

  const [serverError, setServerError] = useState<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<PendingTarget>(null);
  const [pending, startTransition] = useTransition();

  const allowed = ALLOWED[current];
  if (allowed.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        現在のステータス「{t.statuses[current]}」からは遷移できません（終端状態）
      </p>
    );
  }

  function run(target: PendingTarget, action: () => Promise<unknown>) {
    setServerError(null);
    setPendingTarget(target);
    startTransition(async () => {
      try {
        await action();
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : c.unknownError;
        setServerError(message);
      } finally {
        setPendingTarget(null);
      }
    });
  }

  // Mode → DECIDED is handled by T-03-08 (eventDecision.decide). We render a
  // placeholder note instead of a button so wholesaler_event_team knows the
  // entry point is the decision screen, not this status panel.
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {allowed.includes("OPEN") && current === "DRAFT" ? (
          <Button
            type="button"
            disabled={pending}
            onClick={() => run("publish", () => publishEventCandidateAction({ id }))}
          >
            {pending && pendingTarget === "publish" ? t.actions.publishing : t.actions.publish}
          </Button>
        ) : null}
        {allowed.includes("OPEN") && current === "CLOSED" ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => run("reopen", () => publishEventCandidateAction({ id }))}
          >
            {pending && pendingTarget === "reopen" ? t.actions.publishing : t.actions.reopen}
          </Button>
        ) : null}
        {allowed.includes("CLOSED") ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => run("close", () => closePreferenceAction({ id }))}
          >
            {pending && pendingTarget === "close" ? t.actions.closing : t.actions.closePreference}
          </Button>
        ) : null}
        {allowed.includes("CANCELLED") ? (
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(t.actions.cancelConfirm)) return;
              run("cancel", () => cancelEventCandidateAction({ id }));
            }}
          >
            {pending && pendingTarget === "cancel" ? t.actions.cancelling : t.actions.cancel}
          </Button>
        ) : null}
      </div>
      {allowed.includes("DECIDED") ? (
        <Link
          href={`/event-detail/${id}/decide`}
          className="text-primary text-xs underline-offset-2 hover:underline"
        >
          {labels.eventDecision.decideLinkText}
        </Link>
      ) : null}
      {serverError ? (
        <p role="alert" className="text-destructive text-sm font-medium">
          {serverError}
        </p>
      ) : null}
    </div>
  );
}
