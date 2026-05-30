"use server";

// Product-master Server Actions (T-02-03 / F-012 / docs/05 §3.3 §4.4).
//
// Four actions, each going through the canonical three-step idiom
// (auth → assertCan → withTenant). The wholesalerId is injected from the
// tenant context — callers never pass it as input.
//
// Soft delete (retire): `retireProductAction` flips `isActive=false` AND
// sets `effectiveTo = today`. The row stays in the table forever so contract
// snapshots taken before the retirement keep resolving.
//
// Price revision (revise): MUST be append-only. The previous version's
// `effectiveTo` is closed at `new effectiveFrom`, a fresh Product row is
// inserted carrying the new prices, and the diff is written to
// `ProductPriceHistory` — all in one transaction. Updates that touch
// `purchasePrice / dealerPrice / listPrice` go through this path, never
// through `updateProductAction`.

import {
  ProductInputSchema,
  ProductReviseRatesSchema,
  ProductUpdateSchema,
  type ProductInput,
  type ProductReviseRates,
  type ProductUpdate,
} from "@solar/contracts";
import { revalidatePath } from "next/cache";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";
import { recordAudit } from "@/lib/audit/audit-service";

const LIST_PATH = "/masters/products";

export interface CreateProductResult {
  id: string;
}

export const createProductAction = withServerActionContext<ProductInput, CreateProductResult>(
  {
    action: "product.create",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("wholesalerId is required for product master");
    }
    const parsed = ProductInputSchema.parse(input);

    const created = await tx.product.create({
      data: {
        wholesalerId: ctx.wholesalerId,
        category: parsed.category,
        maker: parsed.maker,
        name: parsed.name,
        modelNo: parsed.modelNo ?? null,
        capacity: parsed.capacity ?? null,
        unit: parsed.unit,
        purchasePrice: parsed.purchasePrice,
        dealerPrice: parsed.dealerPrice,
        listPrice: parsed.listPrice,
        effectiveFrom: parsed.effectiveFrom,
        effectiveTo: parsed.effectiveTo ?? null,
        note: parsed.note ?? null,
        createdBy: ctx.actorUserId,
      },
      select: { id: true },
    });

    await recordAudit(tx, {
      actorUserId: ctx.actorUserId,
      action: "CREATE",
      targetType: "Product",
      targetId: created.id,
      tenantId: ctx.tenantId ?? ctx.wholesalerId ?? "",
      after: {
        category: parsed.category,
        name: parsed.name,
        maker: parsed.maker,
        effectiveFrom: parsed.effectiveFrom,
      },
    });

    revalidatePath(LIST_PATH);
    return { id: created.id };
  },
);

export interface UpdateProductInput {
  id: string;
  patch: ProductUpdate;
}

export interface UpdateProductResult {
  id: string;
}

export const updateProductAction = withServerActionContext<UpdateProductInput, UpdateProductResult>(
  {
    action: "product.update",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    const parsed = ProductUpdateSchema.parse(input.patch);

    // RLS via withTenant() hides cross-tenant rows; a `null` result here is
    // indistinguishable from a not-yet-created id, both surface as 404
    // (docs/05 §9.1).
    const existing = await tx.product.findUnique({
      where: { id: input.id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundError("商品が見つかりません");
    }

    const updated = await tx.product.update({
      where: { id: input.id },
      data: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.maker !== undefined ? { maker: parsed.maker } : {}),
        ...("modelNo" in parsed ? { modelNo: parsed.modelNo ?? null } : {}),
        ...("note" in parsed ? { note: parsed.note ?? null } : {}),
        ...(parsed.isActive !== undefined ? { isActive: parsed.isActive } : {}),
      },
      select: { id: true },
    });

    await recordAudit(tx, {
      actorUserId: ctx.actorUserId ?? null,
      action: "UPDATE",
      targetType: "Product",
      targetId: updated.id,
      tenantId: ctx.tenantId ?? ctx.wholesalerId ?? "",
      after: parsed as Record<string, unknown>,
    });

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${input.id}`);
    return { id: updated.id };
  },
);

export interface ReviseProductRatesInput {
  id: string;
  patch: ProductReviseRates;
}

export interface ReviseProductRatesResult {
  // The new (successor) product row id. The original `id` is closed but kept.
  newId: string;
  previousId: string;
}

export const reviseProductRatesAction = withServerActionContext<
  ReviseProductRatesInput,
  ReviseProductRatesResult
>(
  {
    action: "product.revise",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("wholesalerId is required for product master");
    }
    const parsed = ProductReviseRatesSchema.parse(input.patch);

    // Fetch the row that's being revised. `withTenant` enforces RLS so any
    // cross-tenant id is invisible here and surfaces as NotFound.
    const existing = await tx.product.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        wholesalerId: true,
        category: true,
        maker: true,
        name: true,
        modelNo: true,
        capacity: true,
        unit: true,
        purchasePrice: true,
        dealerPrice: true,
        listPrice: true,
        effectiveFrom: true,
        effectiveTo: true,
        note: true,
      },
    });
    if (!existing) {
      throw new NotFoundError("商品が見つかりません");
    }

    // The new period must start AFTER the previous period began — otherwise
    // we'd be retro-rewriting history. The DB CHECK constraint enforces
    // `effectiveFrom < effectiveTo` for any single row; here we add the
    // chronological invariant across consecutive rows.
    if (parsed.effectiveFrom.getTime() <= existing.effectiveFrom.getTime()) {
      throw new ValidationError("価格改定の適用開始日は既存の適用開始日より後にしてください");
    }

    // Close the previous period at the new revision's start. `effectiveTo`
    // is exclusive in `findEffectiveProducts` semantics so setting it equal
    // to `parsed.effectiveFrom` is exactly the back-to-back chain we want.
    await tx.product.update({
      where: { id: existing.id },
      data: { effectiveTo: parsed.effectiveFrom },
    });

    const successor = await tx.product.create({
      data: {
        wholesalerId: ctx.wholesalerId,
        category: existing.category,
        maker: existing.maker,
        name: existing.name,
        modelNo: existing.modelNo,
        capacity: existing.capacity,
        unit: existing.unit,
        purchasePrice: parsed.purchasePrice,
        dealerPrice: parsed.dealerPrice,
        listPrice: parsed.listPrice,
        effectiveFrom: parsed.effectiveFrom,
        effectiveTo: parsed.effectiveTo ?? null,
        note: existing.note,
        createdBy: ctx.actorUserId,
      },
      select: { id: true },
    });

    await tx.productPriceHistory.create({
      data: {
        productId: existing.id,
        before: {
          purchasePrice: existing.purchasePrice.toString(),
          dealerPrice: existing.dealerPrice.toString(),
          listPrice: existing.listPrice.toString(),
          effectiveFrom: existing.effectiveFrom.toISOString(),
          effectiveTo: existing.effectiveTo?.toISOString() ?? null,
        },
        after: {
          successorProductId: successor.id,
          purchasePrice: parsed.purchasePrice,
          dealerPrice: parsed.dealerPrice,
          listPrice: parsed.listPrice,
          effectiveFrom: parsed.effectiveFrom.toISOString(),
          effectiveTo: parsed.effectiveTo?.toISOString() ?? null,
          reason: parsed.reason ?? null,
        },
        changedBy: ctx.actorUserId,
      },
    });

    await recordAudit(tx, {
      actorUserId: ctx.actorUserId ?? null,
      action: "UPDATE",
      targetType: "Product",
      targetId: existing.id,
      tenantId: ctx.tenantId ?? ctx.wholesalerId ?? "",
      before: {
        purchasePrice: existing.purchasePrice.toString(),
        dealerPrice: existing.dealerPrice.toString(),
        listPrice: existing.listPrice.toString(),
      },
      after: {
        successorProductId: successor.id,
        purchasePrice: String(parsed.purchasePrice),
        dealerPrice: String(parsed.dealerPrice),
        listPrice: String(parsed.listPrice),
        effectiveFrom: parsed.effectiveFrom.toISOString(),
        reason: parsed.reason ?? null,
      },
    });

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${existing.id}`);
    revalidatePath(`${LIST_PATH}/${successor.id}`);
    return { newId: successor.id, previousId: existing.id };
  },
);

export interface RetireProductInput {
  id: string;
}

export interface RetireProductResult {
  id: string;
}

export const retireProductAction = withServerActionContext<RetireProductInput, RetireProductResult>(
  {
    action: "product.retire",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    const existing = await tx.product.findUnique({
      where: { id: input.id },
      select: { id: true, effectiveFrom: true },
    });
    if (!existing) {
      throw new NotFoundError("商品が見つかりません");
    }

    // Use start-of-today as the cut-off; rows in the past stay valid up to
    // that boundary. If the row's effectiveFrom is still in the future
    // (rare — pre-announced product), close it at effectiveFrom so the
    // DB CHECK constraint `effectiveFrom < effectiveTo` is not violated.
    const now = new Date();
    const cutoff =
      existing.effectiveFrom.getTime() >= now.getTime()
        ? new Date(existing.effectiveFrom.getTime() + 1)
        : now;

    const updated = await tx.product.update({
      where: { id: input.id },
      data: { isActive: false, effectiveTo: cutoff },
      select: { id: true },
    });

    await recordAudit(tx, {
      actorUserId: ctx.actorUserId ?? null,
      action: "DELETE",
      targetType: "Product",
      targetId: updated.id,
      tenantId: ctx.tenantId ?? ctx.wholesalerId ?? "",
      after: { isActive: false },
    });

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${input.id}`);
    return { id: updated.id };
  },
);
