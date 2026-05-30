"use client";

// SubmitCommentForm — dealer_admin inputs and submits monthly comment (T-06-08 / F-049).
// Shown on S-068 when MonthlyReport.status === "DRAFT".

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { labels } from "@/lib/i18n/labels";

import { submitCommentAction } from "../../(wholesaler)/monthly-reports/[id]/actions";

interface SubmitCommentFormProps {
  reportId: string;
}

export function SubmitCommentForm({ reportId }: SubmitCommentFormProps) {
  const [isPending, startTransition] = useTransition();
  const tc = labels.monthlyReport.comment;

  function handleSubmit(formData: FormData) {
    const getValue = (key: string) => (formData.get(key) as string | null) ?? "";
    startTransition(async () => {
      await submitCommentAction({
        reportId,
        comments: {
          mainResults: getValue("mainResults") || undefined,
          issues: getValue("issues") || undefined,
          improvements: getValue("improvements") || undefined,
          nextMonthFocusStores: getValue("nextMonthFocusStores") || undefined,
          nextMonthMeasures: getValue("nextMonthMeasures") || undefined,
          dealerComment: getValue("dealerComment") || undefined,
        },
      });
    });
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      {(
        [
          ["mainResults", tc.fields.mainResults],
          ["issues", tc.fields.issues],
          ["improvements", tc.fields.improvements],
          ["nextMonthFocusStores", tc.fields.nextMonthFocusStores],
          ["nextMonthMeasures", tc.fields.nextMonthMeasures],
          ["dealerComment", tc.fields.dealerComment],
        ] as [string, string][]
      ).map(([name, label]) => (
        <div key={name} className="space-y-1">
          <label htmlFor={name} className="text-sm font-medium">
            {label}
          </label>
          <Textarea
            id={name}
            name={name}
            rows={3}
            disabled={isPending}
          />
        </div>
      ))}

      <Button type="submit" disabled={isPending}>
        {isPending ? tc.submitting : tc.submitButton}
      </Button>
    </form>
  );
}
