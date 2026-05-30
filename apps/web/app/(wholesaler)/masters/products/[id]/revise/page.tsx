import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { labels } from "@/lib/i18n/labels";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";

import { getProduct } from "../../data";
import { ProductReviseForm } from "../../product-revise-form";

// S-043 — 価格改定. The page checks `product.revise` so non-admin wholesaler
// roles bounce at the URL boundary.

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ReviseProductPage({ params }: PageProps) {
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
    action: "product.revise",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });

  const { id } = await params;
  const row = await getProduct(id);
  if (!row) {
    notFound();
  }

  const t = labels.product;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.revise}</h1>
        <p className="text-muted-foreground text-sm">
          {t.categories[row.category]} / {row.maker} / {row.name}
        </p>
      </div>
      <ProductReviseForm
        productId={row.id}
        current={{
          purchasePrice: row.purchasePrice,
          dealerPrice: row.dealerPrice,
          listPrice: row.listPrice,
          effectiveFrom: row.effectiveFrom,
        }}
      />
    </div>
  );
}
