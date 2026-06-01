// Server-side data loaders for the store master pages (店舗マスタ).
//
// RSC ローダー: Server Action と同じ三段ガード (auth → assertCan(store.read)
// → withTenant) を踏み、許可外ロールは assertCan で 403 落ち、他テナント行は
// RLS により findUnique で null になる。area の data.ts と同じ構造。

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

export interface StoreListItem {
  id: string;
  name: string;
  isActive: boolean;
  venueProviderId: string | null;
  venueProviderName: string | null;
  updatedAt: string;
}

export interface StoreDetail extends StoreListItem {
  createdAt: string;
}

export interface VenueProviderOption {
  id: string;
  name: string;
}

async function requireWholesalerCtx() {
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
    action: "store.read",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });
  return ctx;
}

export interface ListFilter {
  name?: string;
  isActive?: boolean;
}

export async function listStores(filter: ListFilter = {}): Promise<StoreListItem[]> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const rows = await tx.store.findMany({
      where: {
        ...(filter.name && filter.name.length > 0
          ? { name: { contains: filter.name, mode: "insensitive" } }
          : {}),
        ...(filter.isActive !== undefined ? { isActive: filter.isActive } : {}),
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        isActive: true,
        venueProviderId: true,
        updatedAt: true,
        venueProvider: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      isActive: r.isActive,
      venueProviderId: r.venueProviderId,
      venueProviderName: r.venueProvider?.name ?? null,
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export async function getStore(id: string): Promise<StoreDetail | null> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const r = await tx.store.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        isActive: true,
        venueProviderId: true,
        createdAt: true,
        updatedAt: true,
        venueProvider: { select: { name: true } },
      },
    });
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      isActive: r.isActive,
      venueProviderId: r.venueProviderId,
      venueProviderName: r.venueProvider?.name ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

export async function listVenueProviderOptions(): Promise<VenueProviderOption[]> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const rows = await tx.venueProvider.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return rows.map((r) => ({ id: r.id, name: r.name }));
  });
}
