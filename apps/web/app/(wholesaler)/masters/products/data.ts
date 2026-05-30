// Server-side data loaders for the product master pages (S-042/S-043).
//
// These run during RSC render and follow the same three-step idiom as the
// Server Actions (getTenantContext → assertCan → withTenant) so RLS guards
// every query. The list page accepts category / maker filters; the detail
// page resolves the full price history through `getProductHistory`.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import type { ProductCategory } from "@solar/contracts";

export interface ProductListItem {
  id: string;
  category: ProductCategory;
  maker: string;
  name: string;
  modelNo: string | null;
  unit: string;
  // purchasePrice intentionally omitted from the list response so the public
  // S-042 view never leaks the wholesaler's cost. The detail page exposes it
  // (it's gated by `product.read` + wholesaler role).
  dealerPrice: string;
  listPrice: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  updatedAt: string;
}

export interface ProductDetail extends ProductListItem {
  purchasePrice: string;
  capacity: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string;
}

export interface ProductHistoryEntry {
  id: string;
  before: unknown;
  after: unknown;
  changedBy: string;
  changedAt: string;
}

async function requireReadCtx() {
  const session = await auth();
  if (!session?.user) {
    throw new UnauthorizedError({
      code: "INVALID_CREDENTIALS",
      message: "Session missing — sign in is required",
    });
  }
  const ctx = await getTenantContext();
  assertCan({
    user: {
      userId: ctx.actorUserId,
      roles: session.user.roles,
      isSaasAdmin: ctx.isSaasAdmin,
      tenantId: ctx.tenantId,
      wholesalerId: ctx.wholesalerId,
      dealerId: ctx.dealerId,
      relationshipIds: ctx.relationshipIds,
    },
    action: "product.read",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });
  return ctx;
}

export interface ListFilter {
  category?: ProductCategory;
  maker?: string;
  includeRetired?: boolean;
}

export async function listProducts(filter: ListFilter = {}): Promise<ProductListItem[]> {
  const ctx = await requireReadCtx();
  return withTenant(ctx, async (tx) => {
    const rows = await tx.product.findMany({
      where: {
        ...(filter.category ? { category: filter.category } : {}),
        ...(filter.maker && filter.maker.length > 0
          ? { maker: { contains: filter.maker, mode: "insensitive" } }
          : {}),
        ...(filter.includeRetired ? {} : { isActive: true }),
      },
      orderBy: [{ isActive: "desc" }, { category: "asc" }, { maker: "asc" }, { name: "asc" }],
      select: {
        id: true,
        category: true,
        maker: true,
        name: true,
        modelNo: true,
        unit: true,
        dealerPrice: true,
        listPrice: true,
        effectiveFrom: true,
        effectiveTo: true,
        isActive: true,
        updatedAt: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      category: r.category as ProductCategory,
      maker: r.maker,
      name: r.name,
      modelNo: r.modelNo,
      unit: r.unit,
      dealerPrice: r.dealerPrice.toString(),
      listPrice: r.listPrice.toString(),
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveTo: r.effectiveTo?.toISOString() ?? null,
      isActive: r.isActive,
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export async function getProduct(id: string): Promise<ProductDetail | null> {
  const ctx = await requireReadCtx();
  return withTenant(ctx, async (tx) => {
    const r = await tx.product.findUnique({
      where: { id },
      select: {
        id: true,
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
        isActive: true,
        note: true,
        createdAt: true,
        updatedAt: true,
        createdBy: true,
      },
    });
    if (!r) return null;
    return {
      id: r.id,
      category: r.category as ProductCategory,
      maker: r.maker,
      name: r.name,
      modelNo: r.modelNo,
      capacity: r.capacity?.toString() ?? null,
      unit: r.unit,
      purchasePrice: r.purchasePrice.toString(),
      dealerPrice: r.dealerPrice.toString(),
      listPrice: r.listPrice.toString(),
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveTo: r.effectiveTo?.toISOString() ?? null,
      isActive: r.isActive,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      createdBy: r.createdBy,
    };
  });
}

export async function getProductHistory(productId: string): Promise<ProductHistoryEntry[]> {
  const ctx = await requireReadCtx();
  return withTenant(ctx, async (tx) => {
    const rows = await tx.productPriceHistory.findMany({
      where: { productId },
      orderBy: { changedAt: "desc" },
      select: {
        id: true,
        before: true,
        after: true,
        changedBy: true,
        changedAt: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      before: r.before,
      after: r.after,
      changedBy: r.changedBy,
      changedAt: r.changedAt.toISOString(),
    }));
  });
}
