// Zod schemas for monthly report comment submit / review (T-06-08 / F-049 / docs/05 §4.9).
//
// MonthlyReportSubmitCommentSchema — DEALER_ADMIN: attach structured comments and
//   transition MonthlyReport status DRAFT → SUBMITTED.
//
// MonthlyReportReviewSchema — WHOLESALER_ADMIN: acknowledge the submitted comment and
//   transition SUBMITTED → REVIEWED.
//
// Both schemas are consumed by the corresponding Server Actions and shared with UI
// forms so validation stays in one place.

import { z } from "zod";

export const MonthlyReportCommentsSchema = z.object({
  mainResults: z.string().max(2000).optional(),
  issues: z.string().max(2000).optional(),
  improvements: z.string().max(2000).optional(),
  nextMonthFocusStores: z.string().max(2000).optional(),
  nextMonthMeasures: z.string().max(2000).optional(),
  dealerComment: z.string().max(2000).optional(),
});

export type MonthlyReportComments = z.infer<typeof MonthlyReportCommentsSchema>;

export const MonthlyReportSubmitCommentSchema = z.object({
  reportId: z.string().min(1, "レポート ID が必要です"),
  comments: MonthlyReportCommentsSchema,
});

export type MonthlyReportSubmitCommentInput = z.infer<typeof MonthlyReportSubmitCommentSchema>;

export const MonthlyReportReviewSchema = z.object({
  reportId: z.string().min(1, "レポート ID が必要です"),
  reviewComment: z.string().max(2000).optional(),
});

export type MonthlyReportReviewInput = z.infer<typeof MonthlyReportReviewSchema>;

// MonthlyReportFinalizeSchema — WHOLESALER_ADMIN: lock REVIEWED → FINALIZED.
// Snapshot is frozen at this point; further adjustJoint / grossProfit.recalc
// calls against the same month return 409.
export const MonthlyReportFinalizeSchema = z.object({
  reportId: z.string().min(1, "レポート ID が必要です"),
});

export type MonthlyReportFinalizeInput = z.infer<typeof MonthlyReportFinalizeSchema>;

// MonthlyReportUnlockSchema — WHOLESALER_ADMIN: revert FINALIZED → REVIEWED.
// reason is mandatory and written to the audit log.
export const MonthlyReportUnlockSchema = z.object({
  reportId: z.string().min(1, "レポート ID が必要です"),
  reason: z.string().min(1, "アンロック理由を入力してください").max(500),
});

export type MonthlyReportUnlockInput = z.infer<typeof MonthlyReportUnlockSchema>;
