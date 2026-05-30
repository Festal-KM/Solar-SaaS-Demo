"use server";

// Server Actions for EventReport start / end — dealer side (T-04-03 / F-028 /
// F-029 / docs/05 §4.6).
//
// Dealer perspective — reporterOrgType is always DEALER.
//
// Uniqueness rule: one START and one END per (event, DEALER). In JOINT mode
// the wholesaler submits its own pair independently.
// For SELF-mode events (wholesaler-only), dealers are not in EventDealer, so
// the EventDealer membership check below will throw NotFoundError (404) before
// reaching the create call.

import { revalidatePath } from "next/cache";

import {
  EventReportEndSchema,
  EventReportResultSchema,
  EventReportStartSchema,
  type EventReportEndInput,
  type EventReportResultInput,
  type EventReportStartInput,
} from "@solar/contracts";

import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

export interface DealerEventReportResult {
  reportId: string;
  eventId: string;
  warning?: "START_MISSING";
}

export interface DealerEventResultReportResult {
  reportId: string;
  eventId: string;
}

// ── submitDealerStartReportAction ────────────────────────────────────────────

export const submitDealerStartReportAction = withServerActionContext<
  EventReportStartInput,
  DealerEventReportResult
>(
  {
    action: "event_report.submit",
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.dealerId || !ctx.relationshipIds || ctx.relationshipIds.length === 0) {
      throw new ValidationError("二次店コンテキストが必要です");
    }

    const parsed = EventReportStartSchema.parse(input);

    // Verify this dealer is assigned to the event.
    const eventDealer = await tx.eventDealer.findFirst({
      where: {
        eventId: parsed.eventId,
        relationshipId: { in: ctx.relationshipIds },
      },
      select: { relationshipId: true, event: { select: { id: true } } },
    });
    if (!eventDealer) {
      throw new NotFoundError("イベントが見つかりません");
    }

    // Duplicate check: one START per event per DEALER.
    const existing = await tx.eventReport.findFirst({
      where: {
        eventId: parsed.eventId,
        type: "START",
        reporterOrgType: "DEALER",
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError("この組織はすでに開始報告を提出済みです");
    }

    const report = await tx.eventReport.create({
      data: {
        eventId: parsed.eventId,
        type: "START",
        reporterUserId: ctx.actorUserId,
        reporterOrgType: "DEALER",
        payload: {
          comment: parsed.comment ?? null,
          attachments: parsed.attachments ?? [],
          relationshipId: eventDealer.relationshipId,
        },
      },
      select: { id: true, eventId: true },
    });

    revalidatePath(`/d-events/${parsed.eventId}`);
    return { reportId: report.id, eventId: report.eventId };
  },
);

// ── submitDealerEndReportAction ──────────────────────────────────────────────

export const submitDealerEndReportAction = withServerActionContext<
  EventReportEndInput,
  DealerEventReportResult
>(
  {
    action: "event_report.submit",
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.dealerId || !ctx.relationshipIds || ctx.relationshipIds.length === 0) {
      throw new ValidationError("二次店コンテキストが必要です");
    }

    const parsed = EventReportEndSchema.parse(input);

    const eventDealer = await tx.eventDealer.findFirst({
      where: {
        eventId: parsed.eventId,
        relationshipId: { in: ctx.relationshipIds },
      },
      select: { relationshipId: true, event: { select: { id: true } } },
    });
    if (!eventDealer) {
      throw new NotFoundError("イベントが見つかりません");
    }

    // Duplicate check: one END per event per DEALER.
    const existingEnd = await tx.eventReport.findFirst({
      where: {
        eventId: parsed.eventId,
        type: "END",
        reporterOrgType: "DEALER",
      },
      select: { id: true },
    });
    if (existingEnd) {
      throw new ConflictError("この組織はすでに終了報告を提出済みです");
    }

    // Check for prior START — warn but do not block.
    const hasStart = await tx.eventReport.findFirst({
      where: {
        eventId: parsed.eventId,
        type: "START",
        reporterOrgType: "DEALER",
      },
      select: { id: true },
    });

    const report = await tx.eventReport.create({
      data: {
        eventId: parsed.eventId,
        type: "END",
        reporterUserId: ctx.actorUserId,
        reporterOrgType: "DEALER",
        payload: {
          comment: parsed.comment ?? null,
          attachments: parsed.attachments ?? [],
          relationshipId: eventDealer.relationshipId,
        },
      },
      select: { id: true, eventId: true },
    });

    revalidatePath(`/d-events/${parsed.eventId}`);
    return {
      reportId: report.id,
      eventId: report.eventId,
      ...(hasStart ? {} : { warning: "START_MISSING" as const }),
    };
  },
);

// ── submitDealerResultReportAction ───────────────────────────────────────────

export const submitDealerResultReportAction = withServerActionContext<
  EventReportResultInput,
  DealerEventResultReportResult
>(
  {
    action: "event_report.submit",
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.dealerId || !ctx.relationshipIds || ctx.relationshipIds.length === 0) {
      throw new ValidationError("二次店コンテキストが必要です");
    }

    const parsed = EventReportResultSchema.parse(input);

    const eventDealer = await tx.eventDealer.findFirst({
      where: {
        eventId: parsed.eventId,
        relationshipId: { in: ctx.relationshipIds },
      },
      select: { relationshipId: true, event: { select: { id: true } } },
    });
    if (!eventDealer) {
      throw new NotFoundError("イベントが見つかりません");
    }

    // One RESULT per event per DEALER org.
    const existing = await tx.eventReport.findFirst({
      where: {
        eventId: parsed.eventId,
        type: "RESULT",
        reporterOrgType: "DEALER",
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError("この組織はすでに成果報告を提出済みです");
    }

    const report = await tx.eventReport.create({
      data: {
        eventId: parsed.eventId,
        type: "RESULT",
        reporterUserId: ctx.actorUserId,
        reporterOrgType: "DEALER",
        payload: {
          approachCount: parsed.approachCount,
          surveyCount: parsed.surveyCount,
          totalAppts: parsed.totalAppts,
          validAppts: parsed.validAppts,
          invalidAppts: parsed.invalidAppts,
          comment: parsed.comment ?? null,
          relationshipId: eventDealer.relationshipId,
        },
      },
      select: { id: true, eventId: true },
    });

    revalidatePath(`/d-events/${parsed.eventId}`);
    return { reportId: report.id, eventId: report.eventId };
  },
);
