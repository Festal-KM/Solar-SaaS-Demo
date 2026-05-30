// Server-side data loader for S-070 二次店 インセンティブ確認 (T-06-10 / F-051 / docs/04 §1.5).
//
// listDealerIncentives — fetches Incentive rows whose relationshipId is in
//   ctx.relationshipIds. Only FINALIZED incentives are returned (docs/02 §F-051).
//
// Fields intentionally excluded from the DTO (CLAUDE.md rule #5):
//   - No purchasePrice / snapshotPurchasePrice from contract items.
//   - targetProfit is the "インセンティブ対象粗利" (allowed per docs/02 §F-051:
//     「インセンティブ対象粗利・インセンティブ率・インセンティブ額のみ」).
//   - wholesaleProfit and projectProfit (from GrossProfit) are NOT included.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

export interface DealerIncentiveFilter {
  targetMonth?: string;
}

export interface DealerIncentiveItem {
  id: string;
  contractId: string;
  relationshipId: string;
  // Contract fields visible to dealer (docs/02 §F-051 / Assumption 11)
  contractDate: string;
  settledMonth: string;
  // Incentive economics — purchasePrice is NOT exposed (CLAUDE.md rule #5)
  targetProfit: string;
  rate: string;
  amount: string;
  status: string;
  finalizedAt: string | null;
}

export interface DealerIncentiveListResult {
  items: DealerIncentiveItem[];
}

export async function listDealerIncentives(
  filter: DealerIncentiveFilter = {},
): Promise<DealerIncentiveListResult> {
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
    action: "dealer_incentive.read",
  });

  const relationshipIds = ctx.relationshipIds ?? [];
  if (relationshipIds.length === 0) {
    return { items: [] };
  }

  return withTenant(ctx, async (tx) => {
    const rows = await tx.incentive.findMany({
      where: {
        relationshipId: { in: relationshipIds },
        status: "FINALIZED",
        ...(filter.targetMonth ? { settledMonth: filter.targetMonth } : {}),
      },
      orderBy: [{ settledMonth: "desc" }, { finalizedAt: "desc" }],
      select: {
        id: true,
        contractId: true,
        relationshipId: true,
        targetProfit: true,
        rate: true,
        amount: true,
        status: true,
        settledMonth: true,
        finalizedAt: true,
        contract: {
          select: {
            contractDate: true,
            // snapshotPurchasePrice, items, grossProfit intentionally excluded
          },
        },
      },
    });

    const items: DealerIncentiveItem[] = rows.map((r) => ({
      id: r.id,
      contractId: r.contractId,
      relationshipId: r.relationshipId,
      contractDate: r.contract.contractDate.toISOString(),
      settledMonth: r.settledMonth,
      targetProfit: r.targetProfit.toString(),
      rate: r.rate.toString(),
      amount: r.amount.toString(),
      status: r.status,
      finalizedAt: r.finalizedAt?.toISOString() ?? null,
    }));

    return { items };
  });
}
