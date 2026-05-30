"use server";

// Server Actions for the line-event detail screen (F-059 / レーン詳細).
//
// Wired through the canonical `withServerActionContext` three-step idiom
// (auth → assertCan → withTenant). No dedicated line_event.update permission
// exists yet, so we reuse line_event.create (same role set:
// wholesaler_admin / wholesaler_event_team). wholesalerId is verified against
// the tenant context — callers MUST NOT pass it as input.

import { LineEventStatusSchema, type LineEventStatus } from "@solar/contracts";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

function detailPath(id: string): string {
  return `/line-events/${id}`;
}

export interface UpdateLineStatusInput {
  id: string;
  status: LineEventStatus;
}

export const updateLineStatusAction = withServerActionContext<UpdateLineStatusInput, void>(
  {
    action: "line_event.create",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("wholesalerId is required for line event");
    }
    const status = LineEventStatusSchema.parse(input.status);

    const existing = await tx.lineEvent.findUnique({
      where: { id: input.id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundError("レーンが見つかりません");
    }

    await tx.lineEvent.update({
      where: { id: input.id },
      data: { status },
    });

    revalidatePath(detailPath(input.id));
  },
);

const ScheduledDatesSchema = z
  .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
  .min(1);

export const updateLineDatesAction = withServerActionContext<
  { id: string; scheduledDates: string[] },
  void
>(
  {
    action: "line_event.create",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("wholesalerId is required for line event");
    }
    const scheduledDates = ScheduledDatesSchema.parse(input.scheduledDates);

    const existing = await tx.lineEvent.findUnique({
      where: { id: input.id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundError("レーンが見つかりません");
    }

    await tx.lineEvent.update({
      where: { id: input.id },
      data: { scheduledDates },
    });

    revalidatePath(detailPath(input.id));
  },
);

const UpdateLineAssignSchema = z.object({
  id: z.string().min(1),
  assignMode: z.enum(["SELF", "DEALER", "JOINT"]),
  assignStaffIds: z.array(z.string().min(1)),
  assignDealerIds: z.array(z.string().min(1)),
  assignStatus: z.enum(["CONFIRMED", "ADJUSTING"]),
  assignNote: z.string().optional(),
});

export type UpdateLineAssignInput = z.infer<typeof UpdateLineAssignSchema>;

export const updateLineAssignAction = withServerActionContext<UpdateLineAssignInput, void>(
  {
    action: "line_event.create",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("wholesalerId is required for line event");
    }
    const parsed = UpdateLineAssignSchema.parse(input);

    const existing = await tx.lineEvent.findUnique({
      where: { id: parsed.id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundError("レーンが見つかりません");
    }

    // 開催体制に応じて、対象外のリストは空配列として保存する（自社のみ・
    // 二次店のみのときに不要な ID を残さない）。
    const staffIds =
      parsed.assignMode === "SELF" || parsed.assignMode === "JOINT" ? parsed.assignStaffIds : [];
    const dealerIds =
      parsed.assignMode === "DEALER" || parsed.assignMode === "JOINT" ? parsed.assignDealerIds : [];

    await tx.lineEvent.update({
      where: { id: parsed.id },
      data: {
        assignMode: parsed.assignMode,
        assignStatus: parsed.assignStatus,
        assignStaffIds: staffIds,
        assignDealerIds: dealerIds,
        assignNote: parsed.assignNote?.trim() ? parsed.assignNote.trim() : null,
      },
    });

    revalidatePath(detailPath(parsed.id));
  },
);
