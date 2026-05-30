"use client";

// ReportButtons — client component for event start / end report submission
// (T-04-03 / F-028 / F-029 / docs/04 §1.3 S-031).
//
// Props indicate whether START / END have already been submitted so the
// buttons are disabled appropriately. A single submit triggers the Server
// Action and shows a sonner toast on success or error.

import { useState } from "react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import {
  submitEndReportAction,
  submitStartReportAction,
  type EventReportResult,
} from "./actions";

interface ReportButtonsProps {
  eventId: string;
  hasWholesalerStart: boolean;
  hasWholesalerEnd: boolean;
}

export function ReportButtons({ eventId, hasWholesalerStart, hasWholesalerEnd }: ReportButtonsProps) {
  const t = labels.eventReport;
  const [submittingStart, setSubmittingStart] = useState(false);
  const [submittingEnd, setSubmittingEnd] = useState(false);

  async function handleStart() {
    setSubmittingStart(true);
    try {
      await submitStartReportAction({ eventId });
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
      const result: EventReportResult = await submitEndReportAction({ eventId });
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
        disabled={hasWholesalerStart || submittingStart}
        size="sm"
      >
        {submittingStart ? t.submitting : hasWholesalerStart ? t.startAlreadySubmitted : t.submitStart}
      </Button>
      <Button
        onClick={handleEnd}
        disabled={hasWholesalerEnd || submittingEnd}
        variant="outline"
        size="sm"
      >
        {submittingEnd ? t.submitting : hasWholesalerEnd ? t.endAlreadySubmitted : t.submitEnd}
      </Button>
    </div>
  );
}
