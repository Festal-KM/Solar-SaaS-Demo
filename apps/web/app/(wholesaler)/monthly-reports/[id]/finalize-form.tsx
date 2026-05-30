"use client";

// FinalizeReportForm — wholesaler_admin confirms REVIEWED → FINALIZED (T-06-09 / F-050).
// Shown on S-049 when MonthlyReport.status === "REVIEWED".

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { finalizeReportAction } from "./actions";

interface FinalizeReportFormProps {
  reportId: string;
}

export function FinalizeReportForm({ reportId }: FinalizeReportFormProps) {
  const [isPending, startTransition] = useTransition();
  const t = labels.monthlyReport;

  function handleClick() {
    if (!window.confirm(t.finalizeConfirm)) return;
    startTransition(async () => {
      await finalizeReportAction({ reportId });
    });
  }

  return (
    <Button onClick={handleClick} disabled={isPending} variant="default">
      {isPending ? t.finalizing : t.finalizeButton}
    </Button>
  );
}
