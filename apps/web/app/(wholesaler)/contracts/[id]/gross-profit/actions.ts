"use server";

// Gross-profit Server Actions — T-05-08 / F-042 / docs/05 §4.8 §6.1.
//
// recalcGrossProfitAction:
//   • Fetches Contract + ContractItem[] + optional constructionFee input.
//   • Calls pure function computeGrossProfit().
//   • Upserts GrossProfit record inside withTenant tx.
//
// adjustGrossProfitAction:
//   • Sets incentiveTargetType = MANUAL, incentiveTargetProfit = manualValue.
//   • Records manualAdjustedBy / manualAdjustedAt / manualAdjustmentReason.
//   • Re-runs computeGrossProfit so all derived fields stay consistent.
//
// wholesalerId is always taken from ctx — never from input.

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { computeGrossProfit } from "@solar/contracts";

import { NotFoundError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";
import { recordAudit } from "@/lib/audit/audit-service";

import { recalcGrossProfitInternal } from "./recalc";

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const RecalcSchema = z.object({
  contractId: z.string().min(1, "契約 ID が必要です"),
  salesPrice: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "金額は 0 以上の数値で入力してください"),
  constructionFee: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "金額は 0 以上の数値で入力してください")
    .default("0"),
  otherCost: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "金額は 0 以上の数値で入力してください")
    .default("0"),
  discount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "金額は 0 以上の数値で入力してください")
    .default("0"),
  incentiveTargetType: z.enum(["PROJECT_PROFIT", "WHOLESALE_PROFIT", "MANUAL"]).default("PROJECT_PROFIT"),
  manualValue: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "金額は 0 以上の数値で入力してください")
    .optional(),
});

export type RecalcGrossProfitInput = z.infer<typeof RecalcSchema>;

const AdjustSchema = z.object({
  contractId: z.string().min(1, "契約 ID が必要です"),
  manualValue: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "金額は 0 以上の数値で入力してください"),
  reason: z.string().min(1, "調整理由を入力してください"),
});

export type AdjustGrossProfitInput = z.infer<typeof AdjustSchema>;

// ---------------------------------------------------------------------------
// GrossProfit result shape returned to the page
// ---------------------------------------------------------------------------

export interface GrossProfitResult {
  id: string;
  contractId: string;
  salesPrice: string;
  purchaseTotal: string;
  dealerTotal: string;
  constructionFee: string;
  otherCost: string;
  discount: string;
  projectProfit: string;
  wholesaleProfit: string;
  profitRate: string;
  incentiveTargetProfit: string;
  incentiveTargetType: string;
  manualAdjustedAt: string | null;
  manualAdjustmentReason: string | null;
}

// ---------------------------------------------------------------------------
// recalcGrossProfitAction
// ---------------------------------------------------------------------------

export const recalcGrossProfitAction = withServerActionContext<
  RecalcGrossProfitInput,
  GrossProfitResult
>(
  { action: "gross_profit.write" },
  async ({ tx, input }) => {
    const parsed = RecalcSchema.parse(input);

    await recalcGrossProfitInternal(tx, {
      contractId: parsed.contractId,
      salesPrice: parsed.salesPrice,
      constructionFee: parsed.constructionFee,
      otherCost: parsed.otherCost,
      discount: parsed.discount,
      incentiveTargetType: parsed.incentiveTargetType,
      manualValue: parsed.manualValue,
    });

    const gp = await tx.grossProfit.findUniqueOrThrow({
      where: { contractId: parsed.contractId },
      select: {
        id: true,
        contractId: true,
        salesPrice: true,
        purchaseTotal: true,
        dealerTotal: true,
        constructionFee: true,
        otherCost: true,
        discount: true,
        projectProfit: true,
        wholesaleProfit: true,
        profitRate: true,
        incentiveTargetProfit: true,
        incentiveTargetType: true,
        manualAdjustedAt: true,
        manualAdjustmentReason: true,
      },
    });

    revalidatePath(`/contracts/${parsed.contractId}/gross-profit`);
    revalidatePath(`/contracts/${parsed.contractId}`);

    return toGrossProfitResult(gp);
  },
);

// ---------------------------------------------------------------------------
// adjustGrossProfitAction
// ---------------------------------------------------------------------------

export const adjustGrossProfitAction = withServerActionContext<
  AdjustGrossProfitInput,
  GrossProfitResult
>(
  { action: "gross_profit.write" },
  async ({ tx, ctx, input }) => {
    const parsed = AdjustSchema.parse(input);

    // Load existing GrossProfit to carry forward the non-manual fields.
    const existing = await tx.grossProfit.findUnique({
      where: { contractId: parsed.contractId },
      select: {
        salesPrice: true,
        constructionFee: true,
        otherCost: true,
        discount: true,
      },
    });
    if (!existing) {
      throw new NotFoundError(
        "粗利情報が見つかりません。先に「再計算」を実行してください",
      );
    }

    // Fetch current ContractItems for the computation.
    const items = await tx.contractItem.findMany({
      where: { contractId: parsed.contractId },
      select: {
        qty: true,
        snapshotPurchasePrice: true,
        snapshotDealerPrice: true,
        snapshotListPrice: true,
      },
    });

    const manualValueNum = Number(parsed.manualValue);

    // Re-compute all fields with MANUAL target so derived numbers stay consistent.
    const computed = computeGrossProfit({
      items: items.map((i) => ({
        qty: Number(i.qty),
        snapshotPurchasePrice: Number(i.snapshotPurchasePrice),
        snapshotDealerPrice: Number(i.snapshotDealerPrice),
        snapshotListPrice: Number(i.snapshotListPrice),
      })),
      salesPrice: Number(existing.salesPrice),
      constructionFee: Number(existing.constructionFee),
      otherCost: Number(existing.otherCost),
      discount: Number(existing.discount),
      incentiveTargetType: "MANUAL",
      manualValue: manualValueNum,
    });

    const gp = await tx.grossProfit.update({
      where: { contractId: parsed.contractId },
      data: {
        purchaseTotal: computed.purchaseTotal.toFixed(2),
        dealerTotal: computed.dealerTotal.toFixed(2),
        projectProfit: computed.projectProfit.toFixed(2),
        wholesaleProfit: computed.wholesaleProfit.toFixed(2),
        profitRate: computed.profitRate.toFixed(4),
        incentiveTargetProfit: computed.incentiveTargetProfit.toFixed(2),
        incentiveTargetType: "MANUAL" as import("@solar/db").IncentiveTargetType,
        manualAdjustedBy: ctx.actorUserId,
        manualAdjustedAt: new Date(),
        manualAdjustmentReason: parsed.reason,
      },
      select: {
        id: true,
        contractId: true,
        salesPrice: true,
        purchaseTotal: true,
        dealerTotal: true,
        constructionFee: true,
        otherCost: true,
        discount: true,
        projectProfit: true,
        wholesaleProfit: true,
        profitRate: true,
        incentiveTargetProfit: true,
        incentiveTargetType: true,
        manualAdjustedAt: true,
        manualAdjustmentReason: true,
      },
    });

    await recordAudit(tx, {
      actorUserId: ctx.actorUserId,
      action: "MANUAL_ADJUST",
      targetType: "GrossProfit",
      targetId: parsed.contractId,
      tenantId: ctx.tenantId ?? ctx.wholesalerId ?? "",
      after: {
        incentiveTargetType: "MANUAL",
        manualValue: parsed.manualValue,
        reason: parsed.reason,
      },
    });

    revalidatePath(`/contracts/${parsed.contractId}/gross-profit`);
    revalidatePath(`/contracts/${parsed.contractId}`);

    return toGrossProfitResult(gp);
  },
);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function toGrossProfitResult(gp: {
  id: string;
  contractId: string;
  salesPrice: { toString(): string };
  purchaseTotal: { toString(): string };
  dealerTotal: { toString(): string };
  constructionFee: { toString(): string };
  otherCost: { toString(): string };
  discount: { toString(): string };
  projectProfit: { toString(): string };
  wholesaleProfit: { toString(): string };
  profitRate: { toString(): string };
  incentiveTargetProfit: { toString(): string };
  incentiveTargetType: string;
  manualAdjustedAt: Date | null;
  manualAdjustmentReason: string | null;
}): GrossProfitResult {
  return {
    id: gp.id,
    contractId: gp.contractId,
    salesPrice: gp.salesPrice.toString(),
    purchaseTotal: gp.purchaseTotal.toString(),
    dealerTotal: gp.dealerTotal.toString(),
    constructionFee: gp.constructionFee.toString(),
    otherCost: gp.otherCost.toString(),
    discount: gp.discount.toString(),
    projectProfit: gp.projectProfit.toString(),
    wholesaleProfit: gp.wholesaleProfit.toString(),
    profitRate: gp.profitRate.toString(),
    incentiveTargetProfit: gp.incentiveTargetProfit.toString(),
    incentiveTargetType: gp.incentiveTargetType,
    manualAdjustedAt: gp.manualAdjustedAt?.toISOString() ?? null,
    manualAdjustmentReason: gp.manualAdjustmentReason,
  };
}
