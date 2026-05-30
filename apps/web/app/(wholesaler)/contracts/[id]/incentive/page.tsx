// S-050 タブ — 共同開催インセンティブ手動調整 (T-06-03 / F-047 / docs/04 §1.3).
//
// RSC data loader:
//   • Contract (id / eventModeAtContract)
//   • Incentive[] for the contract with relationship name
//   • IncentiveAdjustment[] history per incentive
//
// Client interactions (JointIncentiveAdjustForm):
//   • 各 DRAFT インセンティブに amount + reason を入力し adjustJointIncentiveAction 呼び出し
//   • FINALIZED は読み取り専用表示

import "server-only";

import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { labels } from "@/lib/i18n/labels";

import { JointIncentiveAdjustForm } from "./JointIncentiveAdjustForm";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export interface IncentiveRow {
  id: string;
  relationshipId: string;
  dealerName: string;
  amount: string;
  status: string;
  settledMonth: string;
  finalizedAt: string | null;
  adjustments: AdjustmentRow[];
}

export interface AdjustmentRow {
  id: string;
  kind: string;
  beforeAmount: string;
  afterAmount: string;
  reason: string;
  adjustedAt: string;
}

async function loadPageData(contractId: string): Promise<{
  contractId: string;
  eventModeAtContract: string | null;
  incentives: IncentiveRow[];
} | null> {
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
    action: "incentive.read",
  });

  return withTenant(ctx, async (tx) => {
    const contract = await tx.contract.findUnique({
      where: { id: contractId },
      select: { id: true, eventModeAtContract: true },
    });
    if (!contract) return null;

    const rows = await tx.incentive.findMany({
      where: { contractId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        relationshipId: true,
        amount: true,
        status: true,
        settledMonth: true,
        finalizedAt: true,
        relationship: {
          select: { dealer: { select: { name: true } } },
        },
        adjustments: {
          orderBy: { adjustedAt: "desc" },
          select: {
            id: true,
            kind: true,
            beforeAmount: true,
            afterAmount: true,
            reason: true,
            adjustedAt: true,
          },
        },
      },
    });

    const incentives: IncentiveRow[] = rows.map((r) => ({
      id: r.id,
      relationshipId: r.relationshipId,
      dealerName: r.relationship.dealer.name,
      amount: r.amount.toString(),
      status: r.status,
      settledMonth: r.settledMonth,
      finalizedAt: r.finalizedAt?.toISOString() ?? null,
      adjustments: r.adjustments.map((a) => ({
        id: a.id,
        kind: a.kind,
        beforeAmount: a.beforeAmount.toString(),
        afterAmount: a.afterAmount.toString(),
        reason: a.reason,
        adjustedAt: a.adjustedAt.toISOString(),
      })),
    }));

    return {
      contractId: contract.id,
      eventModeAtContract: contract.eventModeAtContract,
      incentives,
    };
  });
}

export default async function IncentiveAdjustPage({ params }: PageProps) {
  const { id } = await params;
  const data = await loadPageData(id);
  if (!data) notFound();

  const t = labels.incentiveAdjust;
  const bc = labels.breadcrumb.items;

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: bc.contracts, href: "/contracts" },
          { label: bc.contractDetail, href: `/contracts/${id}` },
          { label: bc.contractIncentive },
        ]}
      />
      <div className="flex items-center gap-4">
        <Button asChild variant="outline" size="sm">
          <Link href={`/contracts/${id}`}>{t.backToContract}</Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      </div>

      <p className="text-sm text-muted-foreground">{t.subtitle}</p>

      {data.eventModeAtContract !== "JOINT" ? (
        <div className="border-border rounded-md border p-4">
          <p className="text-sm text-muted-foreground">{t.notJointMode}</p>
        </div>
      ) : data.incentives.length === 0 ? (
        <div className="border-border rounded-md border p-4">
          <p className="text-sm text-muted-foreground">{t.noIncentives}</p>
        </div>
      ) : (
        <JointIncentiveAdjustForm
          contractId={id}
          incentives={data.incentives}
        />
      )}
    </div>
  );
}
