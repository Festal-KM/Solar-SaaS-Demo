"use server";

// Monthly report comment + finalize/unlock Server Actions — T-06-08/T-06-09 / F-049/F-050 / docs/05 §4.9.
//
// submitCommentAction  (DEALER_ADMIN)    DRAFT → SUBMITTED, sets submittedAt + comments JSON.
// reviewCommentAction  (WHOLESALER_ADMIN) SUBMITTED → REVIEWED, sets reviewedAt + optional reviewComment.
// finalizeReportAction (WHOLESALER_ADMIN) REVIEWED → FINALIZED, freezes aggregated snapshot.
// unlockReportAction   (WHOLESALER_ADMIN) FINALIZED → REVIEWED, reason mandatory (audit log TODO SP-07).
//
// Status guard: FINALIZED reports are locked — submit/review throw ConflictError (409).
// wholesalerId is taken from ctx; the caller never supplies it in input.

import { revalidatePath } from "next/cache";

import {
  MonthlyReportFinalizeSchema,
  MonthlyReportReviewSchema,
  MonthlyReportSubmitCommentSchema,
  MonthlyReportUnlockSchema,
  type MonthlyReportFinalizeInput,
  type MonthlyReportReviewInput,
  type MonthlyReportSubmitCommentInput,
  type MonthlyReportUnlockInput,
} from "@solar/contracts";

import { ConflictError, InvalidStateTransitionError, NotFoundError } from "@/lib/errors";
import { notificationService } from "@/lib/notifications/notification-service";
import { resolveDealerAdmins, resolveWholesalerAdmins } from "@/lib/notifications/recipient-helpers";
import { withServerActionContext } from "@/lib/tenancy/server-action";
import { recordAudit } from "@/lib/audit/audit-service";

// ---------------------------------------------------------------------------
// submitCommentAction
// ---------------------------------------------------------------------------

export interface SubmitCommentResult {
  reportId: string;
  status: string;
}

export const submitCommentAction = withServerActionContext<
  MonthlyReportSubmitCommentInput,
  SubmitCommentResult
>(
  { action: "monthly_report.submit_comments" },
  async ({ tx, ctx, input }) => {
    const parsed = MonthlyReportSubmitCommentSchema.parse(input);
    const now = new Date();

    const report = await tx.monthlyReport.findUnique({
      where: { id: parsed.reportId },
      select: { id: true, status: true, relationshipId: true, wholesalerId: true, targetMonth: true },
    });

    if (!report) throw new NotFoundError("月次報告が見つかりません");

    if (report.status === "FINALIZED") {
      throw new ConflictError("確定済みの月次報告はコメントを変更できません", {
        reportId: report.id,
        status: report.status,
      });
    }

    // Dealers can only update their own relationship's reports.
    if (ctx.relationshipIds && ctx.relationshipIds.length > 0) {
      const relId = report.relationshipId;
      if (relId && !ctx.relationshipIds.includes(relId)) {
        throw new ConflictError("この月次報告にアクセスできません");
      }
    }

    if (report.status !== "DRAFT") {
      throw new InvalidStateTransitionError(
        `下書き状態の月次報告のみコメントを提出できます（現在: ${report.status}）`,
        { currentStatus: report.status },
      );
    }

    const updated = await tx.monthlyReport.update({
      where: { id: parsed.reportId },
      data: {
        comments: parsed.comments,
        status: "SUBMITTED",
        submittedAt: now,
      },
      select: { id: true, status: true },
    });

    // Notify WHOLESALER_ADMIN that a dealer submitted their monthly comments.
    const wsAdmins = await resolveWholesalerAdmins(tx, report.wholesalerId);
    if (wsAdmins.length > 0) {
      await notificationService.fire(tx, {
        type: "MONTHLY_REPORT_SUBMITTED",
        recipientUserIds: wsAdmins,
        tenantId: report.wholesalerId,
        params: { targetMonth: report.targetMonth },
        dedupKey: `MONTHLY_REPORT_SUBMITTED:${parsed.reportId}`,
      });
    }

    revalidatePath(`/monthly-reports/${parsed.reportId}`);

    return { reportId: updated.id, status: updated.status };
  },
);

// ---------------------------------------------------------------------------
// reviewCommentAction
// ---------------------------------------------------------------------------

export interface ReviewCommentResult {
  reportId: string;
  status: string;
}

export const reviewCommentAction = withServerActionContext<
  MonthlyReportReviewInput,
  ReviewCommentResult
>(
  { action: "monthly_report.review" },
  async ({ tx, ctx, input }) => {
    const parsed = MonthlyReportReviewSchema.parse(input);
    const now = new Date();

    const report = await tx.monthlyReport.findUnique({
      where: { id: parsed.reportId },
      select: { id: true, status: true, wholesalerId: true, comments: true },
    });

    if (!report) throw new NotFoundError("月次報告が見つかりません");

    // Wholesaler can only review reports belonging to their tenant.
    if (ctx.wholesalerId && report.wholesalerId !== ctx.wholesalerId) {
      throw new NotFoundError("月次報告が見つかりません");
    }

    if (report.status === "FINALIZED") {
      throw new ConflictError("確定済みの月次報告は確認操作できません", {
        reportId: report.id,
        status: report.status,
      });
    }

    if (report.status !== "SUBMITTED") {
      throw new InvalidStateTransitionError(
        `提出済み状態の月次報告のみ確認できます（現在: ${report.status}）`,
        { currentStatus: report.status },
      );
    }

    // Merge reviewComment into the existing comments JSON.
    const existingComments =
      report.comments && typeof report.comments === "object" && !Array.isArray(report.comments)
        ? (report.comments as Record<string, unknown>)
        : {};

    const updatedComments = parsed.reviewComment
      ? { ...existingComments, reviewComment: parsed.reviewComment, reviewedBy: ctx.actorUserId }
      : existingComments;

    const updated = await tx.monthlyReport.update({
      where: { id: parsed.reportId },
      data: {
        // Cast to satisfy Prisma's InputJsonValue — the value is a plain
        // string-keyed object with string values, which is valid Json.
        comments: updatedComments as Record<string, string>,
        status: "REVIEWED",
        reviewedAt: now,
      },
      select: { id: true, status: true },
    });

    revalidatePath(`/monthly-reports/${parsed.reportId}`);

    return { reportId: updated.id, status: updated.status };
  },
);

// ---------------------------------------------------------------------------
// finalizeReportAction — WHOLESALER_ADMIN: REVIEWED → FINALIZED (F-050)
// ---------------------------------------------------------------------------

export interface FinalizeReportResult {
  reportId: string;
  status: string;
  finalizedAt: string;
}

export const finalizeReportAction = withServerActionContext<
  MonthlyReportFinalizeInput,
  FinalizeReportResult
>(
  { action: "monthly_report.finalize" },
  async ({ tx, ctx, input }) => {
    const parsed = MonthlyReportFinalizeSchema.parse(input);
    const now = new Date();

    const report = await tx.monthlyReport.findUnique({
      where: { id: parsed.reportId },
      select: { id: true, status: true, wholesalerId: true, aggregated: true, relationshipId: true, targetMonth: true },
    });

    if (!report) throw new NotFoundError("月次報告が見つかりません");

    if (ctx.wholesalerId && report.wholesalerId !== ctx.wholesalerId) {
      throw new NotFoundError("月次報告が見つかりません");
    }

    if (report.status === "FINALIZED") {
      throw new ConflictError("すでに確定済みの月次報告です", {
        reportId: report.id,
        status: report.status,
      });
    }

    if (report.status !== "REVIEWED") {
      throw new InvalidStateTransitionError(
        `確認済み状態の月次報告のみ確定できます（現在: ${report.status}）`,
        { currentStatus: report.status },
      );
    }

    const updated = await tx.monthlyReport.update({
      where: { id: parsed.reportId },
      data: {
        status: "FINALIZED",
        finalizedAt: now,
        finalizedBy: ctx.actorUserId,
        // Re-write aggregated as snapshot freeze — value is unchanged; the
        // status transition signals the lock to other services (docs/05 §5.2).
        aggregated: report.aggregated as object,
      },
      select: { id: true, status: true, finalizedAt: true },
    });

    await recordAudit(tx, {
      actorUserId: ctx.actorUserId,
      action: "FINALIZE",
      targetType: "MonthlyReport",
      targetId: parsed.reportId,
      tenantId: ctx.tenantId ?? ctx.wholesalerId ?? "",
      before: { status: "REVIEWED" },
      after: { status: "FINALIZED" },
    });

    // Notify the dealer admins that the monthly report is finalized (→ incentive confirmed).
    if (report.relationshipId) {
      const dealerAdmins = await resolveDealerAdmins(tx, report.relationshipId);
      if (dealerAdmins.length > 0) {
        await notificationService.fire(tx, {
          type: "INCENTIVE_FINALIZED",
          recipientUserIds: dealerAdmins,
          tenantId: report.wholesalerId,
          params: { targetMonth: report.targetMonth },
          dedupKey: `INCENTIVE_FINALIZED:monthly:${parsed.reportId}`,
        });
      }
    }

    revalidatePath(`/monthly-reports/${parsed.reportId}`);

    return {
      reportId: updated.id,
      status: updated.status,
      finalizedAt: updated.finalizedAt!.toISOString(),
    };
  },
);

// ---------------------------------------------------------------------------
// unlockReportAction — WHOLESALER_ADMIN: FINALIZED → REVIEWED (F-050 / OQ-13)
// ---------------------------------------------------------------------------

export interface UnlockReportResult {
  reportId: string;
  status: string;
}

export const unlockReportAction = withServerActionContext<
  MonthlyReportUnlockInput,
  UnlockReportResult
>(
  { action: "monthly_report.unlock" },
  async ({ tx, ctx, input }) => {
    const parsed = MonthlyReportUnlockSchema.parse(input);

    const report = await tx.monthlyReport.findUnique({
      where: { id: parsed.reportId },
      select: { id: true, status: true, wholesalerId: true },
    });

    if (!report) throw new NotFoundError("月次報告が見つかりません");

    if (ctx.wholesalerId && report.wholesalerId !== ctx.wholesalerId) {
      throw new NotFoundError("月次報告が見つかりません");
    }

    if (report.status !== "FINALIZED") {
      throw new InvalidStateTransitionError(
        `確定済み状態の月次報告のみアンロックできます（現在: ${report.status}）`,
        { currentStatus: report.status },
      );
    }

    const updated = await tx.monthlyReport.update({
      where: { id: parsed.reportId },
      data: {
        status: "REVIEWED",
        finalizedAt: null,
        finalizedBy: null,
      },
      select: { id: true, status: true },
    });

    await recordAudit(tx, {
      actorUserId: ctx.actorUserId,
      action: "UNLOCK",
      targetType: "MonthlyReport",
      targetId: parsed.reportId,
      tenantId: ctx.tenantId ?? ctx.wholesalerId ?? "",
      before: { status: "FINALIZED" },
      after: { status: "REVIEWED", reason: parsed.reason },
    });

    revalidatePath(`/monthly-reports/${parsed.reportId}`);

    return { reportId: updated.id, status: updated.status };
  },
);
