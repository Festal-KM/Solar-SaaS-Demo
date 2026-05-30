// S-044 — 契約明細登録（価格スナップショット）(T-05-07 / F-041 / docs/04 §1.3).
//
// RSC data loader:
//   • Contract header (id / contractDate / status)
//   • Active products as of contractDate for the picker
//   • Existing ContractItems for the current contract
//
// Client interactions:
//   • Add row: select product + enter qty → call replaceContractItemsAction
//   • Table shows all columns for wholesaler role; snapshotPurchasePrice is
//     excluded from the dealer DTO (physical exclusion at DTO boundary).
//   • Contract must be in CONTRACTED status to allow edits.

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
import { toContractItemWholesalerDto } from "@solar/contracts";
import type { ContractItemForWholesalerDto } from "@solar/contracts";

import { ContractItemsForm } from "./ContractItemsForm";

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

interface ProductOption {
  id: string;
  name: string;
  maker: string;
  modelNo: string | null;
  unit: string;
  dealerPrice: string;
  listPrice: string;
}

async function loadPageData(contractId: string): Promise<{
  contract: ContractHeader;
  products: ProductOption[];
  items: ContractItemForWholesalerDto[];
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
    action: "contract.update",
  });

  return withTenant(ctx, async (tx) => {
    const contract = await tx.contract.findUnique({
      where: { id: contractId },
      select: {
        id: true,
        contractDate: true,
        status: true,
        contractAmount: true,
        wholesalerId: true,
      },
    });
    if (!contract) return null;

    const contractDate = contract.contractDate;

    // Fetch products effective at contractDate for this wholesaler.
    const rawProducts = await tx.product.findMany({
      where: {
        wholesalerId: contract.wholesalerId,
        isActive: true,
        effectiveFrom: { lte: contractDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: contractDate } }],
      },
      orderBy: [{ maker: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        maker: true,
        modelNo: true,
        unit: true,
        dealerPrice: true,
        listPrice: true,
      },
    });

    // Fetch existing contract items.
    const rawItems = await tx.contractItem.findMany({
      where: { contractId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        contractId: true,
        productId: true,
        productName: true,
        maker: true,
        modelNo: true,
        qty: true,
        unit: true,
        snapshotPurchasePrice: true,
        snapshotDealerPrice: true,
        snapshotListPrice: true,
        createdAt: true,
      },
    });

    const items: ContractItemForWholesalerDto[] = rawItems.map((r) => {
      const qty = Number(r.qty);
      const listPrice = Number(r.snapshotListPrice.toString());
      const subtotal = (qty * listPrice).toFixed(2);
      return toContractItemWholesalerDto({
        id: r.id,
        contractId: r.contractId,
        productId: r.productId,
        productName: r.productName,
        maker: r.maker,
        modelNo: r.modelNo,
        qty: r.qty.toString(),
        unit: r.unit,
        snapshotPurchasePrice: r.snapshotPurchasePrice.toString(),
        snapshotDealerPrice: r.snapshotDealerPrice.toString(),
        snapshotListPrice: r.snapshotListPrice.toString(),
        subtotal,
        createdAt: r.createdAt.toISOString(),
      });
    });

    return {
      contract: {
        id: contract.id,
        contractDate: contract.contractDate.toISOString(),
        status: contract.status,
        contractAmount: contract.contractAmount.toString(),
      },
      products: rawProducts.map((p) => ({
        id: p.id,
        name: p.name,
        maker: p.maker,
        modelNo: p.modelNo,
        unit: p.unit,
        dealerPrice: p.dealerPrice.toString(),
        listPrice: p.listPrice.toString(),
      })),
      items,
    };
  });
}

export default async function ContractItemsPage({ params }: PageProps) {
  const { id } = await params;
  const data = await loadPageData(id);
  if (!data) notFound();

  const t = labels.contractItem;
  const c = labels.common;
  const bc = labels.breadcrumb.items;
  const isEditable = data.contract.status === "CONTRACTED";

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: bc.contracts, href: "/contracts" },
          { label: bc.contractDetail, href: `/contracts/${id}` },
          { label: bc.contractItems },
        ]}
      />
      <div className="flex items-center gap-4">
        <Button asChild variant="outline" size="sm">
          <Link href={`/contracts/${id}`}>{c.back}</Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      </div>

      {/* Contract header */}
      <div className="border-border rounded-md border p-4 space-y-2">
        <h2 className="font-medium text-sm text-muted-foreground">{t.contractInfo}</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t.fields.contractDate}</dt>
          <dd>{new Date(data.contract.contractDate).toLocaleDateString("ja-JP")}</dd>
          <dt className="text-muted-foreground">{t.fields.status}</dt>
          <dd>{data.contract.status}</dd>
          <dt className="text-muted-foreground">{t.fields.totalAmount}</dt>
          <dd>
            {Number(data.contract.contractAmount).toLocaleString("ja-JP")} {c.currencySuffix}
          </dd>
        </dl>
      </div>

      {!isEditable && (
        <p className="text-sm text-muted-foreground border rounded-md p-3 border-amber-300 bg-amber-50">
          {t.notEditable}
        </p>
      )}

      <ContractItemsForm
        contractId={id}
        contractDate={data.contract.contractDate}
        products={data.products}
        initialItems={data.items}
        isEditable={isEditable}
      />
    </div>
  );
}
