// Server-side data loaders for the incentive-rate master pages (S-052 sub /
// F-014). 三段ガード (auth → assertCan(incentive_rate.read) → withTenant) で
// 包む。dealer ロールは assertCan を通過し、RLS で自社関係分のみが返る
// （migrations/.../masters/migration.sql の IncentiveRate_isolation policy）。

import "server-only";

import { findEffectiveIncentiveRate, type IncentiveTargetType } from "@solar/contracts";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

export interface IncentiveRateListItem {
  id: string;
  relationshipId: string;
  dealerName: string;
  targetType: IncentiveTargetType;
  rate: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
  updatedAt: string;
  isCurrent: boolean;
}

export interface IncentiveRateGroup {
  relationshipId: string;
  dealerName: string;
  current: IncentiveRateListItem | null;
  rates: IncentiveRateListItem[];
}

export interface IncentiveRateDetail {
  id: string;
  relationshipId: string;
  dealerName: string;
  targetType: IncentiveTargetType;
  rate: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface RelationshipOption {
  id: string;
  dealerName: string;
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
    action: "incentive_rate.read",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });
  return ctx;
}

export interface ListFilter {
  relationshipId?: string;
}

export async function listIncentiveRates(filter: ListFilter = {}): Promise<IncentiveRateGroup[]> {
  const ctx = await requireReadCtx();
  const now = new Date();
  return withTenant(ctx, async (tx) => {
    const rows = await tx.incentiveRate.findMany({
      where: {
        ...(filter.relationshipId ? { relationshipId: filter.relationshipId } : {}),
      },
      orderBy: [{ relationshipId: "asc" }, { effectiveFrom: "desc" }],
      select: {
        id: true,
        relationshipId: true,
        targetType: true,
        rate: true,
        effectiveFrom: true,
        effectiveTo: true,
        note: true,
        updatedAt: true,
        relationship: {
          select: {
            dealer: { select: { id: true, name: true } },
          },
        },
      },
    });

    // Group rows by relationship to render the per-dealer card list.
    const groups = new Map<string, IncentiveRateGroup>();
    for (const r of rows) {
      const dealerName = r.relationship.dealer.name;
      const item: IncentiveRateListItem = {
        id: r.id,
        relationshipId: r.relationshipId,
        dealerName,
        targetType: r.targetType as IncentiveTargetType,
        rate: r.rate.toString(),
        effectiveFrom: r.effectiveFrom.toISOString(),
        effectiveTo: r.effectiveTo?.toISOString() ?? null,
        note: r.note,
        updatedAt: r.updatedAt.toISOString(),
        isCurrent: false,
      };
      const existing = groups.get(r.relationshipId);
      if (existing) {
        existing.rates.push(item);
      } else {
        groups.set(r.relationshipId, {
          relationshipId: r.relationshipId,
          dealerName,
          current: null,
          rates: [item],
        });
      }
    }

    // Mark the currently effective row per group via the pure helper.
    for (const g of groups.values()) {
      const effective = findEffectiveIncentiveRate(
        g.rates.map((r) => ({
          ...r,
          effectiveFrom: new Date(r.effectiveFrom),
          effectiveTo: r.effectiveTo ? new Date(r.effectiveTo) : null,
        })),
        now,
      );
      if (effective) {
        const target = g.rates.find((r) => r.id === effective.id);
        if (target) {
          target.isCurrent = true;
          g.current = target;
        }
      }
    }

    return Array.from(groups.values()).sort((a, b) =>
      a.dealerName.localeCompare(b.dealerName, "ja"),
    );
  });
}

export async function getIncentiveRate(id: string): Promise<IncentiveRateDetail | null> {
  const ctx = await requireReadCtx();
  return withTenant(ctx, async (tx) => {
    const r = await tx.incentiveRate.findUnique({
      where: { id },
      select: {
        id: true,
        relationshipId: true,
        targetType: true,
        rate: true,
        effectiveFrom: true,
        effectiveTo: true,
        note: true,
        createdAt: true,
        updatedAt: true,
        createdBy: true,
        relationship: {
          select: {
            dealer: { select: { name: true } },
          },
        },
      },
    });
    if (!r) return null;
    return {
      id: r.id,
      relationshipId: r.relationshipId,
      dealerName: r.relationship.dealer.name,
      targetType: r.targetType as IncentiveTargetType,
      rate: r.rate.toString(),
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveTo: r.effectiveTo?.toISOString() ?? null,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      createdBy: r.createdBy,
    };
  });
}

// Lookup list for the create form's relationship picker. Only ACTIVE
// relationships belonging to the current wholesaler. RLS via withTenant()
// ensures cross-tenant relationships are invisible.
export async function listAvailableRelationships(): Promise<RelationshipOption[]> {
  const ctx = await requireReadCtx();
  return withTenant(ctx, async (tx) => {
    const rows = await tx.relationship.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        dealer: { select: { name: true } },
      },
    });
    return rows.map((r) => ({ id: r.id, dealerName: r.dealer.name }));
  });
}
