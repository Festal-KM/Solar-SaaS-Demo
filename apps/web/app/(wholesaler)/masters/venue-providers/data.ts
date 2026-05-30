// Server-side data loaders for the venue-provider master pages (S-019/S-020).
//
// These are NOT Server Actions; they run during RSC render and use the same
// three-step idiom (getTenantContext → assertCan → withTenant) so RLS is
// honoured and dealer roles get a hard 403 before any DB call fires.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

export interface VenueProviderListItem {
  id: string;
  name: string;
  contactName: string | null;
  area: string | null;
  contractType: "FIXED" | "PERFORMANCE" | "OTHER" | null;
  fixedFee: string | null;
  performanceRate: string | null;
  isActive: boolean;
  updatedAt: string;
}

export interface VenueProviderDetail extends VenueProviderListItem {
  phone: string | null;
  email: string | null;
  postalCode: string | null;
  address: string | null;
  note: string | null;
  createdAt: string;
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
    action: "venue_provider.read",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });
  return ctx;
}

export interface ListFilter {
  name?: string;
  area?: string;
}

export async function listVenueProviders(
  filter: ListFilter = {},
): Promise<VenueProviderListItem[]> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const rows = await tx.venueProvider.findMany({
      where: {
        ...(filter.name && filter.name.length > 0
          ? { name: { contains: filter.name, mode: "insensitive" } }
          : {}),
        ...(filter.area && filter.area.length > 0
          ? { area: { contains: filter.area, mode: "insensitive" } }
          : {}),
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        contactName: true,
        area: true,
        contractType: true,
        fixedFee: true,
        performanceRate: true,
        isActive: true,
        updatedAt: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      contactName: r.contactName,
      area: r.area,
      contractType: r.contractType,
      fixedFee: r.fixedFee?.toString() ?? null,
      performanceRate: r.performanceRate?.toString() ?? null,
      isActive: r.isActive,
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export async function getVenueProvider(id: string): Promise<VenueProviderDetail | null> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const r = await tx.venueProvider.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        contactName: true,
        phone: true,
        email: true,
        postalCode: true,
        address: true,
        area: true,
        contractType: true,
        fixedFee: true,
        performanceRate: true,
        note: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      contactName: r.contactName,
      phone: r.phone,
      email: r.email,
      postalCode: r.postalCode,
      address: r.address,
      area: r.area,
      contractType: r.contractType,
      fixedFee: r.fixedFee?.toString() ?? null,
      performanceRate: r.performanceRate?.toString() ?? null,
      note: r.note,
      isActive: r.isActive,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}
