// S-045 — 粗利計算・手動調整 (T-05-08 / F-042 / docs/04 §1.3).
//
// RSC data loader:
//   • Contract header (id / contractDate / status)
//   • GrossProfit record (may be null if not yet computed — the initial stub
//     is created in createContractAction with all zeros)
//   • ContractItems count (to surface the "no items" warning)
//
// Client interactions (GrossProfitForm):
//   • 再計算: salesPrice + costs + incentiveTargetType → recalcGrossProfitAction
//   • 手動調整: manualValue + reason → adjustGrossProfitAction

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

import { GrossProfitForm } from "./GrossProfitForm";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

interface ContractHeader {
  id: string;
  contractDate: string;
  status: string;
  contractAmount: string;
}

interface GrossProfitData {
  id: string;
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

async function loadPageData(contractId: string): Promise<{
  contract: ContractHeader;
  grossProfit: GrossProfitData | null;
  itemCount: number;
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
    action: "gross_profit.read",
  });

  return withTenant(ctx, async (tx) => {
    const contract = await tx.contract.findUnique({
      where: { id: contractId },
      select: {
        id: true,
        contractDate: true,
        status: true,
        contractAmount: true,
      },
    });
    if (!contract) return null;

    const itemCount = await tx.contractItem.count({
      where: { contractId },
    });

    const gp = await tx.grossProfit.findUnique({
      where: { contractId },
      select: {
        id: true,
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

    return {
      contract: {
        id: contract.id,
        contractDate: contract.contractDate.toISOString(),
        status: contract.status,
        contractAmount: contract.contractAmount.toString(),
      },
      grossProfit: gp
        ? {
            id: gp.id,
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
          }
        : null,
      itemCount,
    };
  });
}

export default async function GrossProfitPage({ params }: PageProps) {
  const { id } = await params;
  const data = await loadPageData(id);
  if (!data) notFound();

  const t = labels.grossProfit;
  const c = labels.common;
  const bc = labels.breadcrumb.items;

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: bc.contracts, href: "/contracts" },
          { label: bc.contractDetail, href: `/contracts/${id}` },
          { label: bc.contractGrossProfit },
        ]}
      />
      <div className="flex items-center gap-4">
        <Button asChild variant="outline" size="sm">
          <Link href={`/contracts/${id}`}>{t.backToContract}</Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      </div>

      {/* Contract header */}
      <div className="border-border rounded-md border p-4 space-y-2">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{labels.contract.fields.contractDate}</dt>
          <dd>{new Date(data.contract.contractDate).toLocaleDateString("ja-JP")}</dd>
          <dt className="text-muted-foreground">{labels.contract.fields.totalAmount}</dt>
          <dd>
            {Number(data.contract.contractAmount).toLocaleString("ja-JP")} {c.currencySuffix}
          </dd>
          <dt className="text-muted-foreground">{labels.contract.fields.status}</dt>
          <dd>{data.contract.status}</dd>
        </dl>
      </div>

      {data.itemCount === 0 && (
        <p className="text-sm text-muted-foreground border rounded-md p-3 border-amber-300 bg-amber-50">
          {t.noItems}
        </p>
      )}

      <GrossProfitForm
        contractId={id}
        grossProfit={data.grossProfit}
        hasItems={data.itemCount > 0}
        contractAmount={data.contract.contractAmount}
      />
    </div>
  );
}
