"use server";

// Construction Server Actions — T-05-10 / F-044 / docs/05 §3.6 §4.8.
//
// createConstructionAction:  Creates a Construction record for a given contract.
// updateConstructionAction:  Updates cost / dates / note; when fee changes,
//                            delegates to recalcGrossProfitAction for recalc.
// changeConstructionStatusAction: Validates state-machine transition and
//                            updates the status field.
//
// wholesalerId never comes from input — always from ctx.

import { revalidatePath } from "next/cache";

import {
  ConstructionChangeStatusSchema,
  ConstructionCreateSchema,
  ConstructionUpdateSchema,
  VALID_CONSTRUCTION_TRANSITIONS,
  type ConstructionChangeStatusInput,
  type ConstructionCreateInput,
  type ConstructionUpdateInput,
} from "@solar/contracts";
import type { ConstructionStatus } from "@solar/db";

import { InvalidStateTransitionError, NotFoundError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

import { recalcGrossProfitInternal } from "../gross-profit/recalc";

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface ConstructionResult {
  id: string;
  contractId: string;
  installerId: string | null;
  status: ConstructionStatus;
  fee: string | null;
  surveyDate: string | null;
  plannedDate: string | null;
  completedDate: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// createConstructionAction
// ---------------------------------------------------------------------------

export const createConstructionAction = withServerActionContext<
  ConstructionCreateInput,
  ConstructionResult
>(
  { action: "construction.manage" },
  async ({ tx, input }) => {
    const parsed = ConstructionCreateSchema.parse(input);

    // Verify the contract exists under this tenant (RLS ensures tenant scope).
    const contract = await tx.contract.findUnique({
      where: { id: parsed.contractId },
      select: { id: true, status: true },
    });
    if (!contract) throw new NotFoundError("契約が見つかりません");
    if (contract.status === "CANCELLED") {
      throw new InvalidStateTransitionError("キャンセルされた契約には施工を登録できません");
    }

    const row = await tx.construction.create({
      data: {
        contractId: parsed.contractId,
        installerId: parsed.installerId ?? null,
        fee: parsed.fee,
        surveyDate: parsed.surveyDate ? new Date(parsed.surveyDate) : null,
        plannedDate: parsed.plannedDate ? new Date(parsed.plannedDate) : null,
        note: parsed.note ?? null,
      },
      select: {
        id: true,
        contractId: true,
        installerId: true,
        status: true,
        fee: true,
        surveyDate: true,
        plannedDate: true,
        completedDate: true,
        note: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    revalidatePath(`/contracts/${parsed.contractId}`);
    revalidatePath(`/contracts/${parsed.contractId}/construction`);

    return toConstructionResult(row);
  },
);

// ---------------------------------------------------------------------------
// updateConstructionAction
// ---------------------------------------------------------------------------

export const updateConstructionAction = withServerActionContext<
  ConstructionUpdateInput,
  ConstructionResult
>(
  { action: "construction.manage" },
  async ({ tx, input }) => {
    const parsed = ConstructionUpdateSchema.parse(input);

    const existing = await tx.construction.findUnique({
      where: { id: parsed.id },
      select: { id: true, contractId: true, fee: true },
    });
    if (!existing) throw new NotFoundError("施工情報が見つかりません");

    const feeChanged =
      parsed.fee !== undefined &&
      parsed.fee !== (existing.fee?.toString() ?? "0");

    const updated = await tx.construction.update({
      where: { id: parsed.id },
      data: {
        ...(parsed.installerId !== undefined ? { installerId: parsed.installerId } : {}),
        ...(parsed.fee !== undefined ? { fee: parsed.fee } : {}),
        ...(parsed.surveyDate !== undefined
          ? { surveyDate: parsed.surveyDate ? new Date(parsed.surveyDate) : null }
          : {}),
        ...(parsed.plannedDate !== undefined
          ? { plannedDate: parsed.plannedDate ? new Date(parsed.plannedDate) : null }
          : {}),
        ...(parsed.completedDate !== undefined
          ? { completedDate: parsed.completedDate ? new Date(parsed.completedDate) : null }
          : {}),
        ...(parsed.note !== undefined ? { note: parsed.note } : {}),
      },
      select: {
        id: true,
        contractId: true,
        installerId: true,
        status: true,
        fee: true,
        surveyDate: true,
        plannedDate: true,
        completedDate: true,
        note: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    revalidatePath(`/contracts/${existing.contractId}`);
    revalidatePath(`/contracts/${existing.contractId}/construction`);

    // When fee changes, re-derive gross profit using the existing GrossProfit
    // record's current cost breakdown — keeps constructionFee in sync.
    if (feeChanged) {
      const grossProfit = await tx.grossProfit.findUnique({
        where: { contractId: existing.contractId },
        select: {
          salesPrice: true,
          otherCost: true,
          discount: true,
          incentiveTargetType: true,
          incentiveTargetProfit: true,
        },
      });

      if (grossProfit) {
        await recalcGrossProfitInternal(tx, {
          contractId: existing.contractId,
          salesPrice: grossProfit.salesPrice.toString(),
          constructionFee: parsed.fee ?? "0",
          otherCost: grossProfit.otherCost.toString(),
          discount: grossProfit.discount.toString(),
          incentiveTargetType: grossProfit.incentiveTargetType as
            | "PROJECT_PROFIT"
            | "WHOLESALE_PROFIT"
            | "MANUAL",
        });
      }
    }

    return toConstructionResult(updated);
  },
);

// ---------------------------------------------------------------------------
// changeConstructionStatusAction
// ---------------------------------------------------------------------------

export const changeConstructionStatusAction = withServerActionContext<
  ConstructionChangeStatusInput,
  ConstructionResult
>(
  { action: "construction.manage" },
  async ({ tx, input }) => {
    const parsed = ConstructionChangeStatusSchema.parse(input);

    const existing = await tx.construction.findUnique({
      where: { id: parsed.id },
      select: { id: true, contractId: true, status: true },
    });
    if (!existing) throw new NotFoundError("施工情報が見つかりません");

    const allowed = VALID_CONSTRUCTION_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(parsed.status)) {
      throw new InvalidStateTransitionError(
        `${existing.status} から ${parsed.status} への遷移はできません`,
        { from: existing.status, to: parsed.status },
      );
    }

    const completedDate =
      parsed.status === "DONE" ? new Date() : undefined;

    const updated = await tx.construction.update({
      where: { id: parsed.id },
      data: {
        status: parsed.status,
        ...(completedDate !== undefined ? { completedDate } : {}),
      },
      select: {
        id: true,
        contractId: true,
        installerId: true,
        status: true,
        fee: true,
        surveyDate: true,
        plannedDate: true,
        completedDate: true,
        note: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    revalidatePath(`/contracts/${existing.contractId}`);
    revalidatePath(`/contracts/${existing.contractId}/construction`);

    return toConstructionResult(updated);
  },
);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function toConstructionResult(row: {
  id: string;
  contractId: string;
  installerId: string | null;
  status: ConstructionStatus;
  fee: { toString(): string } | null;
  surveyDate: Date | null;
  plannedDate: Date | null;
  completedDate: Date | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ConstructionResult {
  return {
    id: row.id,
    contractId: row.contractId,
    installerId: row.installerId,
    status: row.status,
    fee: row.fee?.toString() ?? null,
    surveyDate: row.surveyDate?.toISOString() ?? null,
    plannedDate: row.plannedDate?.toISOString() ?? null,
    completedDate: row.completedDate?.toISOString() ?? null,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
