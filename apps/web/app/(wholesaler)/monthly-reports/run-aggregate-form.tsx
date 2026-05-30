"use client";

// RunAggregateForm — wholesaler_admin manually triggers monthly aggregation.
// Used on S-048 月次報告一覧 (T-06-12 / F-048 / docs/05 §4.9).

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import { runAggregateAction } from "./actions";

export function RunAggregateForm() {
  const [isPending, startTransition] = useTransition();
  const t = labels.monthlyReport;

  function handleSubmit(formData: FormData) {
    const targetMonth = (formData.get("aggregateMonth") as string | null) ?? "";
    startTransition(async () => {
      try {
        const result = await runAggregateAction({ targetMonth });
        toast.success(`${t.aggregateSuccess}（${result.reportCount} 件）`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : t.aggregateError;
        toast.error(msg);
      }
    });
  }

  return (
    <form action={handleSubmit} className="flex items-center gap-2">
      <Input
        type="month"
        name="aggregateMonth"
        aria-label={t.aggregateMonthLabel}
        className="w-40"
        required
      />
      <Button type="submit" variant="secondary" disabled={isPending} data-testid="aggregate-btn">
        {isPending ? t.aggregating : t.aggregateButton}
      </Button>
    </form>
  );
}
