"use server";

// Monthly report aggregate Server Action — T-06-12 / F-048 / docs/05 §4.9.
//
// runAggregateAction (WHOLESALER_ADMIN)
//   Runs aggregation for the caller's wholesaler + targetMonth in-process
//   (bypasses graphile-worker for synchronous E2E test usage / on-demand re-run).
//   wholesalerId is taken from ctx — never from input.

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withServerActionContext } from "@/lib/tenancy/server-action";
import { aggregateForMonth } from "@/lib/domain/monthly-report";

const RunAggregateInputSchema = z.object({
  targetMonth: z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM 形式で入力してください"),
});

type RunAggregateInput = z.infer<typeof RunAggregateInputSchema>;

export interface RunAggregateResult {
  reportCount: number;
  targetMonth: string;
}

export const runAggregateAction = withServerActionContext<
  RunAggregateInput,
  RunAggregateResult
>(
  { action: "monthly_report.run_aggregate" },
  async ({ tx, ctx, input }) => {
    const parsed = RunAggregateInputSchema.parse(input);

    if (!ctx.wholesalerId) {
      throw new Error("卸業者コンテキストが見つかりません");
    }

    const reports = await aggregateForMonth(tx, ctx.wholesalerId, parsed.targetMonth);

    revalidatePath("/monthly-reports");

    return {
      reportCount: reports.length,
      targetMonth: parsed.targetMonth,
    };
  },
);
