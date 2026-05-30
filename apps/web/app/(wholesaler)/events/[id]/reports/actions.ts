"use server";

// Server Actions for EventReport start / end (T-04-03 / F-028 / F-029 /
// docs/05 §4.6).
//
// Wholesaler perspective — reporterOrgType is always WHOLESALER.
//
// Uniqueness rule (docs/02 §F-028 §F-029):
//   - SELF / DEALER mode: exactly 1 START and 1 END per event (for the
//     single participating org).
//   - JOINT mode: wholesaler contributes 1 START + 1 END; the dealer
//     contributes its own 1 START + 1 END via the dealer-side action.
//   Duplicates are detected at app layer (findFirst) and thrown as
//   ConflictError so no @@unique migration is required on EventReport.
//
// Warning instead of error when END is submitted without prior START:
//   The action succeeds but sets `warning: "START_MISSING"` on the result.
//   The UI surfaces a non-blocking warning toast.

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

export interface EventReportResult {
  reportId: string;
  eventId: string;
  warning?: "START_MISSING";
}

export interface EventResultReportResult {
  reportId: string;
  eventId: string;
}

// ── submitStartReportAction ──────────────────────────────────────────────────

export const submitStartReportAction = withServerActionContext<
  EventReportStartInput,
  EventReportResult
>(
  {
    action: "event_report.submit",
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("卸業者コンテキストが必要です");
    }

    const parsed = EventReportStartSchema.parse(input);

    // Verify the event belongs to this wholesaler.
    const event = await tx.event.findUnique({
      where: { id: parsed.eventId },
      select: { id: true, wholesalerId: true },
    });
    if (!event) {
      throw new NotFoundError("イベントが見つかりません");
    }
    if (event.wholesalerId !== ctx.wholesalerId) {
      throw new NotFoundError("イベントが見つかりません");
    }

    // Duplicate check: one START per event per org type (WHOLESALER).
    const existing = await tx.eventReport.findFirst({
      where: {
        eventId: parsed.eventId,
        type: "START",
        reporterOrgType: "WHOLESALER",
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
        reporterOrgType: "WHOLESALER",
        payload: {
          comment: parsed.comment ?? null,
          attachments: parsed.attachments ?? [],
        },
      },
      select: { id: true, eventId: true },
    });

    revalidatePath(`/events/${parsed.eventId}`);
    return { reportId: report.id, eventId: report.eventId };
  },
);

// ── submitEndReportAction ────────────────────────────────────────────────────

export const submitEndReportAction = withServerActionContext<
  EventReportEndInput,
  EventReportResult
>(
  {
    action: "event_report.submit",
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("卸業者コンテキストが必要です");
    }

    const parsed = EventReportEndSchema.parse(input);

    const event = await tx.event.findUnique({
      where: { id: parsed.eventId },
      select: { id: true, wholesalerId: true },
    });
    if (!event) {
      throw new NotFoundError("イベントが見つかりません");
    }
    if (event.wholesalerId !== ctx.wholesalerId) {
      throw new NotFoundError("イベントが見つかりません");
    }

    // Duplicate check: one END per event per org type (WHOLESALER).
    const existingEnd = await tx.eventReport.findFirst({
      where: {
        eventId: parsed.eventId,
        type: "END",
        reporterOrgType: "WHOLESALER",
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
        reporterOrgType: "WHOLESALER",
      },
      select: { id: true },
    });

    const report = await tx.eventReport.create({
      data: {
        eventId: parsed.eventId,
        type: "END",
        reporterUserId: ctx.actorUserId,
        reporterOrgType: "WHOLESALER",
        payload: {
          comment: parsed.comment ?? null,
          attachments: parsed.attachments ?? [],
        },
      },
      select: { id: true, eventId: true },
    });

    revalidatePath(`/events/${parsed.eventId}`);
    return {
      reportId: report.id,
      eventId: report.eventId,
      ...(hasStart ? {} : { warning: "START_MISSING" as const }),
    };
  },
);

// ── submitResultReportAction ─────────────────────────────────────────────────

export const submitResultReportAction = withServerActionContext<
  EventReportResultInput,
  EventResultReportResult
>(
  {
    action: "event_report.submit",
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("卸業者コンテキストが必要です");
    }

    const parsed = EventReportResultSchema.parse(input);

    const event = await tx.event.findUnique({
      where: { id: parsed.eventId },
      select: { id: true, wholesalerId: true },
    });
    if (!event) {
      throw new NotFoundError("イベントが見つかりません");
    }
    if (event.wholesalerId !== ctx.wholesalerId) {
      throw new NotFoundError("イベントが見つかりません");
    }

    // One RESULT per event per WHOLESALER org.
    const existing = await tx.eventReport.findFirst({
      where: {
        eventId: parsed.eventId,
        type: "RESULT",
        reporterOrgType: "WHOLESALER",
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
        reporterOrgType: "WHOLESALER",
        payload: {
          approachCount: parsed.approachCount,
          surveyCount: parsed.surveyCount,
          totalAppts: parsed.totalAppts,
          validAppts: parsed.validAppts,
          invalidAppts: parsed.invalidAppts,
          comment: parsed.comment ?? null,
        },
      },
      select: { id: true, eventId: true },
    });

    revalidatePath(`/events/${parsed.eventId}`);
    return { reportId: report.id, eventId: report.eventId };
  },
);
