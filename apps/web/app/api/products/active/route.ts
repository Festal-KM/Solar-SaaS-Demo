// `GET /api/products/active?asOf=ISO8601` — active product catalogue
// (T-02-03 / T-02-04 / F-012 / docs/05 §4.4).
//
// Returns the list of products effective at `asOf` for the caller's tenant.
// The endpoint is the single source of truth for SP-05's contract snapshot:
// the contract creation flow asks "what was the price catalogue on 2026-05-24?"
// and gets back the rows whose `[effectiveFrom, effectiveTo)` interval
// brackets that date.
//
// Tenant isolation: standard three-step idiom (auth → assertCan → withTenant)
// so RLS guards every query. Dealers MAY call this endpoint (the catalogue is
// part of the contract picker on the dealer side), but the response strips
// `purchasePrice` for them via `toDealerDto` — docs/03 §4.3 forbids leaking
// the wholesaler's cost. The projection lives in `@solar/contracts/dto/product`
// so the rule is enforced in exactly one place across the codebase.

import {
  findEffectiveProducts,
  toDealerDto,
  toWholesalerDto,
  type ProductCategory,
  type ProductForWholesalerDto,
} from "@solar/contracts";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { code: "INVALID_CREDENTIALS", message: "サインインが必要です" },
      { status: 401 },
    );
  }

  let ctx;
  try {
    ctx = await getTenantContext();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: 401 });
    }
    throw err;
  }

  try {
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
      // Dealers don't have a wholesalerId scope of their own — the read is
      // legitimately tenant-scoped via RLS in `withTenant`. For wholesalers
      // we still pin the resource scope so the role × tenant guard fires.
      resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
    });
  } catch (err) {
    const code = (err as { code?: string }).code ?? "FORBIDDEN";
    const message = (err as Error).message ?? "この情報にアクセスできません";
    return NextResponse.json({ code, message }, { status: 403 });
  }

  const url = new URL(request.url);
  const asOfRaw = url.searchParams.get("asOf");
  let asOf: Date;
  if (asOfRaw) {
    const parsed = new Date(asOfRaw);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { code: "VALIDATION_FAILED", message: "asOf は ISO8601 形式で指定してください" },
        { status: 400 },
      );
    }
    asOf = parsed;
  } else {
    asOf = new Date();
  }

  // `findEffectiveProducts` is a pure function — we pull a slightly wider
  // candidate set (`isActive=true` rows whose effectiveFrom <= asOf) from
  // Prisma and let the helper apply the canonical `[from, to)` check. This
  // keeps the rule definition in `@solar/contracts` and avoids hand-rolling
  // the SQL boundary check twice.
  const rows = await withTenant(ctx, (tx) =>
    tx.product.findMany({
      where: {
        isActive: true,
        effectiveFrom: { lte: asOf },
      },
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
      },
    }),
  );

  const effective = findEffectiveProducts(rows, asOf);

  // Project Prisma rows onto the JSON-safe wholesaler DTO once, then route
  // through `toDealerDto` / `toWholesalerDto` based on caller identity.
  // SaaS admin + every wholesaler role get the full view; dealers physically
  // lose the `purchasePrice` key. The dealer check uses `dealerId` (not a
  // role list) so it stays correct as new dealer-side roles are introduced.
  const isDealer = Boolean(ctx.dealerId) && !ctx.isSaasAdmin;

  const wholesaler: ProductForWholesalerDto[] = effective.map((r) => ({
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
  }));

  const products = isDealer ? wholesaler.map(toDealerDto) : wholesaler.map(toWholesalerDto);

  return NextResponse.json({ asOf: asOf.toISOString(), products });
}
