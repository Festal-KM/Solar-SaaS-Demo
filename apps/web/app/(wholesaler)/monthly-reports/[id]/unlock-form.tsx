"use client";

// UnlockReportForm — wholesaler_admin reverts FINALIZED → REVIEWED (T-06-09 / F-050 / OQ-13).
// Shown on S-049 when MonthlyReport.status === "FINALIZED".
// reason is mandatory per docs/05 §4.9.

import { useRef, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { labels } from "@/lib/i18n/labels";

import { unlockReportAction } from "./actions";

interface UnlockReportFormProps {
  reportId: string;
}

export function UnlockReportForm({ reportId }: UnlockReportFormProps) {
  const [isPending, startTransition] = useTransition();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const t = labels.monthlyReport;

  function handleSubmit(formData: FormData) {
    const reason = (formData.get("reason") as string | null)?.trim() ?? "";
    if (!reason) {
      reasonRef.current?.focus();
      return;
    }
    startTransition(async () => {
      await unlockReportAction({ reportId, reason });
    });
  }

  return (
    <form action={handleSubmit} className="space-y-3">
      <div className="space-y-1">
        <label htmlFor={`unlock-reason-${reportId}`} className="text-sm font-medium">
          {t.unlockReasonLabel}
        </label>
        <Textarea
          ref={reasonRef}
          id={`unlock-reason-${reportId}`}
          name="reason"
          placeholder={t.unlockReasonPlaceholder}
          rows={3}
          required
          disabled={isPending}
        />
      </div>
      <Button type="submit" disabled={isPending} variant="destructive">
        {isPending ? t.unlocking : t.unlockButton}
      </Button>
    </form>
  );
}
