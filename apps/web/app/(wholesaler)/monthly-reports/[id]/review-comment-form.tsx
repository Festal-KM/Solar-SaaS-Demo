"use client";

// ReviewCommentForm — wholesaler_admin confirms a submitted monthly report (T-06-08 / F-049).
// Shown on S-049 when MonthlyReport.status === "SUBMITTED".

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { labels } from "@/lib/i18n/labels";

import { reviewCommentAction } from "./actions";

interface ReviewCommentFormProps {
  reportId: string;
}

export function ReviewCommentForm({ reportId }: ReviewCommentFormProps) {
  const [isPending, startTransition] = useTransition();
  const tc = labels.monthlyReport.comment;

  function handleSubmit(formData: FormData) {
    const reviewComment = (formData.get("reviewComment") as string | null) ?? "";
    startTransition(async () => {
      await reviewCommentAction({ reportId, reviewComment: reviewComment || undefined });
    });
  }

  return (
    <form action={handleSubmit} className="space-y-3 border-t pt-3">
      <p className="text-xs font-medium text-muted-foreground">{tc.wholesalerCommentLabel}</p>
      <Textarea
        name="reviewComment"
        placeholder={tc.fields.reviewComment}
        rows={3}
        disabled={isPending}
      />
      <Button type="submit" disabled={isPending}>
        {isPending ? tc.reviewing : tc.reviewButton}
      </Button>
    </form>
  );
}
