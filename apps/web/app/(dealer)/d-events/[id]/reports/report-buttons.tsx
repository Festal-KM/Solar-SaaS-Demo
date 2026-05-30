"use client";

// DealerReportButtons — client component for dealer event start / end report
// submission (T-04-03 / F-028 / F-029 / docs/04 §1.5 S-063 S-076).

import { useState } from "react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import {
  submitDealerEndReportAction,
  submitDealerStartReportAction,
  type DealerEventReportResult,
} from "./actions";

interface DealerReportButtonsProps {
  eventId: string;
  hasDealerStart: boolean;
  hasDealerEnd: boolean;
}

export function DealerReportButtons({
  eventId,
  hasDealerStart,
  hasDealerEnd,
}: DealerReportButtonsProps) {
  const t = labels.eventReport;
  const [submittingStart, setSubmittingStart] = useState(false);
  const [submittingEnd, setSubmittingEnd] = useState(false);

  async function handleStart() {
    setSubmittingStart(true);
    try {
      await submitDealerStartReportAction({ eventId });
      toast.success(t.startSuccess);
    } catch (err) {
      const msg =
        err instanceof Error && err.message.includes("すでに")
          ? t.conflictError
          : t.unknownError;
      toast.error(msg);
    } finally {
      setSubmittingStart(false);
    }
  }

  async function handleEnd() {
    setSubmittingEnd(true);
    try {
      const result: DealerEventReportResult = await submitDealerEndReportAction({ eventId });
      if (result.warning === "START_MISSING") {
        toast.warning(t.startMissingWarning);
      } else {
        toast.success(t.endSuccess);
      }
    } catch (err) {
      const msg =
        err instanceof Error && err.message.includes("すでに")
          ? t.conflictError
          : t.unknownError;
      toast.error(msg);
    } finally {
      setSubmittingEnd(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Button
        onClick={handleStart}
        disabled={hasDealerStart || submittingStart}
        size="sm"
      >
        {submittingStart
          ? t.submitting
          : hasDealerStart
            ? t.startAlreadySubmitted
            : t.submitStart}
      </Button>
      <Button
        onClick={handleEnd}
        disabled={hasDealerEnd || submittingEnd}
        variant="outline"
        size="sm"
      >
        {submittingEnd
          ? t.submitting
          : hasDealerEnd
            ? t.endAlreadySubmitted
            : t.submitEnd}
      </Button>
    </div>
  );
}
