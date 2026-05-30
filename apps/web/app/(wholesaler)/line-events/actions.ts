"use server";

// Server Action for the line-event workflow (F-059 / レーン登録).
//
// Wired through the canonical `withServerActionContext` three-step idiom
// (auth → assertCan → withTenant). wholesalerId / createdBy are injected from
// the tenant context — callers MUST NOT pass them as input.

import { LineEventInputSchema, type LineEventInput } from "@solar/contracts";
import { revalidatePath } from "next/cache";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

const LIST_PATH = "/line-events";

export interface CreateLineEventResult {
  id: string;
}

export const createLineEventAction = withServerActionContext<
  LineEventInput,
  CreateLineEventResult
>(
  {
    action: "line_event.create",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("wholesalerId is required for line event");
    }
    const parsed = LineEventInputSchema.parse(input);

    // Defence in depth — RLS + assertCan already restrict tenants, but we also
    // verify any provided venueProvider is owned by the caller's wholesaler.
    if (parsed.venueProviderId) {
      const provider = await tx.venueProvider.findUnique({
        where: { id: parsed.venueProviderId },
        select: { id: true },
      });
      if (!provider) {
        throw new NotFoundError("場所提供元が見つかりません");
      }
    }

    // 開催体制に応じて対象外のアサインリストは空配列で保存する（自社のみ・
    // 二次店のみのときに不要な ID を残さない）。詳細側 updateLineAssignAction と同じ規則。
    const staffIds =
      parsed.assignMode === "SELF" || parsed.assignMode === "JOINT"
        ? (parsed.assignStaffIds ?? [])
        : [];
    const dealerIds =
      parsed.assignMode === "DEALER" || parsed.assignMode === "JOINT"
        ? (parsed.assignDealerIds ?? [])
        : [];

    const created = await tx.lineEvent.create({
      data: {
        wholesalerId: ctx.wholesalerId,
        venueProviderId: parsed.venueProviderId,
        name: parsed.name,
        targetMonth: parsed.targetMonth,
        area: parsed.area,
        address: parsed.address,
        scheduledDates: parsed.scheduledDates,
        contractType: parsed.contractType,
        fixedFee: parsed.fixedFee,
        performanceRate: parsed.performanceRate,
        contractNote: parsed.contractNote,
        status: parsed.status ?? "DRAFT",
        assignMode: parsed.assignMode,
        assignStatus: parsed.assignStatus,
        assignStaffIds: staffIds,
        assignDealerIds: dealerIds,
        assignNote: parsed.assignNote,
        createdBy: ctx.actorUserId,
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    return { id: created.id };
  },
);
